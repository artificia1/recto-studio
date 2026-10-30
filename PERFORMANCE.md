# Startup performance

This report measures the production build, including scripts referenced directly by
HTML and all static dependencies of the entry module. Deferred tools still have
to be downloaded when first used.

## Measured change

Local production builds on Windows with Node 24.18, using the same installed
dependencies:

| Startup JavaScript | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Minified bytes | 1,604,272 | 766,290 | 52% |
| Gzip bytes | 486,353 | 219,031 | 55% |

The baseline consisted of a 1,239,809-byte application bundle plus a
364,463-byte vendored jsPDF script. The new build loads one application bundle
initially. Gzip figures are calculated locally, not observed network transfer;
actual compression depends on the hosting server.

PDF, EPUB, flipbook, IDML export, document packaging, booklet imposition, cover
design, InDesign import, and manuscript import load through dynamic imports.
The duplicate HTML jsPDF script is no longer loaded. Table rendering shares
lightweight PDF color helpers without importing the PDF generator. Existing
PDF helper exports remain available for callers.

Print dialogs show loading/cancel and failure/close states. Export loading errors
are shown without replacing the document. Drag-and-drop import failures are also
reported. Existing font decoding, collaboration, and script-interpreter chunks
remain deferred.

## Repeat the measurements

```sh
npm run build
npm run analyze:bundle
npm run test:e2e
```

`analyze:bundle` reads Vite's manifest and built HTML, follows static imports,
and totals raw and gzip bytes. It exits unsuccessfully above 1,000,000 raw bytes
or 300,000 gzip bytes. CI checks this budget after every build. The budget leaves
headroom for editor development while detecting a return to eager PDF loading.

The startup browser test logs `STARTUP_METRICS` using the public Performance API,
checks the initial resource size, and checks that named export/import/print chunks
are absent. Other browser tests open print tools, import manuscripts/IDML, and
download PDF/EPUB files, exercising their first-use loading paths. An aborted EPUB
module request checks failure feedback and document preservation.

Navigation and canvas-observation timings are diagnostic only: a single local
browser run does not establish a speedup. Font blocking, disk caches, host load,
browser instrumentation, and document size affect results. No claim of faster
canvas rendering, constant frame rate, or large-document speed is made here.

## Remaining work

The editor bundle remains above Vite's 500 kB warning threshold; the warning is
retained. Photoshop support still contributes an eager dependency because current
layer operations use synchronous APIs. Change that boundary only with dedicated
PSD workflow checks. Large-publication layout/render profiling is separate work.
See PUBLISHING.md for independent export validation, publishing limitations, and
the dependency audit enforced by CI.
