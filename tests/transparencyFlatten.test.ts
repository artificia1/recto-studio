import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { StateManager } from '../src/state/stateManager';
import { createProfileAsset } from '../src/engine/iccProfiles';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { flattenRegions } from '../src/export/transparencyFlatten';
import type { ShapeElement } from '../src/types';

async function fixture() {
  const manager = new StateManager(); manager.createBlankProject('A4', 'Flattening', false);
  const outputProfile = await createProfileAsset(new Uint8Array(readFileSync('tests/fixtures/icc/lcms-test-output.icc')), 'test.icc', 'Test profile, not for production');
  manager.updateSettings({ widthMm: 40, heightMm: 30, colorManagement: { outputProfile, intent: 'relative', blackPointCompensation: true, preservePureBlack: true, convertPdf: true, tacLimit: 320 } });
  const shape: ShapeElement = { id: 'base', pageId: manager.getActiveSpread().pages[0].id, type: 'shape', shapeKind: 'rectangle',
    x: 4, y: 4, width: 12, height: 12, fillColor: '#00ffff', strokeColor: 'transparent', strokeWidthMm: 0, strokeDash: 'solid', opacity: 1, rotation: 0, locked: false, zIndex: 1 };
  manager.addElement(shape); manager.addElement({ ...shape, id: 'overlay', x: 9, y: 9, fillColor: '#ff00ff', opacity: 0.5, zIndex: 2 });
  return manager;
}

describe('hybrid print transparency flattening', () => {
  it('unions overlapping regions into non-overlapping clipping bands', () => {
    const union = flattenRegions([{ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }]);
    expect(union.reduce((sum, rect) => sum + rect.width * rect.height, 0)).toBe(175);
    for (let i = 0; i < union.length; i++) for (let j = i + 1; j < union.length; j++) {
      const a = union[i], b = union[j]; expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
    }
  });
  it('rasterizes real blended pixels to opaque CMYK tiles and retains outside vectors', async () => {
    const manager = await fixture();
    const result = await exportDocumentToPdf(manager.getState(), { download: false, transparency: 'flatten', flattenDpi: 150, compress: false });
    expect((result as any).flatteningReport.rasterTiles).toBeGreaterThan(0);
    const pdf = await PDFDocument.load(result.output('arraybuffer'));
    const objects = pdf.context.enumerateIndirectObjects().map(([, object]) => object);
    const images = objects.filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) { expect(image.dict.get(PDFName.of('ColorSpace'))?.toString()).toBe('/DeviceCMYK'); expect(image.dict.has(PDFName.of('SMask'))).toBe(false); }
    const pixels = decodePDFRawStream(images[0]).decode();
    expect(pixels.some((sample, index) => index >= 4 && sample !== pixels[index % 4])).toBe(true);
    const resources = pdf.getPages()[0].node.Resources()!;
    const states = resources.lookup(PDFName.of('ExtGState'), PDFDict);
    for (const [, ref] of states.entries()) {
      const state = pdf.context.lookup(ref, PDFDict);
      for (const key of ['ca', 'CA', 'BM', 'SMask']) expect(state.has(PDFName.of(key))).toBe(false);
    }
    expect(pdf.catalog.has(PDFName.of('OutputIntents'))).toBe(true);
    expect(pdf.getPages()[0].node.get(PDFName.of('Contents'))!.toString()).toContain('[');
  }, 60000);
  it('keeps fully transparent objects invisible when removing transparency resources', async () => {
    const manager = await fixture(); manager.updateElement('overlay', { opacity: 0 });
    const doc = await exportDocumentToPdf(manager.getState(), { download: false, transparency: 'flatten', flattenDpi: 150 });
    expect((doc as any).flatteningReport.rasterTiles).toBe(0);
    const pdf = await PDFDocument.load(doc.output('arraybuffer'));
    const contents = pdf.getPages()[0].node.lookup(PDFName.of('Contents'), PDFRawStream);
    const operators = new TextDecoder().decode(decodePDFRawStream(contents).decode());
    expect(operators.match(/ re(?:\r?\n|$)/g)).toHaveLength(2);
  }, 60000);
  it('blocks unsafe spot/transparency intersections and missing output profiles', async () => {
    const manager = await fixture(); manager.updateElement('base', { spotColor: 'FreeTone 185 C' });
    await expect(exportDocumentToPdf(manager.getState(), { download: false, transparency: 'flatten', flattenDpi: 150 })).rejects.toThrow('spot ink');
    manager.updateSettings({ colorManagement: undefined });
    await expect(exportDocumentToPdf(manager.getState(), { download: false, transparency: 'flatten' })).rejects.toThrow('ICC profile');
    await expect(exportDocumentToPdf(manager.getState(), { download: false, transparency: 'flatten', tagged: true })).rejects.toThrow('separate tagged');
  }, 60000);
});
