# Recto Studio for Windows

Download the Windows x64 setup program from:
https://github.com/artificia1/recto-studio/releases/latest

Run the setup program, then open **Recto Studio** from the Start menu. No Node.js,
npm, terminal commands, or local web server are needed. The installer uses your
existing WebView2 runtime or installs it if missing; that first-time runtime setup
may require an internet connection. The editor and local projects work offline.
Optional online fonts and collaboration still require a connection.

For portable use, extract the entire portable ZIP to a folder and double-click
**Recto Studio.exe**. Windows WebView2 must already be installed. Portable refers
to installation-free launching; autosave stays in your Windows user profile.

Use **File → Open** to choose a publication, and **Save** to write a `.recto` file
with the Windows save dialog. PDF, EPUB, HTML, PNG, IDML, and package exports also
use native save dialogs. Importing manuscript or image files uses the existing
file chooser. The browser edition remains available separately.

Local autosave is kept in the application's WebView2 profile and is separate from
the browser edition's storage. Save a `.recto` file to move work between editions.
Documents and exports are limited to 128 MB per native Open/Save operation.

This release is not code-signed. Windows may show a publisher or reputation
warning. Download from the official repository and compare the SHA-256 checksum
with `SHA256SUMS.txt` on the release page if you need to verify the file.

The application does not yet register document file associations or an automatic
updater. Open documents from inside Recto and download future releases from GitHub.
