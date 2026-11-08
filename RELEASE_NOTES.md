# Recto Studio 1.3.1

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
