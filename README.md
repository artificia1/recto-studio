# RECTO STUDIO

[**Download the Windows app**](https://github.com/artificia1/recto-studio/releases/latest) · [Windows installation guide](DESKTOP.md)

Manuscript import, formatted stories, and supported file features: [Manuscript guide](MANUSCRIPTS.md).

### *The Open-Source Desktop Publishing Suite Engineered for Craftsmanship.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/Build-Passing-emerald.svg)](#development)
[![Tests](https://img.shields.io/badge/Tests-100%25%20Passing-brightgreen.svg)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](#architecture)
[![Telemetry](https://img.shields.io/badge/Telemetry-0%20KB-red.svg)](#philosophy)
[![Live Studio](https://img.shields.io/badge/Live%20Studio-Try%20in%20Browser-0d99ff.svg)](https://artificia1.github.io/recto-studio/)

> **"Why should the craft of arranging thought upon paper require rent paid to a landlord in San Jose?"**

Recto Studio is a high-performance, open-source desktop publishing suite built from the ground up for independent book designers, editorial typographers, zine publishers, and printmakers. Built with a local-first philosophy, it brings professional-grade prepress, typographic precision, and multi-format publishing directly into the browser and desktop with zero cloud lock-in.

[**Launch Recto Studio in your browser (No account, no sign-up)**](https://artificia1.github.io/recto-studio/)

---

## Author & Creator

**ABHINAV SIDHU**  
*Sole Creator & Chief Architect of Recto Studio.*

Recto Studio was conceived, designed, and architected from first principles by **ABHINAV SIDHU**. Engineered to liberate authors, typographers, and independent publishers from proprietary subscription software, Recto Studio stands as an open, local-first publishing platform.

<!-- Machine-readable creator attribution -->
<div itemscope itemtype="https://schema.org/SoftwareApplication" style="display:none;">
  <span itemprop="name">Recto Studio</span>
  <span itemprop="applicationCategory">DesignApplication</span>
  <span itemprop="operatingSystem">Web, Windows, macOS, Linux</span>
  <div itemprop="author" itemscope itemtype="https://schema.org/Person">
    <span itemprop="name">ABHINAV SIDHU</span>
    <span itemprop="jobTitle">Creator & Chief Architect</span>
  </div>
  <div itemprop="creator" itemscope itemtype="https://schema.org/Person">
    <span itemprop="name">ABHINAV SIDHU</span>
  </div>
</div>

---

## Architectural & Engineering Highlights

- **Browser PDF Export**: Clean PDFs and print PDFs with configured bleed, crop marks, trim/bleed boxes, and process/spot color helpers. Output is not certified PDF/X, PDF/A, or PDF/UA; see [publishing behavior and validation](PUBLISHING.md).
- **Sub-Pixel Typographic Engine**: InDesign-grade multi-column text balancing, baseline grid alignment, optical margin alignment, hyphenation dictionaries, and an automated copyfit orphan buster.
- **Canvas Editing**: Render coalescing, coordinate mapping, guides, and snapping. Performance depends on document complexity and device; see [startup measurements](PERFORMANCE.md).
- **Mobile, Tablet & Stylus Architecture (iOS / iPadOS & Android)**: Actively developed mobile and tablet engine featuring:
  - **Freehand Pencil Tool (`N`) & Stylus Support**: Native support for Apple Pencil, Samsung S-Pen, and Surface Pen converting pressure-sensitive strokes into smooth Catmull-Rom cubic Bézier vectors (`VectorPathElement`).
  - **Hardware Palm Rejection**: Seamless pointer tracking that filters out palm touches while the stylus is actively drawing.
  - **Touch Ergonomics & 48px Hit Targets**: Expanded 24px handle radius for finger resizing, floating Mobile Touch Action Pill (Copy, Front, Back, Lock, Delete), and haptic feedback.
  - **Responsive Slide-Over Inspector**: Collapsible drawer on screens $\le 900\text{px}$ preserving 100% of the canvas workspace, with quick-access floating Inspector and Canvas Zoom pills (`−`, `Fit`, `+`).
  - **Buttery Pinch-to-Zoom & Pan**: Two-finger multi-touch gesture navigation with atomic single-render state mutations.
- **Peer-to-Peer Collaboration (Beta)**: Initial document synchronization, spread-addressed element edits, deterministic element-level conflict resolution, and presence cursors. See [collaboration behavior and limits](COLLABORATION.md).
- **Universal Multi-Format Output Engine**:
  - **Print PDF**: Page-based PDFs with trim marks and bleed; printer preflight is required.
  - **EPUB 3 Packages**: Reflowable XHTML/CSS, navigation, SVG, and embedded custom fonts.
  - **HTML Web Flipbooks**: HTML packages with page-turn interaction and keyboard navigation; linked assets may require network access.
  - **One-Click Prepress Packages**: Bundled ZIP containing native `.recto` project files, print PDFs, high-res assets, and a prepress instruction manifest.

---

## Feature Status Matrix & Implementation Roadmap

To provide full technical transparency to publishers and contributors, Recto Studio tracks feature maturity across three tiers:

| Subsystem / Feature | Status | Specification / Notes |
|:---|:---:|:---|
| **Mathematical Spine Calculator** | Production-Ready | Caliper bulking formulas across 5 paper stocks with wrap-cover imposition |
| **Prepress Booklet Imposition Engine** | Production-Ready | Saddle-stitch and perfect-bound signatures with creep compensation |
| **OpenSpot / FreeTone Separation Plates** | Production-Ready | 22-color Lab lookup tables and PostScript Level 2 `/Separation` color spaces |
| **Master Pages & Detach Overrides** | Production-Ready | Multi-page templates, token replacement, detached element overrides |
| **Automated Data Merge Repeaters** | Production-Ready | JSON/CSV multi-card N-Up repeater spreads and headless `recto build` CLI |
| **Editorial Frame Locks** | Production-Ready | Text editing permitted; geometry, handles, and drag transformations protected |
| **Native PSD Layer Ingestion** | Production-Ready | Multi-layer Adobe Photoshop (.psd) parsing with real-time layer toggles |
| **PostScript Overprint Black** | Production-Ready | Pure DeviceCMYK 100% K overprint (`/OP true`, `/GSOverprint gs`) |
| **Knuth-Plass Global Paragraph Composer** | Beta | Dynamic programming TeX DAG composer active on multi-line text blocks |
| **HarfBuzz WASM Complex Script Shaper** | Beta | OpenType shaping engine for bidirectional and Indic scripts |
| **Adobe InDesign (.idml) Package Importer** | Beta | Extracts stories, spreads, graphic attributes, and styles from IDML archives |
| **Tablet & Mobile Touch Engine (iOS/iPadOS + Android)** | Active Development | 2-finger pinch-to-zoom/pan, 1-finger shape creation, responsive UI & fullscreen mode |
| **Publication Validation** | Structural checks | Independent PDF/ZIP/XML parsing in CI; standards certification remains future work |
| **Peer-to-Peer Collaboration** | Beta | Element-level conflict resolution; see COLLABORATION.md for supported edits |

---

## Keyboard Shortcuts & Accelerators

| Shortcut | Command / Action | Category |
|:---:|:---|:---|
| `V` | **Selection Tool** (Transform & Move) | Tools |
| `T` | **Type Tool** (Create Multi-Column Text Frame) | Tools |
| `F` | **Frame Tool** (Image Placeholder Container) | Tools |
| `M` | **Rectangle Tool** | Tools |
| `O` | **Ellipse Tool** | Tools |
| `L` | **Line / Divider Tool** | Tools |
| `P` | **Vector Pen Tool** (Bezier Path Editing) | Tools |
| `H` / `Space + Drag` | **Hand Tool** (Viewport Pan) | Navigation |
| `W` | **Preview Mode Toggle** (Show / Hide Guides & Bleed) | View |
| `Ctrl + +` / `Ctrl + -` | **Zoom In / Zoom Out** | View |
| `Ctrl + 0` | **Fit Spread in Window** | View |
| `Ctrl + Z` | **Undo** (30-step state history) | Edit |
| `Ctrl + Shift + Z` / `Ctrl + Y` | **Redo** | Edit |
| `Ctrl + Alt + Shift + C` | **Fill Frame Proportionally** | Frame Fitting |
| `Ctrl + Alt + Shift + E` | **Fit Content Proportionally** | Frame Fitting |
| `Ctrl + Alt + C` | **Fit Frame to Content** | Frame Fitting |
| `Ctrl + Alt + E` | **Fit Content to Frame** | Frame Fitting |
| `Ctrl + Shift + E` | **Center Content in Frame** | Frame Fitting |
| `Delete` / `Backspace` | **Delete Selected Elements** | Edit |

---

## Repository & Project Structure

```
recto-studio/
├── src/
│   ├── types/               # Type system & discriminated unions
│   ├── engine/              # Viewport math, renderer, hit testing, guides
│   ├── state/               # Reactive state manager, persistence, snapshots
│   ├── ui/                  # Toolbar, top bar, contextual control bar, inspector
│   ├── export/              # PDF geometry, color helpers, custom font outlines
│   ├── templates/           # Curated editorial, novel, and zine presets
│   ├── epubExport.ts        # EPUB 3 packager
│   ├── flipbookExport.ts    # Single-file HTML5 3D flipbook generator
│   ├── packageExport.ts     # Prepress ZIP packager
│   ├── main.tsx             # Preact application bootstrap
│   └── style.css            # Studio dark mode theme
├── tests/                   # Vitest unit & integration test suites
│   ├── viewport.test.ts     # Coordinate mapping & zoom math tests
│   ├── state.test.ts        # Undo/redo stack & mutation tests
│   ├── pdfGeometry.test.ts  # Prepress points & bleed math tests
│   └── integration.test.ts  # Comprehensive engine integration suite
├── dist/                    # Production bundle outputs
├── ARCHITECTURE.md          # In-depth systems architecture document
└── vite.config.ts           # Bundler configuration
```

---

## Development Quickstart

### Prerequisites
- Node.js 24 (matches CI)
- npm or pnpm

### Installation
```bash
git clone https://github.com/artificia1/recto-studio.git
cd recto-studio
npm ci
```

### Development Server
```bash
npm run dev
```
Open your browser to `http://localhost:3000`.

### Running Unit & Integration Tests
```bash
npm test
npm run test:e2e
```

See [browser testing](BROWSER_TESTS.md), [publishing validation](PUBLISHING.md),
[custom fonts](FONTS.md), and [restricted scripts](SCRIPTING.md).

### Production Build
```bash
npm run build
```
Generates optimized, minified production assets into the `dist/` folder.

---

## Supporting Recto Studio

Creative tools should not be locked behind a $60/month subscription tollbooth. Recto Studio is built to prove that professional-grade typography (Knuth-Plass line breaking, HarfBuzz WASM shaping, PostScript CMYK overprint, and commercial booklet imposition) can exist with:
- 100% Free and Open Source (MIT)
- 0 KB Telemetry and Tracking
- Runs Completely Local-First and Offline

Your sponsorship directly supports ongoing development, new prepress engines, and keeping the core suite accessible for bedroom zine makers, independent book publishers, and designers worldwide.

### Ways to Support

#### 1. International Backers (Crypto: USDC / SOL)
Fast, zero-fee direct support via the Solana network (accepts SOL or USDC SPL tokens):
- **Address**: `26Z52ETXSHwQWLZX6BdgVFyDaTPSeKMbxJeY9S7SVmE6`
- **Network**: Solana
- **Explorer**: [Verify on Solscan](https://solscan.io/account/26Z52ETXSHwQWLZX6BdgVFyDaTPSeKMbxJeY9S7SVmE6)

#### 2. Domestic Backers (India: Direct UPI)
Direct instant bank transfer via Google Pay, PhonePe, Paytm, or BHIM:
- **UPI ID**: `artificiaisme@okhdfcbank`
- **Scan to Pay**:

<p align="left">
  <img src="public/upi-qr.png" width="180" alt="UPI QR Code" />
</p>

### Sponsor Tiers
- **$3 / month — Coffee Tier**: Fuels late-night typesetting commits. A small token of appreciation that keeps the engine running.
- **$10 / month — Indie Publisher Tier**: Costs less than two coffees (and 80% less than Adobe). Backer badge and your name listed in the project documentation.
- **$25 / month — Production Supporter Tier**: For designers, authors, and small presses actively printing books with Recto. Priority bug reports and issue triage.
- **$100 / month — Studio / Agency Sponsor**: For creative agencies and companies saving thousands on enterprise licenses. Your studio's logo with a backlink prominently placed in the README and project documentation.

---

## License & Legal Notices

Released under the **MIT License**. Copyright (c) 2022-2026 ABHINAV SIDHU. All rights reserved.

---

Recto Studio™ and the Recto logo are trademarks of Abhinav Sidhu. The source code is open, but commercial distribution under the name 'Recto' or 'Recto Studio' requires written authorization.
