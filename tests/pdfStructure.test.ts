import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { StateManager } from '../src/state/stateManager';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import type { ShapeElement, TextElement } from '../src/types';

describe('PDF object resources and accessibility structure', () => {
  it('writes spot colour spaces inside page resources, including inherited master artwork', async () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Ink resource test', false);
    const shape: ShapeElement = { id: 'spot', type: 'shape', pageId: manager.getActiveSpread().pages[0].id, x: 20, y: 20, width: 40, height: 40,
      rotation: 0, locked: false, opacity: 1, zIndex: 1, shapeKind: 'ellipse', fillColor: '#f00', strokeColor: '#000', strokeWidthMm: 0,
      strokeDash: 'solid', spotColor: 'FreeTone 185 C' };
    manager.addElement(shape);
    const result = await exportDocumentToPdf(manager.getState(), { download: false, compress: false });
    const pdf = await PDFDocument.load(result.output('arraybuffer'));
    const colors = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict);
    const separation = colors.lookup(PDFName.of('CS_FreeTone_185_C'), PDFArray);
    expect(separation.get(0).toString()).toBe('/Separation'); expect(separation.get(2).toString()).toBe('/DeviceCMYK');
    expect(result.output()).not.toContain('/GTS_PDFXVersion');
  });
  it('writes connected parent trees, language, actual text and explicit reading order', async () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Tagged publication', false);
    const base: TextElement = { id: 'first', type: 'text', pageId: manager.getActiveSpread().pages[0].id, x: 20, y: 20, width: 100, height: 30,
      rotation: 0, locked: false, opacity: 1, zIndex: 1, text: 'First in reading order', fontFamily: 'Times', fontSizePt: 11,
      lineHeight: 1.4, letterSpacingPt: 0, color: '#111', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0,
      backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, readingOrder: 2 };
    manager.addElement(base); manager.addElement({ ...base, id: 'second', y: 70, readingOrder: 1, text: 'Read this first' });
    const result = await exportDocumentToPdf(manager.getState(), { tagged: true, download: false, compress: false });
    const pdf = await PDFDocument.load(result.output('arraybuffer'));
    const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const document = root.lookup(PDFName.of('K'), PDFArray).lookup(0, PDFDict);
    const elements = document.lookup(PDFName.of('K'), PDFArray);
    expect(elements.size()).toBe(2);
    expect(elements.lookup(0, PDFDict).get(PDFName.of('K'))!.toString()).toBe('1');
    const tree = root.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
    expect(tree.lookup(1, PDFArray).size()).toBe(2);
    expect(pdf.catalog.get(PDFName.of('Lang'))!.toString()).toContain('en');
    expect(result.output()).toContain('/ActualText <FEFF'); expect(result.output()).not.toContain('pdfuaid:part');
  });
});
