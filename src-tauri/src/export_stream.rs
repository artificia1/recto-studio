use crate::project_files::{ProjectFile, ProjectFiles, ProjectWrite, MAX_FILE_BYTES};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;

pub const CHUNK_BYTES: usize = 1024 * 1024;
const STALE_AFTER: Duration = Duration::from_secs(600);

pub fn decode_json_chunk(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let chunk = value.as_array().ok_or("Expected a binary export chunk.")?;
    if chunk.is_empty() || chunk.len() > CHUNK_BYTES {
        return Err("Invalid export chunk size.".into());
    }
    chunk.iter()
        .map(|value| {
            value.as_u64()
                .and_then(|number| u8::try_from(number).ok())
                .ok_or_else(|| "Invalid byte in export chunk.".into())
        })
        .collect()
}

struct PendingExport {
    owner: String,
    destination: PathBuf,
    file: NamedTempFile,
    expected: u64,
    written: u64,
    touched: Instant,
    project: Option<ProjectWrite>,
}

#[derive(Default)]
pub struct ExportStreams {
    next_id: u64,
    pending: HashMap<u64, PendingExport>,
}

impl ExportStreams {
    pub fn begin(&mut self, owner: String, path: PathBuf, expected: u64) -> Result<u64, String> {
        self.begin_file(owner, path, expected, None)
    }

    pub fn begin_file(
        &mut self, owner: String, path: PathBuf, expected: u64,
        project: Option<ProjectWrite>,
    ) -> Result<u64, String> {
        if expected > MAX_FILE_BYTES {
            return Err("This export exceeds the 128 MB desktop save limit.".into());
        }
        self.pending.retain(|_, export| export.touched.elapsed() < STALE_AFTER);
        let parent = path.parent().ok_or("Invalid save location.")?;
        let file = NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or("No export tokens remain.")?;
        let id = self.next_id;
        self.pending.insert(
            id,
            PendingExport {
                owner,
                destination: path,
                file,
                expected,
                written: 0,
                touched: Instant::now(),
                project,
            },
        );
        Ok(id)
    }

    pub fn write(&mut self, owner: &str, id: u64, offset: u64, chunk: &[u8]) -> Result<(), String> {
        let export = self
            .pending
            .get_mut(&id)
            .filter(|export| export.owner == owner)
            .ok_or("The export save is unavailable.")?;
        if chunk.is_empty()
            || chunk.len() > CHUNK_BYTES
            || offset != export.written
            || chunk.len() as u64 > export.expected - export.written
        {
            return Err("The export chunk does not match the expected file position or size.".into());
        }
        if let Err(error) = export.file.write_all(chunk) {
            self.pending.remove(&id);
            return Err(error.to_string());
        }
        export.written += chunk.len() as u64;
        export.touched = Instant::now();
        Ok(())
    }

    pub fn finish(&mut self, owner: &str, id: u64) -> Result<(), String> {
        self.finish_file(owner, id, None).map(|_| ())
    }

    pub fn finish_file(
        &mut self, owner: &str, id: u64, projects: Option<&mut ProjectFiles>,
    ) -> Result<Option<ProjectFile>, String> {
        let export = self
            .pending
            .get(&id)
            .filter(|export| export.owner == owner)
            .ok_or("The export save is unavailable.")?;
        if export.written != export.expected {
            return Err("The export file is incomplete.".into());
        }
        if export.project.is_some() != projects.is_some() {
            return Err("The export save is unavailable.".into());
        }
        let export = self.pending.remove(&id).ok_or("The export save is unavailable.")?;
        export.file.as_file().sync_all().map_err(|error| error.to_string())?;
        if let (Some(binding), Some(projects)) = (export.project, projects) {
            return projects.publish_staged(export.destination, export.file, binding).map(Some);
        }
        export.file.persist(&export.destination).map_err(|error| error.to_string())?;
        Ok(None)
    }

    pub fn abort(&mut self, owner: &str, id: u64) {
        if self.pending.get(&id).is_some_and(|export| export.owner == owner) {
            self.pending.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn decodes_only_valid_bytes_from_the_webview_message_fallback() {
        use serde_json::json;
        assert_eq!(decode_json_chunk(&json!([0, 128, 255])).unwrap(), [0, 128, 255]);
        for invalid in [json!([]), json!({}), json!([256]), json!([-1]), json!([1.5])] {
            assert!(decode_json_chunk(&invalid).is_err());
        }
    }

    #[test]
    fn publishes_only_after_the_declared_bytes_are_written_in_order() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("book.pdf");
        fs::write(&path, b"original").unwrap();
        let mut streams = ExportStreams::default();
        let id = streams.begin("main".into(), path.clone(), 6).unwrap();
        assert!(streams.write("other", id, 0, b"abc").is_err());
        assert!(streams.write("main", id, 3, b"def").is_err());
        streams.write("main", id, 0, b"abc").unwrap();
        assert!(streams.finish("main", id).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        streams.write("main", id, 3, b"def").unwrap();
        streams.finish("main", id).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"abcdef");
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn abort_discards_partial_output_and_rejects_oversized_writes() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("book.pdf");
        let mut streams = ExportStreams::default();
        assert!(streams.begin("main".into(), path.clone(), MAX_FILE_BYTES + 1).is_err());
        let id = streams.begin("main".into(), path.clone(), CHUNK_BYTES as u64 + 2).unwrap();
        assert!(streams.write("main", id, 0, &vec![0; CHUNK_BYTES + 1]).is_err());
        streams.write("main", id, 0, b"abc").unwrap();
        streams.abort("other", id);
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
        streams.abort("main", id);
        assert!(!path.exists());
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_staged_project_keeps_external_edits_and_updates_its_binding_after_success() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("book.recto");
        let mut streams = ExportStreams::default();
        let mut projects = ProjectFiles::default();
        let id = streams.begin_file("main".into(), path.clone(), 2, Some(ProjectWrite::SaveAs)).unwrap();
        streams.write("main", id, 0, b"{}").unwrap();
        let saved = streams.finish_file("main", id, Some(&mut projects)).unwrap().unwrap();
        assert_eq!(saved.name, "book.recto");
        let (_, expected) = projects.save_target(&saved.handle).unwrap();
        let binding = ProjectWrite::Existing { handle: saved.handle, expected };
        let id = streams.begin_file("main".into(), path.clone(), 2, Some(binding)).unwrap();
        streams.write("main", id, 0, b"[]").unwrap();
        fs::write(&path, b"external").unwrap();
        assert!(streams.finish_file("main", id, Some(&mut projects)).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
    }
}
