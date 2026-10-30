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

## In-app updates

Desktop builds with updater support offer **Check for updates** in the top bar.
If a newer release is available, choose **Install update**. Recto downloads the
package, verifies its signature, saves pending publication edits, and starts the
installer. Windows restarts the app afterwards. A failed download or save leaves
the editor open so you can retry. Updates require an internet connection.

Version 1.2.1 and earlier need one manual installation of an updater-enabled
release. Browser users receive the deployed website instead. Portable users who
choose Install update move to the installed edition in their Windows user profile.

### Release maintenance

The release workflow can use the `TAURI_SIGNING_PRIVATE_KEY` repository secret
and, for encrypted keys, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Its private key
must match the public key in `src-tauri/tauri.conf.json`. Keep a secure backup of
the key: existing installations rely on it to trust future updates. Never commit
private keys. The local development key is stored in the ignored `.release.local`
directory. Alternatively, leave the key local: the workflow builds a draft
without updater metadata; download its installer, sign it locally with
`tauri signer sign --private-key-path <key-file> --app-version <version> <installer>`,
then upload its public `.sig` and matching `latest.json` before publication.
Never publish an updater release without these verified files.

Increase the application version before building a new release. The workflow
uploads the signed installer, its signature, and `latest.json` to a draft release.
Publishing that release makes it available through the in-app checker. Test a
real older-to-newer installation before the first updater-enabled public release.
Updater signatures are separate from Windows publisher code signing.

The application does not yet register document file associations.
