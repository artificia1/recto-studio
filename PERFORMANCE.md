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

## Large-publication benchmarks

`npm run benchmark:publications -- --ci` generates a 250-page threaded book and
a 40-page magazine with three raster placements per page. It measures parsing,
composition, preflight, opening, spread navigation, a Story Editor commit and
PDF generation. The same Windows x64 and Node 24.18 setup produced these local
measurements with the original benchmark fixture before and after the changes.

| Operation | Before | After |
| --- | ---: | ---: |
| Open the 250-page book | 7.59 s | 4.49 s |
| Commit a story edit and reflow the book | 7.86 s | 0.27 s |
| Export the 40-page magazine PDF | 62.84 s | 30.24 s |
| Peak benchmark process resident memory | 741 MiB | 727 MiB |

The editor reuses a composed layout when publication references are current.
PDF export reuses raster metadata and image aliases within a single export.
The generated PDFs, timings and editable fixtures are written to
`build/production-benchmark/`. Run `python scripts/validate-production.py` after
installing `pypdf` to check geometry, text and raster placement independently.
Add `--render` with `pypdfium2` and `Pillow` installed to save two rendered samples.

Set `RECTO_MEASURE_PUBLICATIONS=1` when running Playwright against a built editor
to measure project opening, navigation, typing, commit and browser heap usage.
The browser timings are diagnostic. Font loading, host load, caches and document
content affect results. CI saves metrics as an artifact and sets time and memory
ceilings on the standalone benchmark to catch stalled operations.

## Remaining work

The Rust raster module processes larger RGBA buffers one MiB at a time and
caps its WebAssembly memory at three MiB. Tone adjustment, straight-alpha
restoration, ICC sample preparation and compositing onto white share the same
kernels. The app can hand off consumed ICC buffers to its color worker and
releases PDF tile surfaces after each render. Decoded source images still need
their own buffers.

PDF downloads serialize into byte chunks using the existing writers' object
offset and cross-reference calculations. Tagged and press exports parse the
initial render from those chunks and share one PDF object graph through
finalization. PDF.js receives byte ranges for transparency rendering and proof
review. Its worker owns any document-sized buffer required by its renderer.
ZIP packages and headless PDF writers accept the original PDF chunks.
Callers requesting `output('arraybuffer')` receive a contiguous buffer for
compatibility.

Desktop project open and save use one MiB transfers. Project saves serialize
JSON in batches and stage it in a temporary file. Rust checks for external
edits before replacing a bound project. The editor builds and validates the
project object from UTF-8 chunks, including for files opened in the browser.
The parsed project still needs to fit in editor memory. Older desktop shells
support the legacy commands.

To regenerate the bundled raster module, run `rustup target add
wasm32-unknown-unknown` and then `node scripts/build-raster-wasm.mjs`. Normal
web builds use the bundled module.

The editor bundle remains above Vite's 500 kB warning threshold; the warning is
retained. Photoshop support still contributes an eager dependency because current
layer operations use synchronous APIs. Change that boundary only with dedicated
PSD workflow checks. See PUBLISHING.md for independent export validation, publishing limitations, and
the dependency audit enforced by CI.
