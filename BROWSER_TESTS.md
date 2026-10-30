# Browser workflow checks

The browser suite exercises the production build with Playwright. Each test gets
its own browser storage and uses synthetic publications and licensed font fixtures;
it does not touch the user's open publication or browser profile.

All 18 workflows have been verified locally in Edge. The final full run passed
17 cases; after correcting archive entry names in the IDML fixture, that case
passed a focused rerun. Application and test TypeScript checks, production build,
and all 141 engine tests pass. Hosted Chromium verification awaits the next push.

## Run locally

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

On Windows, the installed Edge browser can be used without a browser download:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

The runner serves dist on 127.0.0.1:4179 and closes the server afterward. It refuses
to reuse an existing server, so a test cannot accidentally target another app.
Vitest explicitly excludes e2e files; `npm test` remains the engine/unit suite.

## Coverage

- Application startup and uncaught browser errors.
- Native project import, edits, undo/redo, export, and invalid input rejection.
- Autosave after reload, immediate reload, and IndexedDB recovery when localStorage
  writes fail.
- Canvas rectangle drawing and persistence.
- Quick Apply and Find/Change reopening/focus and text replacement.
- Story Editor synchronization, Escape, and keyboard shortcut separation.
- A real WOFF2 font upload, browser activation, project embedding, and reload.
- Corrupt font rejection without replacing the chosen font.
- Restricted script success and blocked network calls.
- IDML package import, PDF download, and EPUB download.
- Deferred manuscript imports, print-dialog loading, and export module failure feedback.
- Startup resource sizes and absence of deferred tools, with diagnostic timing logs.
- Responsive inspector opening/closing at a 390px viewport.

Remote Google font requests are blocked for deterministic offline checks. Real
font files are uploaded through the same input used by the user. Assertions use
visible controls, downloaded files, and public browser storage/font APIs, not the
editor's debug state manager.

## CI and evidence

GitHub Actions installs Chromium and runs the browser suite after unit tests and
the production build. Browser failures block deployment. Failure screenshots and
traces are retained as workflow artifacts for seven days. Local output goes to
test-results/; those files and playwright-report/ are ignored by Git.

Screenshots of the initial editor, restored custom font, and narrow inspector are
captured for visual inspection. These are not cross-platform pixel baselines.
Firefox, Safari/WebKit, physical touch/stylus devices, live WebRTC networks,
clipboard permissions, and desktop Tauri packaging require additional testing.
