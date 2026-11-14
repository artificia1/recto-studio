use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const LIMIT: u64 = 32 * 1024 * 1024;

#[derive(Default)]
pub struct ProposalInbox(Arc<Mutex<Option<Inbox>>>);

struct Inbox {
    folder: PathBuf,
    proposal: String,
}

#[derive(Serialize)]
pub struct Offer {
    source: String,
    proposal: String,
    revision: String,
    canvas: Option<String>,
}

fn create_offer(folder: &Path, bytes: &[u8], canvas: Option<&[u8]>) -> Result<(Inbox, Offer), String> {
    let folder = folder.canonicalize().map_err(|error| error.to_string())?;
    let mut source = tempfile::Builder::new()
        .prefix("recto-review-")
        .rand_bytes(20)
        .suffix(".recto")
        .tempfile_in(&folder)
        .map_err(|error| error.to_string())?;
    source.write_all(bytes).map_err(|error| error.to_string())?;
    source.as_file().sync_all().map_err(|error| error.to_string())?;
    let name = source.path().file_name().and_then(|name| name.to_str()).ok_or("Invalid review file name.")?.to_owned();
    let key = name.strip_prefix("recto-review-").and_then(|name| name.strip_suffix(".recto")).ok_or("Invalid review file name.")?;
    let proposal = format!("recto-proposal-{key}.rectoproposal");
    let canvas_name = if let Some(png) = canvas {
        let filename = format!("recto-canvas-{key}.png");
        let mut temporary = tempfile::NamedTempFile::new_in(&folder).map_err(|error| error.to_string())?;
        temporary.write_all(png).map_err(|error| error.to_string())?;
        temporary.persist_noclobber(folder.join(&filename)).map_err(|error| error.to_string())?;
        Some(filename)
    } else { None };
    source.keep().map_err(|error| error.to_string())?;
    let revision = format!("{:x}", Sha256::digest(bytes));
    Ok((Inbox { folder, proposal: proposal.clone() }, Offer { source: name, proposal, revision, canvas: canvas_name }))
}

impl Inbox {
    fn read(&self) -> Result<Option<String>, String> {
        if self.folder.canonicalize().map_err(|e| e.to_string())? != self.folder {
            return Err("The review folder changed. Start another review.".into());
        }
        let path = self.folder.join(&self.proposal);
        let info = match path.symlink_metadata() {
            Ok(info) => info,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        if !info.is_file() || info.len() > LIMIT || path.canonicalize().map_err(|e| e.to_string())? != path {
            return Err("Choose a regular proposal file within the 32 MiB limit.".into());
        }
        let mut content = String::new();
        std::fs::File::open(path).and_then(|file| file.take(LIMIT + 1).read_to_string(&mut content)).map_err(|e| e.to_string())?;
        if content.len() as u64 > LIMIT { return Err("This proposal exceeds 32 MiB.".into()); }
        Ok(Some(content))
    }
}

#[tauri::command]
pub async fn desktop_begin_proposal_review(window: tauri::Window, inbox: tauri::State<'_, ProposalInbox>, snapshot: String, canvas: Option<Vec<u8>>) -> Result<Option<Offer>, String> {
    if snapshot.len() as u64 > LIMIT { return Err("This review snapshot exceeds 32 MiB.".into()); }
    if canvas.as_ref().is_some_and(|png| png.len() > 3 * 1024 * 1024 || !png.starts_with(b"\x89PNG\r\n\x1a\n")) {
        return Err("The canvas capture is not a supported PNG.".into());
    }
    let inbox = Arc::clone(&inbox.0);
    tauri::async_runtime::spawn_blocking(move || {
        let folder = rfd::FileDialog::new().set_parent(&window).set_title("Choose your Recto publishing workspace").pick_folder();
        let Some(folder) = folder else { return Ok(None) };
        let (entry, offer) = create_offer(&folder, snapshot.as_bytes(), canvas.as_deref())?;
        *inbox.lock().map_err(|e| e.to_string())? = Some(entry);
        Ok(Some(offer))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn desktop_read_proposal(inbox: tauri::State<'_, ProposalInbox>, proposal: String) -> Result<Option<String>, String> {
    let inbox = Arc::clone(&inbox.0);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = inbox.lock().map_err(|e| e.to_string())?;
        let entry = guard.as_ref().filter(|entry| entry.proposal == proposal).ok_or("Start another review.")?;
        entry.read()
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn desktop_end_proposal_review(inbox: tauri::State<'_, ProposalInbox>, proposal: String) -> Result<(), String> {
    let mut guard = inbox.0.lock().map_err(|e| e.to_string())?;
    if guard.as_ref().is_some_and(|entry| entry.proposal == proposal) { guard.take(); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_issued_proposal_file() {
        let folder = tempfile::tempdir().unwrap();
        let (inbox, offer) = create_offer(folder.path(), b"snapshot", Some(b"\x89PNG\r\n\x1a\n")).unwrap();
        assert_eq!(std::fs::read(inbox.folder.join(offer.source)).unwrap(), b"snapshot");
        assert!(inbox.folder.join(offer.canvas.unwrap()).is_file());
        std::fs::write(inbox.folder.join("stray.rectoproposal"), "ignored").unwrap();
        assert_eq!(inbox.read().unwrap(), None);
        std::fs::write(inbox.folder.join(offer.proposal), "proposal").unwrap();
        assert_eq!(inbox.read().unwrap().as_deref(), Some("proposal"));
    }
}
