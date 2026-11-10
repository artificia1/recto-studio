import { describe, expect, it } from 'vitest';
import { applyImageAdjustments, neutralAdjustments } from '../src/engine/imageAdjustments';
import { hatchLines, meshCells } from '../src/engine/vectorDecoration';
import { prepareExportAssets } from '../src/export/publicationAssets';
import { decodeSrgbRaster } from '../src/engine/rasterPixels';
import { StateManager } from '../src/state/stateManager';
import type { ImageElement, ShapeElement } from '../src/types';

describe('non-destructive artwork effects', () => {
  it('applies grayscale, levels and curves while preserving the source alpha bytes', () => {
    const original = new Uint8Array([255, 0, 0, 64, 128, 128, 128, 255]);
    const edited = original.slice();
    applyImageAdjustments(edited, { ...neutralAdjustments, grayscale: true, black: 5, white: 250,
      curve: [{ input: 128, output: 160 }] });
    expect(edited[0]).toBe(edited[1]);
    expect(edited[1]).toBe(edited[2]);
    expect(edited[4]).toBeGreaterThan(128);
    expect([edited[3], edited[7]]).toEqual([64, 255]);
    expect([...original]).toEqual([255, 0, 0, 64, 128, 128, 128, 255]);
  });

  it('renders adjustments into export pixels and keeps them editable in the project', async () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Photo proof', false);
    const spread = manager.getActiveSpread();
    const image: ImageElement = { type: 'image', id: 'photo', pageId: spread.pages[0].id,
      x: 15, y: 15, width: 40, height: 40, rotation: 0, opacity: 1, zIndex: 1, locked: false,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      fitMode: 'fit', borderWidthMm: 0, borderColor: 'transparent', adjustments: { ...neutralAdjustments, grayscale: true } };
    spread.elements.push(image);
    const original = image.src;
    const native = (await prepareExportAssets(manager.getState())).spreads[0].elements[0] as ImageElement;
    const exported = (await prepareExportAssets(manager.getState(), false, false, true)).spreads[0].elements[0] as ImageElement;
    expect(native.adjustments).toEqual(image.adjustments);
    expect(exported.adjustments).toBeUndefined();
    const pixels = (await decodeSrgbRaster(exported.src)).data;
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(image.src).toBe(original);
  });

  it('uses physical hatch spacing and process-color mesh samples in exported PDF', async () => {
    const hatch = { kind: 'hatch' as const, color: 'cmyk(100,0,0,0)', angle: 0, spacing: 3, weight: 0.2, crossed: false };
    const lines = hatchLines(hatch, 30, 20);
    expect(lines[1].y1 - lines[0].y1).toBeCloseTo(3);
    const mesh = { kind: 'mesh' as const, columns: 2, rows: 2,
      colors: ['cmyk(100,0,0,0)', 'cmyk(0,100,0,0)', 'cmyk(0,0,100,0)', 'cmyk(0,0,0,100)'] };
    expect(meshCells(mesh)).toHaveLength(144);
    expect(meshCells(mesh)[0].ink).toMatch(/^cmyk\(/);

    const manager = new StateManager();
    manager.createBlankProject('A4', 'Process vector proof', false);
    const spread = manager.getActiveSpread();
    const rectangle: ShapeElement = { type: 'shape', shapeKind: 'rectangle', id: 'mesh', pageId: spread.pages[0].id,
      x: 20, y: 20, width: 30, height: 30, rotation: 0, opacity: 1, zIndex: 1, locked: false,
      fillColor: 'transparent', strokeColor: 'cmyk(0,0,0,100)', strokeWidthMm: 0.5, strokeDash: 'solid',
      decoration: mesh, strokePattern: { dash: 3, gap: 2 } };
    spread.elements.push(rectangle, { ...rectangle, id: 'hatch', x: 65, decoration: hatch });
    const { exportDocumentToPdf } = await import('../src/export/pdfExport');
    const pdf = (await exportDocumentToPdf(manager.getState(), { compress: false, download: false })).output();
    expect(pdf).toMatch(/\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? k/);
    expect(pdf).toContain('W');
    expect(pdf).toMatch(/\[[0-9.]+ [0-9.]+\] 0\.? d/);
  });
});
