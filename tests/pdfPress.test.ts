import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { StateManager } from '../src/state/stateManager';
import { createProfileAsset } from '../src/engine/iccProfiles';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import type { ShapeElement } from '../src/types';

async function publication() {
  const manager = new StateManager(); manager.createBlankProject('A4', 'Press candidate', false);
  const outputProfile = await createProfileAsset(new Uint8Array(readFileSync('tests/fixtures/icc/lcms-test-output.icc')), 'test.icc', 'Test only');
  manager.updateSettings({ widthMm: 40, heightMm: 30, colorManagement: { outputProfile, intent: 'relative', blackPointCompensation: true, preservePureBlack: true, convertPdf: true, tacLimit: 320 } });
  const shape: ShapeElement = { id: 'base', pageId: manager.getActiveSpread().pages[0].id, type: 'shape', shapeKind: 'rectangle', x: 4, y: 4, width: 12, height: 12,
    fillColor: '#00ffff', strokeColor: 'transparent', strokeWidthMm: 0, strokeDash: 'solid', opacity: 1, rotation: 0, locked: false, zIndex: 1 };
  manager.addElement(shape); manager.addElement({ ...shape, id: 'overlay', x: 10, fillColor: '#ffff00', opacity: 0.5, zIndex: 2 });
  return manager;
}

describe('guarded PDF/X preparation', () => {
  it('prepares both print targets with matching identification, profiles and PDF versions', async () => {
    const manager = await publication(); mkdirSync('test-results/export-validation', { recursive: true });
    for (const standard of ['pdfx1a-2003', 'pdfx4'] as const) {
      const doc = await exportDocumentToPdf(manager.getState(), { download: false, pressStandard: standard, flattenDpi: 150 });
      const bytes = new Uint8Array(doc.output('arraybuffer')), pdf = await PDFDocument.load(bytes);
      expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe(standard === 'pdfx4' ? '%PDF-1.6' : '%PDF-1.4');
      const info = pdf.context.lookup(pdf.context.trailerInfo.Info!, PDFDict);
      expect(info.get(PDFName.of('Trapped'))?.toString()).toBe('/False');
      expect(info.get(PDFName.of('GTS_PDFXVersion'))?.toString()).toContain(standard === 'pdfx4' ? 'PDF/X-4' : 'PDF/X-1a:2003');
      const metadata = pdf.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
      expect(new TextDecoder().decode(decodePDFRawStream(metadata).decode())).toContain('pdfxid:GTS_PDFXVersion');
      expect((doc as any).pressReport).toMatchObject({ certified: false, independentValidationRequired: true });
      if (standard === 'pdfx4') expect(pdf.getPages()[0].node.lookup(PDFName.of('Group'), PDFDict).get(PDFName.of('CS'))?.toString()).toBe('/DeviceCMYK');
      writeFileSync(`test-results/export-validation/${standard}.pdf`, bytes);
    }
  }, 60000);
  it('blocks incompatible editions and missing output profiles before claiming a print target', async () => {
    const manager = await publication(); manager.updateSettings({ colorManagement: undefined });
    await expect(exportDocumentToPdf(manager.getState(), { download: false, pressStandard: 'pdfx4' })).rejects.toThrow('ICC');
    await expect(exportDocumentToPdf(manager.getState(), { download: false, pressStandard: 'pdfx4', tagged: true })).rejects.toThrow('separate accessible');
  }, 60000);
});
