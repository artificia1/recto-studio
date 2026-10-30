# Changelog

All notable changes to **Recto Studio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.3] - 2026-10-31

### Added
- Paragraph keep rules, widow/orphan controls, and English/German/French dictionary hyphenation for formatted stories.
- Paragraph font emphasis controls and EPUB language/flow hints.

### Fixed
- Retain the previous font when a new font cannot load; report failures in the style editor.
- Verify the native application version in desktop release checks.

## [1.2.2] - 2026-10-31

### Added
- Signed in-app updates with save-before-install protection.
- Automatic story extension, paired facing spreads, chapter openings, sections, and running headers.

### Fixed
- Responsive footer spacing and mobile controls covering status information.
- Keep generated pages with their chapter and preserve the current spread during pagination.
- Select the Windows installer matching the release version instead of a cached older installer.

## [1.2.1] - 2026-10-30

### Fixed
- Clear text-frame selection when clicking empty canvas with the text tool.
- Fit text frames using measured layout instead of character-count estimates, preserving space for legacy typography.
- Expand standalone text frames after auto copyfit when necessary to avoid clipping.

## [1.2.0] - 2026-10-30

### Added
- Standalone Windows application, setup program, portable package, and application icons derived from the existing Recto logo.
- Native document Open/Save and export dialogs with atomic file replacement.
- Formatted stories, reusable character styles, and Word/Markdown import previews with style mapping.
- Windows release builds with native runtime checks and download checksums.

### Fixed
- Preserve paragraph boundaries and copy across text frame linking, deletion, editing, and save/reopen.
- Keep browser publishing workflows available alongside the desktop edition.

## [1.1.0] - 2026-10-29

### Added
- **ISO/IEC 18004 Model 2 Native Vector QR Code Engine**:
  - Standards-compliant QR matrix generation engine replacing pseudo-random fallback.
  - Multi-tier Reed-Solomon Error Correction Codewords (Low, Medium, Quartile, High).
  - Valid version and format information string encoding with ISO-standard 4-module quiet zones for instant mobile scanner acquisition.
  - Pure SVG vector and print-ready DeviceCMYK/RGB stream outputs.
- **Adobe InDesign IDML Graphic & Swatch Fidelity Engine**:
  - Full swatch extraction from `Resources/Graphic.xml` supporting CMYK, RGB, Process, Spot, and Tint definitions.
  - Preserves container background fill colors (`FillColor`, `FillTint`) and border strokes (`StrokeColor`, `StrokeWeight`, `StrokeTint`) for text frames, rectangles, and ovals.
  - Story character-level formatting extraction (`<CharacterStyleRange>`) mapped to story colors and `grepStyles` runs, rendering multi-colored words (pink, cyan, green) on the same line.
  - InDesign vertical frame alignment (`VerticalJustification="CenterAlign"` -> `middle`, `BottomAlign` -> `bottom`) with automatic canvas centering.
  - Contrast-aware dark background detection (`isDarkColor`) automatically inverting text color to white (`#ffffff`) over dark containers.
- **Asset Intelligence & Broken Link Recovery**:
  - Robust broken/missing image detection (`failedImageSrcs`) replacing perpetual "Loading display proxy..." canvas freeze.
  - Renders InDesign-style crossed diagonal frames with prominent `[Missing Link: <filename>]` badges and relink drop prompts when linked raster files are unbundled.
- **Mobile, Tablet & Stylus Touch Superpowers**:
  - Pressure-sensitive stylus pencil tool with quadratic Bézier smoothing and hardware palm rejection (`pointerType === 'pen'`).
  - Two-finger pinch-to-zoom, pan gesture inertia, and multi-touch shape drawing.
  - Responsive UI adaptation: touch quick actions toolbar automatically hidden on desktop/mouse configurations for zero UI clutter, with manual toggle in View menu.
  - Optimized `requestAnimationFrame` render pipeline eliminating touch latency and frame drops.
- **Visual Prepress Intelligence & Plate Control**:
  - Total Area Coverage (TAC) heatmap overlay highlighting over-inked press zones (>300% TAC).
  - Typographic linter detecting loose lines, tight lines, double spaces, and repeated words.
  - Single-click spot color plate soloing and ink separation preview.
  - Thread vector restitching and InDesign-style empty-space outport click-to-link workflow.
- **InDesign Parity & Document Preferences**:
  - Native Adobe InDesign `.indd` binary document ingestion with deep XMP stream metadata extraction.
  - Document Setup & Preferences modal (`Alt+Ctrl+P`) with live spread geometry and margin adjustments.
  - Live GREP style automation, contour alpha channel text wrapping, and Tauri desktop file associations (`.recto`, `.idml`, `.indd`).
  - Dynamic Anchored Objects, Split Columns, Scripting Panel, and Conditional Text.

### Changed & Fixed
- **UI Aesthetics & Typography Polish**:
  - Resolved topbar title overlap and control bar input clipping across all viewport widths.
  - Replaced ugly native browser scrollbars with custom sleek dark scrollbars matching Recto Studio aesthetics.
  - Functional Typographic Copyfit Optimizer ("Orphan Buster") button directly integrated into the Contextual Control Bar with live feedback.
  - Purged all informal emojis across the interface in favor of clean, accessible typography and vector icons.
  - Cleaned canvas viewport by removing non-selected frame edge outlines; bounding outlines and handles only appear upon active selection.

---

## [1.0.0] - 2026-10-16

### Added
- **PDF/UA-1 Universal Accessibility**:
  - Full structural tagging tree export (`<Title>`, `<H1>`, `<H2>`, `<H3>`, `<P>`, `<Caption>`, `<Figure>`) mapped from paragraph style semantics.
  - Screen-reader image descriptions (`altText`) for all placed raster and vector graphics.
  - Accessible reading order derived from threaded story flows and spatial z-index hierarchies.
  - Accessibility Inspector preflight drawer validating heading hierarchy levels and flagging uncaptioned images.
- **Typographic Copyfit Optimizer ("Orphan Buster")**:
  - Automatic single/multi-word orphan and widow detection in terminal paragraph lines.
  - Micro-tracking adjustment (0 down to -5) and horizontal glyph scaling (98%–100%) to absorb rogue terminal lines.
  - Balanced Columns engine for multi-column text frames ensuring all columns terminate on identical baseline grid coordinates.
- **Automated Footnotes & Dynamic Running Headers**:
  - Footnote reference marker insertion (superscript `¹`, `²`, `³`) with bottom-column space reservation.
  - Dynamic separator rules and page-anchored footnote text blocks.
  - Continuous footnote renumbering across complex threaded text frames.
  - Running headers with token replacement (`{{page}}`, `{{totalPages}}`, `{{chapterTitle}}`) resolving dynamically to the active section heading.
- **One-Click Prepress Packaging**:
  - Client-side `.zip` package generation bundling `.recto` source JSON, print-ready PDF/X-1a, high-res assets, and `Instructions.txt` prepress report.
- **Dynamic Font Management**:
  - Live Google Fonts engine with search and on-demand browser caching for 1,600+ typefaces.
  - Drag-and-drop custom font loader supporting `.woff2`, `.ttf`, and `.otf` files registered via the browser `FontFace` API.
- **Hierarchical Layers & Prepress Links**:
  - Multi-layer management panel with custom layer colors, lock/hide toggles, and z-index reordering.
  - Layer-colored canvas selection bounding boxes and handle rendering.
  - Dedicated Links tab reporting image resolution, missing files, color spaces, and live asset relinking.
- **Collaboration & Extended Formats**:
  - Contextual Control Bar dynamically adapting to selected tool and element types.
  - Real-time P2P WebRTC collaboration with live presence cursors and shared state.
  - Fixed-layout EPUB 3 export with embedded CSS and audio/video markup.
  - Interactive HTML5 Flipbook export with realistic 3D page turning physics.

### Changed
- Refactored core architecture into isolated, high-cohesion modules:
  - `src/engine/` (viewport transform, spatial hit-testing, alignment guides, canvas renderer).
  - `src/types/` (strict domain entities and interfaces).
  - `src/state/` (single-source-of-truth state manager and LocalStorage persistence).
  - `src/export/` (PDF/X and print packaging pipelines).
- Replaced emoji indicators in UI controls with accessible, clean text badges.
- Updated TopBar layout with consolidated `Import ▾` and `Export PDF ▾` dropdown menus to prevent viewport clipping.

---

## [0.9.0] - 2025-08-14

### Added
- **Real-Time Collaboration Engine**:
  - Conflict-free Replicated Data Type (CRDT) document synchronization for zero-conflict concurrent editing.
  - Presence tracking system displaying remote collaborator cursors, names, and active selections in distinct hues.
- **Version History & Snapshots**:
  - Automated point-in-time snapshot engine capturing full project states on significant edits.
  - Visual timeline browser allowing instant rollback and diff inspections between revisions.

### Fixed
- Resolved edge-case race conditions where simultaneous element property edits could overwrite adjacent canvas coordinates.

---

## [0.8.0] - 2024-11-15

### Added
- **Vector Pen Tool & Bézier Paths**:
  - Full-featured pen tool supporting cubic and quadratic Bézier curve generation, anchor manipulation, and path closing.
  - Smooth vs. corner point toggling with independent directional handle dragging.
- **Text Wrap Collision Engine**:
  - Vector contour text wrap engine calculating collision hulls around irregular graphics and text frames.
  - Configurable wrap offset margins (top, bottom, left, right) with support for jump-object and wrap-around modes.
- **Table Frames**:
  - Grid-based table layout engine with row/column insertion, deletion, and interactive border resizing.
  - CSV and spreadsheet data import directly into formatted table frames.

### Performance
- Optimized canvas redraw loops by implementing bounding-box spatial partitioning, reducing dirty-rect calculations on complex vector paths.

---

## [0.7.0] - 2024-02-27

### Added
- **Contextual InDesign Control Strip**:
  - Secondary top control bar exposing context-sensitive typography, geometry, and styling controls based on active selection.
- **Advanced Frame Fitting Modes**:
  - Five standard frame fitting algorithms: Fit Content to Frame, Fit Frame to Content, Fill Frame Proportionally, Fit Content Proportionally, and Center Content.
- **Optical Margin Alignment**:
  - Hanging punctuation engine shifting quotation marks, hyphens, and bullet glyphs outside the text frame boundary for optical alignment.

### Changed
- Standardized all coordinate system transforms to preserve high floating-point precision across deep zoom scales (5% to 3200%).

---

## [0.5.0] - 2023-11-09

### Added
- **Baseline Grid Alignment**:
  - Global and document-level baseline grid overlay with configurable intervals (e.g., 12 pt, 14 pt) and start offsets.
  - Paragraph style toggle to snap baseline positions directly to the grid.
- **Drop Caps Engine**:
  - Multi-line drop cap styling with configurable character count and line height calculation.
- **OpenType Typography Features**:
  - Support for discretionary ligatures, contextual alternates, fractions, and tabular lining figures.
- **Styles Hierarchy**:
  - Centralized Paragraph and Character style management with inheritance chains and property overrides.

---

## [0.3.0] - 2023-04-14

### Added
- **Multi-Element Selection & Alignment**:
  - Canvas marquee drag-selection with shift-click additive selection.
  - Spatial alignment palette: align left, horizontal center, right, top, vertical center, bottom.
  - Equal distribution tools for uniform horizontal and vertical spacing.
- **Grouping Architecture**:
  - Multi-element grouping and nested group hierarchies with unified transform bounding boxes.
- **Snapping & Smart Guides**:
  - Real-time magnetic snapping to element edges, centerlines, page margins, and column gutters.

---

## [0.1.0] - 2022-07-12

### Added
- **Core 2D Canvas Engine**:
  - Hardware-accelerated 60 FPS HTML5 Canvas renderer with pan, zoom, and smooth camera transitions.
  - High-precision physical millimeter-to-screen coordinate mapping via `ViewportManager`.
- **Document Model**:
  - Multi-page document architecture with custom page dimensions, margins, slug, and bleed specifications.
  - Standard print presets: A3, A4, A5, US Letter, US Legal, and Tabloid.
- **Fundamental Page Elements**:
  - Rectangular vector shape primitives with stroke and fill properties.
  - Image placement frames with basic scale and translation transforms.
  - Single-column text frames with basic font, size, leading, and alignment controls.
- **Print Export**:
  - Initial vector PDF export pipeline using jsPDF with crop marks and bleed boundaries.
