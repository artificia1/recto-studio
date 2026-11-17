use cap_std::fs::Dir;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

const MAX_PROJECT_BYTES: u64 = 32 * 1024 * 1024;

pub fn check_extension(path: &Path) -> Result<(), String> {
    if path.extension().and_then(|value| value.to_str()).is_some_and(|value|
        value.eq_ignore_ascii_case("recto") || value.eq_ignore_ascii_case("json")) {
        Ok(())
    } else {
        Err("Choose a .recto or .json publication.".into())
    }
}

fn workspace_parts(path: &str) -> Result<Vec<&str>, String> {
    let parts: Vec<_> = path.split('/').collect();
    if path.is_empty() || path.len() > 1024 || parts.iter().any(|part| {
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ((base.starts_with("COM") || base.starts_with("LPT")) && base.get(3..).is_some_and(|suffix|
                matches!(suffix, "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")));
        part.is_empty() || part.ends_with(['.', ' ']) || reserved ||
            part.chars().any(|character| character.is_control() || "\\:<>\"|?*".contains(character))
    }) {
        return Err("Use a workspace-relative path with forward slashes and ordinary file names.".into());
    }
    check_extension(Path::new(path))?;
    Ok(parts)
}

pub fn inspect_workspace(root: &Dir, path: &str, revision: Option<&str>, offset: usize, limit: usize) -> Result<Value, String> {
    let parts = workspace_parts(path)?;
    let (name, parents) = parts.split_last().ok_or("Choose a project.")?;
    let mut directory = root.try_clone().map_err(|_| "The publishing workspace is unavailable.")?;
    for parent in parents {
        let entry = directory.symlink_metadata(parent).map_err(|_| "A selected file or folder is missing.")?;
        if !entry.is_dir() || entry.is_symlink() { return Err("Choose an ordinary workspace folder.".into()); }
        directory = directory.open_dir(parent).map_err(|_| "Could not open the workspace folder.")?;
    }
    let entry = directory.symlink_metadata(name).map_err(|_| "The selected project is missing.")?;
    if !entry.is_file() || entry.is_symlink() { return Err("Choose a regular workspace file.".into()); }
    let file = directory.open(name).map_err(|_| "Could not open the selected project.")?;
    let metadata = file.metadata().map_err(|_| "Could not inspect the selected project.")?;
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        if metadata.nlink() > 1 { return Err("Choose a regular workspace file without hard links.".into()); }
    }
    #[cfg(windows)]
    {
        use std::{mem::MaybeUninit, os::windows::io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle};
        let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
        // The handle stays open for the inspection and the API initializes info on success.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) } == 0 ||
            unsafe { info.assume_init() }.nNumberOfLinks > 1 {
            return Err("Choose a regular workspace file without hard links.".into());
        }
    }
    inspect(file, metadata.is_file(), metadata.len(), revision, offset, limit)
}

pub fn inspect(file: impl Read, is_file: bool, length: u64, expected: Option<&str>, offset: usize, limit: usize) -> Result<Value, String> {
    if !is_file || length > MAX_PROJECT_BYTES { return Err("Choose a regular publication file up to 32 MiB.".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_PROJECT_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "Could not read the publication.")?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES { return Err("The publication exceeds 32 MiB.".into()); }
    let revision = format!("{:x}", Sha256::digest(&bytes));
    if expected.is_some_and(|value| value != revision) { return Err("The publication changed. Read it again.".into()); }
    let source: Value = serde_json::from_slice(&bytes).map_err(|_| "The publication is not valid JSON.")?;
    let spreads = source.get("spreads").and_then(Value::as_array).ok_or("The publication has no spread inventory.")?;
    let mut page_count = 0usize;
    let mut element_count = 0usize;
    let mut rows = Vec::new();
    for (index, spread) in spreads.iter().enumerate() {
        let pages = spread.get("pages").and_then(Value::as_array).ok_or("A spread has invalid pages.")?;
        let elements = spread.get("elements").and_then(Value::as_array).ok_or("A spread has invalid elements.")?;
        page_count = page_count.checked_add(pages.len()).ok_or("Too many pages.")?;
        element_count = element_count.checked_add(elements.len()).ok_or("Too many elements.")?;
        if page_count > 500 || spreads.len() > 500 { return Err("Inspection supports up to 500 spreads and pages.".into()); }
        if index >= offset && rows.len() < limit {
            let pages: Vec<_> = pages.iter().map(|page| json!({ "id": page["id"].as_str(), "number": page["pageNumber"].as_u64() })).collect();
            rows.push(json!({ "id": spread["id"].as_str(), "number": index + 1, "pages": pages, "elementCount": elements.len() }));
        }
    }
    Ok(json!({
        "revision": revision, "title": source["settings"]["title"].as_str(),
        "pageCount": page_count, "spreadCount": spreads.len(), "elementCount": element_count, "spreads": rows,
        "nextOffset": (offset + rows.len() < spreads.len()).then_some(offset + rows.len()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escapes_and_windows_devices() {
        for input in ["../a.recto", "/a.recto", "a\\b.recto", "CON.recto", "COM¹.recto", "x/../a.recto"] {
            assert!(workspace_parts(input).is_err(), "{input}");
        }
        assert_eq!(workspace_parts("book/chapter.recto").unwrap(), ["book", "chapter.recto"]);
    }
}
