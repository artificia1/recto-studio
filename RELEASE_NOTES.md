## Recto Studio 1.2.3

- Paragraph keep-with-next and keep-together controls for formatted stories.
- Configurable widow/orphan minimums across columns and linked text frames.
- Dictionary hyphenation for English (US), German and French, preserving manuscript text.
- Paragraph bold/italic controls and safer font loading with visible failure feedback.
- EPUB language and flow hints for compatible readers.

**Updater test:** install 1.2.2 first, then choose **Check for updates → Install update** to reach 1.2.3.

## Included from 1.2.2

- Signed in-app updates: check, download, save pending work, install and restart.
- Automatic story extension, paired facing spreads, chapter openings, sections and running headers.
- Responsive footer controls with clear spacing at smaller window widths.
- Story edits and generated pages undo together; overflow pages stay with their chapter.

Install this version manually once. Future releases can be installed through **Check for updates**.

## Bug fixes

- Clicking empty canvas with the text tool clears the previous text-frame selection.
- Fit Frame to Content and Auto Copyfit use measured text layout to avoid clipping content.
- Formatted stories retain their text and linked frames are protected from accidental resizing.

## Windows desktop app

Recto Studio now runs as a standalone Windows application with its own window,
app icon, and Start menu entry. End users do not need Node.js, npm, or a terminal.

- **Recommended:** download `Recto-Studio-1.2.3-Windows-x64-setup.exe`, install it, and open Recto Studio from the Start menu.
- **Portable:** extract `Recto-Studio-1.2.3-Windows-x64-portable.zip` and open `Recto Studio.exe`. Requires an existing WebView2 runtime.
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
associations are not included in this release.
