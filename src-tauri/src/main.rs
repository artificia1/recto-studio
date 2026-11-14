// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod project_files;
mod proposal_inbox;

use project_files::{is_native_project, persist_file, ProjectFile, ProjectFiles, MAX_FILE_BYTES};
use proposal_inbox::ProposalInbox;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::Manager;

type ProjectRegistry = Arc<Mutex<ProjectFiles>>;

#[derive(serde::Serialize)]
struct BundledMcp {
    executable: std::path::PathBuf,
    entry: std::path::PathBuf,
}

#[tauri::command]
fn desktop_bundled_mcp(app: tauri::AppHandle) -> Result<Option<BundledMcp>, String> {
    if app.config().identifier != "com.recto.studio.mcp" {
        return Ok(None);
    }
    let runtime = app.path().resource_dir().map_err(|error| error.to_string())?.join("mcp-runtime");
    let executable = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
    let entry = runtime.join("bin/recto.js");
    Ok((executable.is_file() && entry.is_file()).then_some(BundledMcp { executable, entry }))
}
const EXPORT_EXTENSIONS: &[&str] = &[
    "recto", "pdf", "epub", "html", "zip", "idml", "png", "svg", "json",
    "rectoarchive", "rectobook", "rectoset", "rectostyles", "rectotm", "recto-artwork", "rectolayout", "rectoappearance", "xlf", "txt",
];

#[derive(serde::Serialize)]
struct OpenedDocument {
    name: String,
    bytes: Vec<u8>,
    project: Option<ProjectFile>,
}

#[tauri::command]
async fn desktop_open_document(window: tauri::Window, projects: tauri::State<'_, ProjectRegistry>) -> Result<Option<OpenedDocument>, String> {
    let projects = Arc::clone(projects.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Open publication")
            .add_filter("Publication documents", &["recto", "papercut", "json", "idml", "indd", "rectoarchive"])
            .pick_file();
        let Some(path) = path else { return Ok(None) };
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            return Err("Please choose a document file within the 128 MB limit.".into());
        }
        let name = path.file_name().ok_or("Invalid file name")?.to_string_lossy().into_owned();
        // Enforce the limit during the read too: a file can grow after metadata().
        let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_FILE_BYTES { return Err("Please choose a document smaller than 128 MB.".into()); }
        let project = if is_native_project(&path) {
            Some(projects.lock().map_err(|e| e.to_string())?.remember(path, &bytes)?)
        } else {
            None
        };
        Ok(Some(OpenedDocument { name, bytes, project }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn desktop_save_project(
    window: tauri::Window,
    projects: tauri::State<'_, ProjectRegistry>,
    handle: Option<String>,
    suggested_name: String,
    bytes: Vec<u8>,
) -> Result<Option<ProjectFile>, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("This project exceeds the 128 MB desktop save limit.".into());
    }
    let projects = Arc::clone(projects.inner());
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(handle) = handle {
            return projects.lock().map_err(|e| e.to_string())?.save(&handle, &bytes).map(Some);
        }
        let suggested_name = std::path::Path::new(&suggested_name).file_name()
            .and_then(|name| name.to_str()).unwrap_or("publication.recto");
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Save Recto project as")
            .set_file_name(suggested_name)
            .add_filter("Recto project", &["recto"])
            .save_file();
        let Some(path) = path else { return Ok(None) };
        if !is_native_project(&path) {
            return Err("Save the project with the .recto extension.".into());
        }
        let mut projects = projects.lock().map_err(|e| e.to_string())?;
        persist_file(&path, &bytes, None)?;
        projects.remember(path, &bytes).map(Some)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn desktop_save_file(window: tauri::Window, suggested_name: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES { return Err("This export exceeds the 128 MB desktop save limit.".into()); }
    let extension = std::path::Path::new(&suggested_name).extension()
        .and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    if !EXPORT_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Unsupported export format.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Save publication")
            .set_file_name(&suggested_name)
            .add_filter("Publication file", &[extension.as_str()])
            .save_file();
        let Some(path) = path else { return Ok(false) };
        // Write alongside the destination and replace only after the write succeeds.
        persist_file(&path, &bytes, None)?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::persist_file;

    #[test]
    fn saves_and_replaces_the_selected_file() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("publication.recto");
        persist_file(&file, b"first version", None).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"first version");
        persist_file(&file, b"second version", None).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"second version");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn fails_without_creating_a_file_when_the_destination_is_missing() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("missing/publication.recto");
        assert!(persist_file(&file, b"content", None).is_err());
        assert!(!file.exists());
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ProjectRegistry::default())
        .manage(ProposalInbox::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            desktop_open_document, desktop_save_project, desktop_save_file, desktop_bundled_mcp,
            proposal_inbox::desktop_begin_proposal_review, proposal_inbox::desktop_read_proposal,
            proposal_inbox::desktop_end_proposal_review,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Recto desktop application");
}
