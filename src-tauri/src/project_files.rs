use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PROJECT_HANDLES: usize = 16;
const EXTERNAL_CHANGE: &str = "The project file changed on disk. Use Save As to keep your edits in a separate file.";
type Fingerprint = [u8; 32];

#[derive(Debug, serde::Serialize)]
pub struct ProjectFile {
    pub handle: String,
    pub name: String,
}

struct OpenProject {
    id: u64,
    path: PathBuf,
    fingerprint: Fingerprint,
}

#[derive(Default)]
pub struct ProjectFiles {
    next_id: u64,
    files: VecDeque<OpenProject>,
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| "Invalid project file name.".into())
}

fn fingerprint(path: &Path) -> Result<Fingerprint, String> {
    if !path.is_file() {
        return Err(EXTERNAL_CHANGE.into());
    }
    let file = File::open(path).map_err(|_| EXTERNAL_CHANGE)?;
    let mut reader = file.take(MAX_FILE_BYTES + 1);
    let mut digest = Sha256::new();
    let mut bytes = [0; 32 * 1024];
    let mut total = 0;
    loop {
        let count = reader.read(&mut bytes).map_err(|_| EXTERNAL_CHANGE)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_FILE_BYTES {
            return Err(EXTERNAL_CHANGE.into());
        }
        digest.update(&bytes[..count]);
    }
    Ok(digest.finalize().into())
}

pub fn persist_file(path: &Path, bytes: &[u8], expected: Option<Fingerprint>) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid save location.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    // Check just before replacing the destination, after the new file is fully staged.
    if let Some(expected) = expected {
        if fingerprint(path)? != expected {
            return Err(EXTERNAL_CHANGE.into());
        }
    }
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn is_native_project(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("recto"))
}

impl ProjectFiles {
    pub fn remember(&mut self, path: PathBuf, bytes: &[u8]) -> Result<ProjectFile, String> {
        let name = file_name(&path)?;
        self.next_id += 1;
        let id = self.next_id;
        self.files.push_back(OpenProject { id, path, fingerprint: Sha256::digest(bytes).into() });
        if self.files.len() > MAX_PROJECT_HANDLES {
            self.files.pop_front();
        }
        Ok(ProjectFile { handle: id.to_string(), name })
    }

    pub fn save(&mut self, handle: &str, bytes: &[u8]) -> Result<ProjectFile, String> {
        let id = handle.parse::<u64>().ok();
        let project = self.files.iter_mut().find(|project| Some(project.id) == id)
            .ok_or("The project location is unavailable. Use Save As to choose a location.")?;
        persist_file(&project.path, bytes, Some(project.fingerprint))?;
        project.fingerprint = Sha256::digest(bytes).into();
        Ok(ProjectFile { handle: handle.to_owned(), name: file_name(&project.path)? })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn saves_again_after_updating_the_known_fingerprint() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("chapter.recto");
        fs::write(&path, b"opened").unwrap();
        let mut projects = ProjectFiles::default();
        let binding = projects.remember(path.clone(), b"opened").unwrap();
        projects.save(&binding.handle, b"first edit").unwrap();
        projects.save(&binding.handle, b"second edit").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second edit");
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn preserves_external_edits_and_does_not_recreate_a_deleted_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("chapter.recto");
        fs::write(&path, b"original").unwrap();
        let mut projects = ProjectFiles::default();
        let binding = projects.remember(path.clone(), b"original").unwrap();
        fs::write(&path, b"external").unwrap();
        assert_eq!(projects.save(&binding.handle, b"my edits").unwrap_err(), EXTERNAL_CHANGE);
        assert_eq!(fs::read(&path).unwrap(), b"external");
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
        fs::remove_file(&path).unwrap();
        assert_eq!(projects.save(&binding.handle, b"my edits").unwrap_err(), EXTERNAL_CHANGE);
        assert!(!path.exists());
    }

    #[test]
    fn rejects_a_handle_without_a_picker_selection() {
        assert!(ProjectFiles::default().save("1", b"nothing").is_err());
    }
}
