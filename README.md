# ❖ PAPERCUT STUDIO
### *The Open-Source Desktop Publishing Suite Engineered for Craftsmanship.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/Build-Passing-emerald.svg)](#development)
[![Tests](https://img.shields.io/badge/Tests-100%25%20Passing-brightgreen.svg)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](#architecture)
[![Telemetry](https://img.shields.io/badge/Telemetry-0%20KB-red.svg)](#philosophy)

> **"Why should the craft of arranging thought upon paper require rent paid to a landlord in San Jose?"**

Papercut Studio is a high-performance, open-source desktop publishing suite built from the ground up for independent book designers, editorial typographers, zine publishers, and printmakers. Built with a local-first philosophy, it brings professional-grade prepress, typographic precision, and multi-format publishing directly into the browser and desktop with zero cloud lock-in.

---

## ⚡ Architectural & Engineering Highlights

- **Client-Side PDF/X-1a & Tagged PDF/UA Compiler**: Zero-cloud prepress engine generating print-ready PDFs with 3mm bleed, crop marks, spot/process colors, semantic structure trees, and accessible screen-reader tags directly in browser memory.
- **Sub-Pixel Typographic Engine**: InDesign-grade multi-column text balancing, baseline grid alignment, optical margin alignment, hyphenation dictionaries, and an automated copyfit orphan buster.
- **Zero-Allocation Canvas Pipeline**: 60 FPS viewport rendering featuring dual-buffer coordinate mapping, spatial indexing, sub-pixel edge alignment, and magnetic snapping without GC stutter on low-power hardware.
- **Peer-to-Peer CRDT Real-Time Collaboration**: Distributed document synchronization enabling multiple collaborators to co-edit spreads, adjust typography, and see live remote presence cursors across browser tabs or local networks.
- **Universal Multi-Format Output Engine**:
  - **Print PDF**: Native PDF/X-1a with trim marks and bleed.
  - **EPUB 3 Packages**: Semantic reflowable and fixed-layout XHTML/CSS book manifests.
  - **Self-Contained 3D Web Flipbooks**: Single-file HTML5 packages with page-turn physics and keyboard navigation.
  - **One-Click Prepress Packages**: Bundled ZIP containing native `.papercut` project files, print PDFs, high-res assets, and a prepress instruction manifest.

---

## ⌨️ Keyboard Shortcuts & Accelerators

| Shortcut | Command / Action | Category |
|:---:|:---|:---|
| `V` | **Selection Tool** (Transform & Move) | Tools |
| `T` | **Type Tool** (Create Multi-Column Text Frame) | Tools |
| `F` | **Frame Tool** (Image Placeholder Container) | Tools |
| `M` | **Rectangle Tool** | Tools |
| `O` | **Ellipse Tool** | Tools |
| `L` | **Line / Divider Tool** | Tools |
| `P` | **Vector Pen Tool** (Bézier Path Editing) | Tools |
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

## 🛠️ Repository & Project Structure

```
papercut/
├── src/
│   ├── types/               # Type system & discriminated unions
│   ├── engine/              # Viewport math, renderer, hit testing, guides
│   ├── state/               # Reactive state manager, persistence, snapshots
│   ├── ui/                  # Toolbar, top bar, contextual control bar, inspector
│   ├── export/              # PDF/X-1a compiler, PDF/UA accessibility engine
│   ├── templates/           # Curated editorial, novel, and zine presets
│   ├── epubExport.ts        # EPUB 3 packager
│   ├── flipbookExport.ts    # Single-file HTML5 3D flipbook generator
│   ├── packageExport.ts     # Prepress ZIP packager
│   ├── main.ts              # Application initialization & bootstrap
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

## 🚀 Development Quickstart

### Prerequisites
- Node.js (v18+ recommended)
- npm or pnpm

### Installation
```bash
git clone https://github.com/papercut-studio/papercut.git
cd papercut
npm install
```

### Development Server
```bash
npm run dev
```
Open your browser to `http://localhost:5173`.

### Running Unit & Integration Tests
```bash
npm test
```

### Production Build
```bash
npm run build
```
Generates optimized, minified production assets into the `dist/` folder.

---

## 📜 License

Released under the **MIT License**. Created by independent creators for independent creators.
