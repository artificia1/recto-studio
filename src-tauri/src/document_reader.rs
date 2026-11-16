use crate::export_stream::CHUNK_BYTES;
use crate::project_files::{is_native_project, ProjectFile, ProjectFiles, MAX_FILE_BYTES};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs::File, io::Read, path::PathBuf, time::{Duration, Instant}};

struct ReadSession {
    owner: String,
    path: PathBuf,
    file: File,
    length: u64,
    offset: u64,
    digest: Sha256,
    touched: Instant,
}

#[derive(Default)]
pub struct DocumentReaders {
    next: u64,
    sessions: HashMap<u64, ReadSession>,
}

#[derive(serde::Serialize)]
pub struct DocumentRead {
    token: String,
    name: String,
    length: u64,
}

impl DocumentReaders {
    pub fn begin(&mut self, owner: String, path: PathBuf) -> Result<DocumentRead, String> {
        self.sessions.retain(|_, session| session.touched.elapsed() < Duration::from_secs(600));
        let file = File::open(&path).map_err(|error| error.to_string())?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        let length = metadata.len();
        if !metadata.is_file() || length > MAX_FILE_BYTES {
            return Err("Please choose a document file within the 128 MB limit.".into());
        }
        let name = path.file_name().ok_or("Invalid file name.")?.to_string_lossy().into_owned();
        self.next = self.next.checked_add(1).ok_or("No document read tokens remain.")?;
        self.sessions.insert(self.next, ReadSession {
            owner, path, file, length, offset: 0, digest: Sha256::new(), touched: Instant::now(),
        });
        Ok(DocumentRead { token: self.next.to_string(), name, length })
    }

    pub fn read(&mut self, owner: &str, token: &str, offset: u64) -> Result<Vec<u8>, String> {
        let session = self.session(owner, token)?;
        if offset != session.offset || offset == session.length {
            return Err("Invalid document read position.".into());
        }
        let count = (session.length - offset).min(CHUNK_BYTES as u64) as usize;
        let mut bytes = vec![0; count];
        session.file.read_exact(&mut bytes).map_err(|error| error.to_string())?;
        session.offset += count as u64;
        if is_native_project(&session.path) {
            session.digest.update(&bytes);
        }
        session.touched = Instant::now();
        Ok(bytes)
    }

    pub fn finish(
        &mut self, owner: &str, token: &str, projects: &mut ProjectFiles,
    ) -> Result<Option<ProjectFile>, String> {
        let session = self.session(owner, token)?;
        if session.offset != session.length || session.file.read(&mut [0]).map_err(|error| error.to_string())? != 0 {
            return Err("The document changed while it was being read. Open it again.".into());
        }
        let id = token.parse::<u64>().map_err(|_| "Invalid document read token.")?;
        let session = self.sessions.remove(&id).ok_or("The document read is unavailable.")?;
        if is_native_project(&session.path) {
            return projects.remember_fingerprint(session.path, session.digest.finalize().into()).map(Some);
        }
        Ok(None)
    }

    pub fn abort(&mut self, owner: &str, token: &str) {
        if self.session(owner, token).is_ok() {
            if let Ok(id) = token.parse::<u64>() {
                self.sessions.remove(&id);
            }
        }
    }

    fn session(&mut self, owner: &str, token: &str) -> Result<&mut ReadSession, String> {
        let id = token.parse::<u64>().map_err(|_| "Invalid document read token.")?;
        self.sessions.get_mut(&id).filter(|session| session.owner == owner)
            .ok_or_else(|| "The document read is unavailable.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_in_order_and_binds_the_hash_of_the_read_snapshot() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("book.recto");
        fs::write(&path, vec![42; CHUNK_BYTES + 3]).unwrap();
        let mut readers = DocumentReaders::default();
        let mut projects = ProjectFiles::default();
        let read = readers.begin("main".into(), path.clone()).unwrap();
        assert!(readers.read("other", &read.token, 0).is_err());
        assert!(readers.read("main", &read.token, 1).is_err());
        assert_eq!(readers.read("main", &read.token, 0).unwrap().len(), CHUNK_BYTES);
        assert!(readers.finish("main", &read.token, &mut projects).is_err());
        assert_eq!(readers.read("main", &read.token, CHUNK_BYTES as u64).unwrap(), [42; 3]);
        let project = readers.finish("main", &read.token, &mut projects).unwrap().unwrap();
        assert_eq!(projects.save_target(&project.handle).unwrap().1, crate::project_files::fingerprint(&path).unwrap());
    }
}
