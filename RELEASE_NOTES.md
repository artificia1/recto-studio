## Windows desktop app

Recto Studio now runs as a standalone Windows application with its own window,
app icon, and Start menu entry. End users do not need Node.js, npm, or a terminal.

- **Recommended:** download `Recto-Studio-1.2.0-Windows-x64-setup.exe`, install it, and open Recto Studio from the Start menu.
- **Portable:** extract `Recto-Studio-1.2.0-Windows-x64-portable.zip` and open `Recto Studio.exe`. Requires an existing WebView2 runtime.
- Native Open/Save dialogs for publications and exports, with safe replacement of saved files.
- Local autosave and bundled editor assets; no local server or browser tab is required.

The installer can install WebView2 when missing; this initial setup may need a
connection. Online fonts and collaboration remain optional network features.
Windows x64 is the supported desktop target for this release. The app is unsigned,
so Windows may show a publisher/reputation warning. SHA-256 checksums are provided.

## Publishing improvements

- Formatted stories with paragraph styles, inline emphasis, and reusable character styles.
- Text threading that preserves paragraph boundaries and retains copy when frames are removed.
- Word, Markdown, and text import with previews, style mapping, and review warnings.
- Formatted PDF/EPUB output, persistence fixes, and expanded regression coverage.

See `MANUSCRIPTS.md` and `PUBLISHING.md` for import and output limitations. File
associations and automatic desktop updates are not included in this release.
