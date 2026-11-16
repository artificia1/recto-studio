// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod document_reader;
mod export_stream;
mod project_files;
mod proposal_inbox;
mod raster_adjustments;
mod raster_headers;
mod raster_kernel;
mod raster_prepress;

use document_reader::{DocumentRead, DocumentReaders};
use export_stream::{decode_json_chunk, ExportStreams, CHUNK_BYTES};
use project_files::{is_native_project, persist_file, ProjectFile, ProjectFiles, ProjectWrite, MAX_FILE_BYTES};
use proposal_inbox::ProposalInbox;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::Manager;

type ProjectRegistry = Arc<Mutex<ProjectFiles>>;
type ExportRegistry = Arc<Mutex<ExportStreams>>;
type ReaderRegistry = Arc<Mutex<DocumentReaders>>;

fn pick_document(window: &tauri::Window) -> Option<std::path::PathBuf> {
    rfd::FileDialog::new().set_parent(window).set_title("Open publication")
        .add_filter("Publication documents", &["recto", "papercut", "json", "idml", "indd", "rectoarchive"])
        .pick_file()
}

fn pick_project_destination(window: &tauri::Window, suggested_name: &str) -> Result<Option<std::path::PathBuf>, String> {
    let name = std::path::Path::new(suggested_name).file_name()
        .and_then(|name| name.to_str()).unwrap_or("publication.recto");
    let path = rfd::FileDialog::new().set_parent(window).set_title("Save Recto project as")
        .set_file_name(name).add_filter("Recto project", &["recto"]).save_file();
    if path.as_deref().is_some_and(|path| !is_native_project(path)) {
        return Err("Save the project with the .recto extension.".into());
    }
    Ok(path)
}

#[tauri::command]
fn desktop_document_chunk_size() -> usize { CHUNK_BYTES }

#[tauri::command]
async fn desktop_begin_document_read(window: tauri::Window, readers: tauri::State<'_, ReaderRegistry>) -> Result<Option<DocumentRead>, String> {
    let readers = Arc::clone(readers.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = pick_document(&window) else { return Ok(None); };
        readers.lock().map_err(|error| error.to_string())?.begin(window.label().to_owned(), path).map(Some)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_read_document_chunk(window: tauri::Window, readers: tauri::State<'_, ReaderRegistry>, token: String, offset: u64) -> Result<tauri::ipc::Response, String> {
    let readers = Arc::clone(readers.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = readers.lock().map_err(|error| error.to_string())?.read(window.label(), &token, offset)?;
        Ok(tauri::ipc::Response::new(bytes))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn desktop_finish_document_read(window: tauri::Window, readers: tauri::State<'_, ReaderRegistry>, projects: tauri::State<'_, ProjectRegistry>, token: String) -> Result<Option<ProjectFile>, String> {
    let mut projects = projects.lock().map_err(|error| error.to_string())?;
    readers.lock().map_err(|error| error.to_string())?.finish(window.label(), &token, &mut projects)
}

#[tauri::command]
fn desktop_abort_document_read(window: tauri::Window, readers: tauri::State<'_, ReaderRegistry>, token: String) {
    if let Ok(mut readers) = readers.lock() { readers.abort(window.label(), &token); }
}

#[tauri::command]
async fn desktop_begin_project_write(
    window: tauri::Window, exports: tauri::State<'_, ExportRegistry>, projects: tauri::State<'_, ProjectRegistry>,
    handle: Option<String>, suggested_name: String, byte_length: u64,
) -> Result<Option<String>, String> {
    if byte_length > MAX_FILE_BYTES { return Err("This project exceeds the 128 MB desktop save limit.".into()); }
    let exports = Arc::clone(exports.inner());
    let projects = Arc::clone(projects.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let (path, binding) = if let Some(handle) = handle {
            let (path, expected) = projects.lock().map_err(|error| error.to_string())?.save_target(&handle)?;
            (path, ProjectWrite::Existing { handle, expected })
        } else {
            let Some(path) = pick_project_destination(&window, &suggested_name)? else { return Ok(None); };
            (path, ProjectWrite::SaveAs)
        };
        let token = exports.lock().map_err(|error| error.to_string())?
            .begin_file(window.label().to_owned(), path, byte_length, Some(binding))?;
        Ok(Some(token.to_string()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_finish_project_write(
    window: tauri::Window, exports: tauri::State<'_, ExportRegistry>, projects: tauri::State<'_, ProjectRegistry>, token: String,
) -> Result<Option<ProjectFile>, String> {
    let id = token.parse::<u64>().map_err(|_| "Invalid project write token.")?;
    let exports = Arc::clone(exports.inner());
    let projects = Arc::clone(projects.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut projects = projects.lock().map_err(|error| error.to_string())?;
        exports.lock().map_err(|error| error.to_string())?.finish_file(window.label(), id, Some(&mut projects))
    }).await.map_err(|error| error.to_string())?
}

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
        let path = pick_document(&window);
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
        let Some(path) = pick_project_destination(&window, &suggested_name)? else { return Ok(None); };
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

#[tauri::command]
fn desktop_probe_raster(request: tauri::ipc::Request<'_>) -> Option<serde_json::Value> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return None };
    let media_type = request.headers().get("x-recto-raster-type")?.to_str().ok()?;
    let result = raster_headers::probe(bytes, media_type)?;
    Some(serde_json::json!({ "width": result.width, "height": result.height, "cmyk": result.cmyk }))
}

#[tauri::command]
fn desktop_adjust_raster(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, &'static str> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Raster adjustment requires a binary payload.");
    };
    raster_adjustments::adjust_packet(bytes)
        .map(tauri::ipc::Response::new)
        .ok_or("Invalid raster adjustment payload.")
}

#[tauri::command]
fn desktop_prepare_raster_tile(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, &'static str> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Raster preparation requires a binary payload.");
    };
    let mode = request.headers().get("x-recto-raster-mode").and_then(|value| value.to_str().ok())
        .ok_or("Raster preparation mode is required.")?;
    raster_prepress::prepare_tile(bytes, mode)
        .map(tauri::ipc::Response::new)
        .ok_or("Invalid raster preparation payload.")
}

#[tauri::command]
fn desktop_export_chunk_size() -> usize {
    CHUNK_BYTES
}

#[tauri::command]
async fn desktop_begin_export(
    window: tauri::Window,
    exports: tauri::State<'_, ExportRegistry>,
    suggested_name: String,
    byte_length: u64,
) -> Result<Option<String>, String> {
    if byte_length > MAX_FILE_BYTES {
        return Err("This export exceeds the 128 MB desktop save limit.".into());
    }
    let extension = std::path::Path::new(&suggested_name).extension()
        .and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    if !EXPORT_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Unsupported export format.".into());
    }
    let exports = Arc::clone(exports.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Save publication")
            .set_file_name(&suggested_name)
            .add_filter("Publication file", &[extension.as_str()])
            .save_file();
        let Some(path) = path else { return Ok(None) };
        let id = exports.lock().map_err(|error| error.to_string())?
            .begin(window.label().to_owned(), path, byte_length)?;
        Ok(Some(id.to_string()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_write_export_chunk(
    window: tauri::Window,
    exports: tauri::State<'_, ExportRegistry>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let number = |name: &str| {
        request.headers().get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
    };
    let id = number("x-recto-export-id").ok_or("Invalid export token.")?;
    let offset = number("x-recto-export-offset").ok_or("Invalid export offset.")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if !bytes.is_empty() && bytes.len() <= CHUNK_BYTES => bytes.clone(),
        tauri::ipc::InvokeBody::Raw(_) => return Err("Invalid export chunk size.".into()),
        // Tauri serializes typed arrays as JSON when the custom IPC protocol is unavailable.
        tauri::ipc::InvokeBody::Json(value) => decode_json_chunk(value)?,
    };
    let owner = window.label().to_owned();
    let exports = Arc::clone(exports.inner());
    tauri::async_runtime::spawn_blocking(move || {
        exports.lock().map_err(|error| error.to_string())?.write(&owner, id, offset, &bytes)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_finish_export(
    window: tauri::Window,
    exports: tauri::State<'_, ExportRegistry>,
    token: String,
) -> Result<(), String> {
    let id = token.parse::<u64>().map_err(|_| "Invalid export token.")?;
    let exports = Arc::clone(exports.inner());
    tauri::async_runtime::spawn_blocking(move || {
        exports.lock().map_err(|error| error.to_string())?.finish(window.label(), id)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn desktop_abort_export(window: tauri::Window, exports: tauri::State<'_, ExportRegistry>, token: String) {
    if let (Ok(id), Ok(mut exports)) = (token.parse::<u64>(), exports.lock()) {
        exports.abort(window.label(), id);
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ProjectRegistry::default())
        .manage(ExportRegistry::default())
        .manage(ReaderRegistry::default())
        .manage(ProposalInbox::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            desktop_open_document, desktop_save_project, desktop_save_file, desktop_bundled_mcp,
            desktop_probe_raster, desktop_adjust_raster, desktop_prepare_raster_tile,
            desktop_export_chunk_size, desktop_begin_export, desktop_write_export_chunk,
            desktop_finish_export, desktop_abort_export,
            desktop_document_chunk_size, desktop_begin_document_read, desktop_read_document_chunk,
            desktop_finish_document_read, desktop_abort_document_read, desktop_begin_project_write,
            desktop_finish_project_write,
            proposal_inbox::desktop_begin_proposal_review, proposal_inbox::desktop_read_proposal,
            proposal_inbox::desktop_end_proposal_review,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Recto desktop application");
}
