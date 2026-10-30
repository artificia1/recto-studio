# Verify desktop updates before release

An updater test needs **two updater-enabled versions**. The public 1.2.1 app
cannot perform this test because it has no updater code. The steps below keep
the experiment local: no GitHub commit, release, or upload is required.

## 1. Prepare the machine

Save a `.recto` copy of important publications first. These instructions assume
Windows x64, Node/npm, Rust, WebView2, and Visual Studio Build Tools with the
Desktop development with C++ workload and Windows SDK. Run commands in PowerShell
from the Recto repository. `npm ci` must succeed before building.

The private signing key already generated for this project is in
`.release.local/updater.key`. Its matching public key is in the Tauri configuration.
Keep both versions on the **same key**. Do not paste the private key into a chat,
commit it, or replace it for each release. Keep a separate secure backup.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path '.release.local/updater.key').Path
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
New-Item -ItemType Directory -Force '.release.local/update-test' | Out-Null
```

If using the workspace-local Rust toolchain, also set the following for this shell:

```powershell
$env:CARGO_HOME = "$PWD/.release.local/cargo"
$env:RUSTUP_HOME = "$PWD/.release.local/rustup"
$env:PATH = "$PWD/.release.local/cargo/bin;$env:PATH"
```

## 2. Build the older test version

Create `.release.local/updater-test.json` with this content:

```json
{
  "productName": "Recto Studio Update Test",
  "identifier": "com.recto.studio.updatertest",
  "version": "1.2.2",
  "plugins": {
    "updater": {
      "endpoints": ["http://127.0.0.1:8765/latest.json"],
      "dangerousInsecureTransportProtocol": true
    }
  }
}
```

This separate identifier isolates test autosave from the normal app. HTTP is
allowed **only in this ignored local test override**. The real configuration
keeps HTTPS and the GitHub endpoint. Never release these test installers.

```powershell
npm run tauri:build -- --config .release.local/updater-test.json --bundles nsis -- --locked
if ($LASTEXITCODE -ne 0) { throw 'Build failed; stop here.' }
$installer = Get-ChildItem 'src-tauri/target/release/bundle/nsis/*-setup.exe' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item -LiteralPath $installer.FullName '.release.local/update-test/older-setup.exe'
```

Run `older-setup.exe`, install it, then open **Recto Studio Update Test**. Check
that the top bar contains **Check for updates**. Close the app before building
the next version. The status bar's application version is currently a source
label, so use the installer version and updater result to distinguish test builds.

## 3. Build the newer version with the same key

Change only `version` in `.release.local/updater-test.json` from `1.2.2` to
`1.2.3`, then build again:

```powershell
npm run tauri:build -- --config .release.local/updater-test.json --bundles nsis -- --locked
if ($LASTEXITCODE -ne 0) { throw 'Build failed; stop here.' }
$installer = Get-ChildItem 'src-tauri/target/release/bundle/nsis/*-setup.exe' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item -LiteralPath $installer.FullName '.release.local/update-test/update.exe'
$signature = Get-Content -Raw -LiteralPath "$($installer.FullName).sig"
$manifest = @{
  version = '1.2.3'
  notes = 'Local update verification'
  platforms = @{
    'windows-x86_64' = @{
      url = 'http://127.0.0.1:8765/update.exe'
      signature = $signature.Trim()
    }
  }
} | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $PWD '.release.local/update-test/latest.json'), $manifest, [Text.UTF8Encoding]::new($false))
```

Do not manually install `update.exe`: the older app must download and install it
to prove the updater works. The signature field contains the `.sig` file's text,
not a filename or the public/private key.

## 4. Serve only the test files on this machine

Create `.release.local/update-test-server.mjs`:

```javascript
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const allowed = new Map([
  ['/latest.json', ['latest.json', 'application/json']],
  ['/update.exe', ['update.exe', 'application/octet-stream']],
]);
createServer(async (req, res) => {
  const file = allowed.get(req.url);
  if (!file) { res.writeHead(404); res.end(); return; }
  try {
    const bytes = await readFile(new URL(`./update-test/${file[0]}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': file[1], 'Content-Length': bytes.length });
    res.end(bytes);
  } catch { res.writeHead(503); res.end(); }
}).listen(8765, '127.0.0.1', () => console.log('Local updater test server ready'));
```

Run `node .release.local/update-test-server.mjs` and leave that terminal open.
Visit `http://127.0.0.1:8765/latest.json` in a browser: it should show version
1.2.3 and the installer URL. Nothing is exposed to the public internet.

## 5. Test the real update path

1. Open the installed **older test app**, create a small document, and type a
   distinctive sentence. Save a `.recto` backup, then make another edit.
2. Click **Check for updates**. It must offer version 1.2.3. It must not install
   anything until you click **Install update**.
3. Click **Install update**. Expect download progress, saving, then the Windows
   installer. The app exits and should reopen after installation.
4. Verify your latest sentence, formatting, and document pages survived. Edit,
   save, close, reopen, and export a small PDF.
5. Click **Check for updates** again. It should report the latest version is
   installed. It must not repeatedly offer 1.2.3.

## 6. Verify failure cases

- **Unavailable server:** stop the server with Ctrl+C, then check from the app.
  Expect an error and an editable document; restart the server and retry.
- **Invalid signature:** reinstall the older test version, change the signature
  text in the local manifest, and try updating. Installation must fail, leaving
  the older app and document intact. Restore the original signature afterwards.
- **Changed download:** after making a backup copy, replace the served installer
  with different bytes without changing its signature. Installation must fail.
  Restore the original file before testing further.
- **No newer release:** serve a manifest whose version equals the installed app.
  The checker should say the app is current.
- **Saving failure:** automated tests cover preventing installation when autosave
  fails. Do not intentionally damage real publication storage to test this.

Record the starting/ending version and pass/fail for each case. An available
update alone does not prove download, signature verification, installation,
restart, or document recovery.

Restart the test app between failure cases so it checks the restored manifest
again. If Windows refuses to install the older test version, export your test
document, uninstall **only Recto Studio Update Test**, and reinstall the older
test installer. Keep the normal Recto Studio installation in place.

## 7. Before the eventual public release

Configure GitHub Actions repository secrets `TAURI_SIGNING_PRIVATE_KEY` and,
if applicable, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, using this same key. Increase
the real application version consistently in the JS/Rust/Tauri manifests and
lockfiles. Build with the normal configuration, with no local test override.
Confirm the draft release contains the installer, `.sig`, `latest.json`, portable
ZIP, and checksums. Check the manifest points at that exact versioned installer.
Publish only after native verification passes and publication is authorized.
Perform a final upgrade using the normal HTTPS release endpoint.

Existing public 1.2.1 users still need one manual upgrade to the first
updater-enabled release. Subsequent updates can happen in the app.
