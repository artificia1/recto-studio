# Recto Studio 1.4.0

Translation editions, accessible reading order, and editorial review for books, magazines, and other publications.

## Downloads

- **Windows x64** — NSIS installer and portable ZIP. The installer can bootstrap WebView2. Existing updater-enabled installations can check for the signed update in Recto.
- **Linux x64** — Debian package and AppImage. Install the Debian package with your package manager or mark the AppImage executable before launching it. Linux updates use these downloads.
- **Source** — ZIP and tar.gz archives. See DESKTOP.md for native build prerequisites.
- **Verification** — SHA256SUMS.txt covers the downloadable artifacts. The Windows updater uses the installer signature and latest.json.

## Translation and editorial review

- Exchange selected stories, parent-page text, notes, table cells, and image descriptions through XLIFF 2.0. Review returned translations with inline formatting, notes, references, and publication fields preserved.
- Check terminology, locale-formatted numbers, and inconsistent repeated copy. Reuse approved plain-text translations, export outstanding units, and share a bilingual review.
- Compare composed source and target frames, check overset and font coverage, and save an independent editable edition.
- Capture a layout comparison point to see changes in paragraph placement, footnotes, page count, and trim. Use the same comparison in manuscript and font replacement previews.
- Save house style rules and apply selected wording and spacing fixes in a single undo step.

## Accessibility and delivery

- Set reading order from the numbered page map or with keyboard controls. Group frames across pages, edit image descriptions and heading roles, link captions, and review table headers.
- Preview the reading sequence in Recto. Tagged PDF, reflowable EPUB, and fixed-layout EPUB use the authored order within each page. Fixed-layout EPUB supports content-sized tables, including continuations and merged cells.
- Preview manuscript revisions, continue footnotes across linked frames, and deliver interior and cover PDFs, reflowable EPUB, and a report in one book package. Chapter refresh checks whether revised pagination changes an approved cover.
- Share stories across editable layout sizes, and apply non-destructive image adjustments, hatching, mesh fills, and patterned strokes.

## Import and performance

- IDML import preserves supported paragraph-style inheritance and uses all four corners to calculate rotated frame bounds.
- The multi-spread overview reuses its grid and checks nearby rows during scrolling. Toolbar export handlers load when invoked.

---

# Previous release: Recto Studio 1.3.2

Colour-managed publishing, shared manuscripts, improved runaround and academic references for Windows and Linux.

## Desktop downloads

- Windows x64: installer EXE and portable ZIP. WebView2 is required; the installer can bootstrap it.
- Linux x64: Debian package and AppImage. Install the Debian package with your package manager to resolve dependencies; mark the AppImage executable before launching it.
- Source ZIP and tar.gz contain the tagged project source. Development builds require Node.js, Rust and the native prerequisites described in DESKTOP.md.
- SHA256SUMS.txt lists release asset checksums. The Windows installer also has an updater signature and a latest.json update manifest. Linux updates remain manual in this release.

## Colour management

- Added a real LittleCMS WebAssembly engine, loaded on demand in a worker.
- Import a printer-supplied CMYK ICC v2/v4 output profile in Setup → ICC colour management. Profile names alone do not perform conversions. The selected profile is stored with the document.
- Perceptual, relative colorimetric, saturation and absolute colorimetric intents; optional black-point compensation and exact-black preservation.
- Managed PDF export converts supported sRGB raster assets and vector RGB colours into output CMYK and embeds the actual ICC profile in an OutputIntent. Explicit CMYK values remain unchanged. Raster transparency is preserved as a soft mask.
- Profile validation, conversion size limits, bounded worker requests and timeouts protect imports and keep expensive conversions off the interface thread.

## Ink preview

- Setup → Separations preview samples the visible artwork without selection handles or guides. Toggle C, M, Y and K independently and set the TAC warning threshold from 100–400%.
- The preview uses the imported ICC profile when available; otherwise it clearly identifies approximate CMYK conversion.
- Named spot isolation follows painted artwork, paths, text and image alpha rather than highlighting frame rectangles.
- This is a composite simulation, not a RIP proof. It cannot recover original CMYK separations or certify trapping, knockout, overprint or finishing interactions. Verify final plates with the printer.

## Text layout and long documents

- Arbitrary Bézier, rotated-object and cropped-image-alpha runaround share the same geometry in manuscript flow, canvas rendering and PDF output.
- Trace image transparency from the Inspector with a configurable alpha threshold and wrap gutter. Replacing an image clears stale contour metadata.
- Fixed contour edge sampling, incomplete last rows and overlapping obstacles that previously produced incorrect available line widths.
- Concordance-driven indexing marks matching manuscript occurrences in one undoable batch while preserving inline formatting. Supports nested topics, See/See also targets, duplicate suppression and page ranges.
- Footnotes wrap within columns and reserve the maximum note stack, with matching positions and separator rules in canvas and PDF. Notes larger than the available layout still require editorial adjustment.
- Existing dynamic contents, note numbering and page references continue to refresh after document changes.

## Collaboration

- Replaced whole-element last-writer updates with a Yjs shared-document engine. Character edits merge independently from geometry, typography, styles and document settings.
- Shared collections use stable object identities and deletion markers. Repeated updates are idempotent, and late peers receive the original baseline plus accumulated operations.
- Undo affects local operations rather than reverting another participant's changes. Local viewport and selection remain local.
- Baseline checks prevent late initial synchronization from overwriting new work. Invalid shared edits are rejected and the replica is restored from its last validated checkpoint.
- All participants must use 1.3.2 or newer. Sessions remain peer-to-peer; persistent hosted rooms, offline reconnection history and shared cursor positions inside text are not included.

## PDF resources and accessibility groundwork

- Fixed spot /Separation colour spaces being written outside the PDF Resources dictionary; inherited master artwork is included.
- The tagged screen preset writes a connected StructTreeRoot, parent tree, document language, reading order and ActualText, with alternate text for described images.
- These changes do **not** certify PDF/X or PDF/UA compliance. Complete table/link/form tagging, font and glyph guarantees, external conformance validation and PDF/X-1a transparency flattening remain unfinished. Use an independently validated production workflow when those standards are required.

## Compatibility

- Existing documents can be opened without selecting an ICC profile. New colour and contour settings persist in saved projects and support undo.
- Large optional panels, the colour engine and the collaboration engine load on demand. The existing compressed startup size limit is retained.
- Headless publishing receives the same finalized PDF resources as desktop and browser downloads.
- Project planning, private signing keys, local release tools and generated build artifacts are excluded from the source archive.

---

# Previous release: Recto Studio 1.3.1

Expanded publishing workflows for books, magazines, editorial layouts and marketing documents, with Windows and Linux desktop packages.

## Downloads
- **Windows x64 setup.exe**: recommended installer, including shortcuts and a WebView2 bootstrapper when needed.
- **Windows x64 portable ZIP**: extract and run Recto Studio.exe; requires WebView2.
- **Linux x64 .deb**: install with `sudo apt install ./Recto-Studio-1.3.1-Linux-x64.deb` to resolve dependencies.
- **Linux x64 AppImage**: run `chmod +x Recto-Studio-1.3.1-Linux-x64.AppImage`, then launch. Some distributions require FUSE compatibility packages.
- **Source code ZIP / tar.gz**: tagged source supplied by GitHub. See DESKTOP.md for Node.js, Rust and native build prerequisites.
- **SHA256SUMS.txt**: checksums for downloadable assets.

Linux packages are built on Ubuntu 22.04 for x86-64 systems with WebKitGTK 4.1 support. ARM builds are not included.

## Books and manuscripts
- Self-contained .rectobook chapter archives, chapter ordering, right-hand openings and continuous pagination.
- Chapter style synchronization, unified contents export and combined PDF containing actual chapter artwork.
- Paragraph style inheritance, local overrides, cycle protection and portable style sets.
- Complete-manuscript Find/Change with style filters, overset-text coverage and formatting-preserving undoable replacement.
- Fiction, nonfiction and editorial starters, publication outline, story navigation and printed-page lookup.
- Anchored notes, live heading references, contents, indexes and reviewed Table of Authorities suggestions.

## Proposed manuscript revisions
- Story Editor → Proposed revisions captures a selection or insertion point, reviewer, replacement and review note.
- Compare original and proposed passages, then accept or reject; acceptance reflows the story and supports undo.
- Pending proposals remain outside publication output. Changed originals and locked stories block acceptance.
- Pages → Manuscript revisions locates pending edits, opens their stories and rejects orphaned proposals.
- Review records persist in project files and book chapter snapshots. Ordinary typing continues to edit directly.

## Tables and catalog production
- Quoted CSV/TSV table import and horizontal cell merging that retains text.
- Opt-in Fit rows to content wraps cells and continues whole measured rows through linked frames, reserving repeated headers and footers.
- Add continuation page appends a linked frame in one undo step.
- Cell and shared-style edits from a continuation update canonical data and respect whole-thread locks.
- Preflight and PDF export detect rows that cannot fit and hidden or excluded continuations.
- Scalar JSON/CSV merge, reviewed data refresh and unique frame/group identities per generated record.

## Layout, typography and artwork
- Multi-spread spatial workspace, drag scrolling, cross-page movement and saved pasteboard objects.
- Numerical alignment/spacing, flat grouping, rotated bounds and locked-group protection.
- Cascading master inheritance, source-item editing and descendant updates.
- Font-source auditing, local font import, document-wide replacement and variable-font axes.
- Grapheme-aware wrapping, horizontal CJK punctuation rules and publication language metadata.
- Object Multiply, Screen and Overlay, consistent opacity and live ordinary-PDF blend states.
- Focal-point cropping, editable vector equation objects and bounded ornamental patterns.

## Export and reliability
- Screen, desktop-print and printer-review PDF presets plus downloadable publication reports.
- EPUB navigation, note links, image descriptions and embedded assets; searchable Unicode PDF text for supported embedded static TTF fonts.
- Improved structured IDML character formatting import and safer SVG/XML ingestion.
- Bounded native reads, contained chapter paths and safer export archives.
- Fixed stale Story Editor reopening, continuation-table edits, review-note spread identities and template undo history.
- Pages, Links, table controls and the desktop updater now load on demand to meet the existing startup bundle budget.

## Updating and current limits
Updater-enabled Windows installations can use Check for updates after the signed installer and latest.json are published. Pending work is saved before installation. Updater signatures are separate from publisher code signing; Windows may still show a reputation warning. Linux packages are installed manually; this release does not advertise Linux auto-updates.

Book chapters need matching page sizes and bleed. Individual table rows must fit in one frame; row splitting and vertical merges remain pending. Explicit revision proposals support 100 records per document and manuscripts up to 200,000 characters; automatic inline change tracking is not included.

INDD provides conversion and explicitly labelled content recovery. Faithful standalone INDD decoding and complete IDML fidelity are not implemented. PDF presets and CMYK operators do not certify PDF/X, PDF/A or PDF/UA compliance. Review production output with the intended printer and readers.
