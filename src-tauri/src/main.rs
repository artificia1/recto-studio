// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;

const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;

fn persist_export(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid save location")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct OpenedDocument {
    name: String,
    bytes: Vec<u8>,
}

#[tauri::command]
async fn desktop_open_document(window: tauri::Window) -> Result<Option<OpenedDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Open publication")
            .add_filter("Publication documents", &["recto", "papercut", "json", "idml", "indd"])
            .pick_file();
        let Some(path) = path else { return Ok(None) };
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size > MAX_FILE_BYTES { return Err("Please choose a document smaller than 128 MB.".into()); }
        let name = path.file_name().ok_or("Invalid file name")?.to_string_lossy().into_owned();
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        Ok(Some(OpenedDocument { name, bytes }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn desktop_save_file(window: tauri::Window, suggested_name: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES { return Err("This export exceeds the 128 MB desktop save limit.".into()); }
    let extension = std::path::Path::new(&suggested_name).extension()
        .and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    if !["recto", "pdf", "epub", "html", "zip", "idml", "png"].contains(&extension.as_str()) {
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
        persist_export(&path, &bytes)?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::persist_export;

    #[test]
    fn saves_and_replaces_the_selected_file() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("publication.recto");
        persist_export(&file, b"first version").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"first version");
        persist_export(&file, b"second version").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"second version");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn fails_without_creating_a_file_when_the_destination_is_missing() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("missing/publication.recto");
        assert!(persist_export(&file, b"content").is_err());
        assert!(!file.exists());
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_open_document, desktop_save_file])
        .run(tauri::generate_context!())
        .expect("error while running Recto desktop application");
}
