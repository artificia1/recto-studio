# Desktop installation

## macOS

**Safari web app.** On macOS Sonoma 14 or later, [open Recto in Safari](https://artificia1.github.io/recto-studio/)
and choose **File → Add to Dock → Add**. Launch Recto from the Dock or Spotlight.
Inside that window, choose **File → Install or use offline → Enable offline access**
and wait for **Ready to open offline** before disconnecting. Save an editable
`.recto` file before switching from Safari to the web app so you can open the
publication there. External fonts and collaboration still need internet access.
[Apple’s Safari web app guide](https://support.apple.com/en-us/104996)

**Desktop preview.** Choose your disk image from the
[macOS preview releases](https://github.com/artificia1/recto-studio/releases).
In **Apple menu → About This Mac**, a **Chip** entry means Apple silicon
(`arm64`). A **Processor** entry with Intel means `x86_64`. Open the DMG,
drag **Recto Studio** to **Applications**, then open it from Applications.
The preview requires macOS 14 or later and includes the editor for offline use.

The preview uses an ad-hoc signature. If macOS says the developer cannot be
verified and you trust the download from this repository, attempt to open Recto
once, then go to **System Settings → Privacy & Security → Open Anyway** and
confirm. A managed Mac may restrict that option. For later preview versions,
download the new DMG and replace the app in Applications.
[Apple’s Gatekeeper guide](https://support.apple.com/en-us/102445)

## Windows

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

Use **File → Open Project** to choose a publication. **Save** (Ctrl+S) writes
back to the open `.recto` file. New projects and imports ask where to save their
first `.recto`. **Save Project As** (Ctrl+Shift+S) chooses a new location. If the
original file has changed or disappeared since you opened or saved it, use
**Save Project As** to keep your edits in a separate file.

**File → Recover Unsaved Projects** lists local checkpoints from editing sessions,
including work left in a previous project. Opening a recovery creates a detached
copy. Use **Save Project As** to choose where to keep it. Autosave stays in the
desktop app profile. Save a `.recto` file or editable project archive to move work
between devices.

Restoring a project from Version History or opening a shared publication also
starts a separate desktop editing session. Choose its file on the first save.

Publication exports use native save dialogs. Documents and exports are limited
to 128 MB per native Open or Save operation.

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
then put the installer and its `.sig` in `release-artifacts`. Run
`node scripts/updater-manifest.mjs <installer.sig>` with the full path to the
signature and upload the signature and generated `latest.json` to the draft.

Increase the application version before building a new release. The Windows
workflow uploads to a draft and verifies that the signature covers the exact
installer bytes and release version using the public key built into the app.
Publishing the verified draft makes it available through the in-app checker.
Use `node scripts/desktop-updater-check.mjs <older-exe> <installed-version> <offered-version>`
to exercise the native update offer and signature-verified download in a fresh
WebView2 profile. Test installation on a separate Windows profile before
releasing a change to the installer. Updater signatures are separate from
Windows publisher code signing. [Tauri updater documentation](https://v2.tauri.app/plugin/updater/)

The application does not yet register document file associations.

## Linux packages

Download an x64 `.deb` or AppImage from the
[latest stable release](https://github.com/artificia1/recto-studio/releases/latest).
The manual `linux-artifacts.yml` workflow builds both packages on Ubuntu 22.04
and attaches them to a draft. On a Linux checkout, install Tauri's native
prerequisites and run `node scripts/build-linux.mjs`.

Linux packages use WebKitGTK and require a real Linux smoke test for font loading,
file dialogs, opening/saving documents and PDF export. The Linux override disables
updater artifacts: signed Linux updater metadata is a separate release task.

## Building the macOS preview

Run **Build macOS preview** on a public GitHub repository. The workflow uses
standard Apple silicon and Intel runners, which GitHub provides free for public
repositories. For downloadable preview assets, create a draft tagged
`vX.Y.Z-macos-preview` for the exact commit and pass its tag to the workflow.
The workflow checks both bundles before attaching the DMGs and checksums.
[GitHub runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories)
