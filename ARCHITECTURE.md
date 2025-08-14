# Papercut Studio — Systems Architecture

This document provides a technical overview of Papercut Studio's internal graphics architecture, coordinate transformations, rendering loop, state management, and export compiler pipelines.

---

## 1. System Topology & Component Overview

```mermaid
flowchart TD
    subgraph UI ["User Interface Layer"]
        Toolbar["src/ui/toolbar.ts"]
        TopBar["src/ui/topBar.ts"]
        Inspector["src/ui/inspector.ts"]
        Layers["src/ui/layersPanel.ts"]
        Assets["src/ui/assetManager.ts"]
    end

    subgraph Core ["State & Core Engine"]
        StateManager["src/state/stateManager.ts"]
        Persistence["src/state/persistence.ts"]
        CRDT["src/collab/crdtAdapter.ts"]
        History["Undo / Redo Stack (30 steps)"]
    end

    subgraph GraphicsEngine ["2D Graphics & Canvas Pipeline"]
        Viewport["src/engine/viewport.ts (Pan/Zoom/DPR)"]
        Renderer["src/engine/renderer.ts (Spread Render)"]
        HitTest["src/engine/hitTest.ts (Spatial Bounding)"]
        Guides["src/engine/guides.ts (Magnetic Snapping)"]
        CanvasView["src/canvas.ts (Master Canvas)"]
    end

    subgraph Compilers ["Export & Output Pipeline"]
        PDFX["src/export/pdfExport.ts (PDF/X-1a & Tagged PDF)"]
        EPUB["src/epubExport.ts (EPUB 3 Packages)"]
        Flipbook["src/flipbookExport.ts (3D HTML Flipbook)"]
        Package["src/packageExport.ts (Print Zip Bundle)"]
    end

    UI --> StateManager
    StateManager <--> Persistence
    StateManager <--> CRDT
    StateManager --> History
    StateManager --> GraphicsEngine
    GraphicsEngine --> CanvasView
    StateManager --> Compilers
```

---

## 2. Coordinate Systems & Matrix Transformations

Papercut executes precision desktop publishing by strictly decoupling physical print units from display pixels and target PDF points:

| Space | Unit | Resolution / Basis | Transformation |
|---|---|---|---|
| **Document Space** | Millimeters (`mm`) | Real-world physical dimensions (e.g. A4: 210 × 297 mm) | Canonical storage coordinate system for all element bounds (`x`, `y`, `width`, `height`). |
| **Screen Space** | Display Pixels (`px`) | Variable based on viewport zoom (`zoom`) and device pixel ratio (`DPR`) | `px = mm * (96 / 25.4) * zoom * DPR` |
| **Print / PDF Space** | Points (`pt`) | PostScript standard: 72 points per inch (1 pt = 25.4 / 72 mm ≈ 0.352778 mm) | `pt = mm * (72 / 25.4)` |

### Viewport Transformation Equation
Let $(x_{doc}, y_{doc})$ be a point on a document spread in millimeters. Its canvas pixel coordinate $(X_{canvas}, Y_{canvas})$ is computed as:

$$X_{canvas} = \left((x_{doc} - panX) \times \frac{96}{25.4} \times zoom + originX\right) \times DPR$$
$$Y_{canvas} = \left((y_{doc} - panY) \times \frac{96}{25.4} \times zoom + originY\right) \times DPR$$

All mouse interactions (drag, selection, transform handle dragging, magnetic guide snapping) map through `screenToDocument()` in `src/engine/viewport.ts` before mutating state.

---

## 3. High-Performance Canvas Rendering Pipeline

The 2D canvas engine (`src/engine/renderer.ts` and `src/canvas.ts`) utilizes an immediate-mode retained-state pattern optimized for 60 FPS on low-power hardware:

1. **Sub-Pixel Snapping**: Guide lines, page borders, and column dividers are snapped to half-pixel boundaries (`Math.floor(coord) + 0.5`) to eliminate anti-aliasing blur.
2. **Layer Stacking Order**: Rendering traverses defined `Layer` nodes in ascending `order`. For each layer:
   - Skips rendering if `layer.visible === false`.
   - Renders child elements by `zIndex`.
   - Highlights selection bounding boxes and 8 resize handles using the parent layer's designated hex color (e.g., `#0d99ff` for Layer 1).
3. **Typography & Multi-Column Layout**:
   - Computes baseline grids and column gutters.
   - Text wrap engine (`src/textWrap.ts`) projects element obstacle polygons and dynamically adjusts line-box line widths.
   - Overflow detection flags frames with the iconic red `+` badge if line count exceeds physical frame bounds.
4. **Zero-Allocation Hot Paths**: Coordinate transformation math and bounding box hit-testing avoid dynamic object allocation inside mousemove and wheel events.

---

## 4. Core Data Structures

All document state is strongly typed under `src/types/index.ts` using discriminated unions:

```typescript
// Core Element Discriminated Union
export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | TableElement
  | PathElement;

// Document Root
export interface Document {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  facingPages: boolean;
  margins: Margins;
  bleedMm: number;
  slugMm: number;
  spreads: Spread[];
  layers: Layer[];
  paragraphStyles: ParagraphStyle[];
  characterStyles: CharacterStyle[];
  masterPages: MasterPage[];
}
```

### Layer & Spatial Isolation
Each element contains a `layerId` and `zIndex`. If an element's parent layer is locked (`layer.locked === true`), the spatial hit-tester (`src/engine/hitTest.ts`) rejects pointer selection, ensuring strict layout immutability.

---

## 5. Export Pipelines

```mermaid
sequenceDiagram
    participant State as StateManager
    participant PDF as PDF/X & UA Compiler
    participant EPUB as EPUB 3 Packager
    participant Flip as HTML Flipbook Packager

    State->>PDF: compileDocumentToPdf(doc, options)
    Note over PDF: Tagged PDF/UA Structure Tree<br/>AltText injection & Color CMYK conversion
    PDF-->>State: Blob (application/pdf)

    State->>EPUB: exportDocumentToEpub(doc)
    Note over EPUB: XHTML content spreads<br/>CSS stylesheets + OPF package manifest
    EPUB-->>State: Blob (application/epub+zip)

    State->>Flip: exportDocumentToFlipbook(doc)
    Note over Flip: Single-file 3D CSS page-flip bundle<br/>Self-contained HTML5
    Flip-->>State: Blob (text/html)
```

---

## 6. Extensibility Guide

### Adding a New Element Type
1. Define the interface in `src/types/index.ts` extending `BaseElement` with a unique `type` literal.
2. Add the interface to the `Element` union type in `src/types/index.ts`.
3. In `src/engine/renderer.ts`, add a rendering branch inside `renderSpread()` or element drawing router.
4. In `src/engine/hitTest.ts`, implement point-in-bounds detection for the new element geometry.
5. In `src/export/pdfExport.ts`, map the element into corresponding PDF primitives.

### Adding an Export Pipeline
1. Create a module under `src/export/<format>Export.ts`.
2. Accept the active `Document` state and export configuration options.
3. Register the command in `src/ui/topBar.ts` inside the Export dropdown menu.
