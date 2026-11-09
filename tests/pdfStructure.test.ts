import { describe, expect, it, vi } from 'vitest';
import { savePublicationFile } from '../src/desktop';
vi.mock('../src/desktop', async importOriginal => ({ ...await importOriginal<typeof import('../src/desktop')>(), savePublicationFile: vi.fn(async () => true) }));
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
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
    vi.mocked(savePublicationFile).mockClear();
    await result.save('commercial-spot.pdf', { returnPromise: true });
    expect(savePublicationFile).toHaveBeenCalledWith('commercial-spot.pdf', expect.any(Uint8Array), 'application/pdf');
    const saved = vi.mocked(savePublicationFile).mock.calls[0][1] as Uint8Array;
    expect(saved).toEqual(new Uint8Array(result.output('arraybuffer')));
    const savedPdf = await PDFDocument.load(saved);
    expect(savedPdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict).has(PDFName.of('CS_FreeTone_185_C'))).toBe(true);
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

  it('creates nested Unicode bookmarks with destinations in the selected PDF page range', async () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Bookmark test', false);
    const heading: TextElement = {
      id: 'heading', type: 'text', pageId: manager.getActiveSpread().pages[0].id, x: 20, y: 20, width: 140, height: 20,
      rotation: 0, locked: false, opacity: 1, zIndex: 1, text: 'Édition (revue)', fontFamily: 'Times', fontSizePt: 20,
      lineHeight: 1.2, letterSpacingPt: 0, color: '#111', alignment: 'left', columns: 1, columnGutterMm: 4,
      paddingMm: 0, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paragraphStyleId: 'style-h1',
    };
    manager.addElement(heading);
    manager.addSpread();
    manager.setActiveSpread(1);
    manager.addElement({ ...heading, id: 'subheading', pageId: manager.getActiveSpread().pages[0].id,
      text: 'Résumé', paragraphStyleId: 'style-h2' });
    const exportTagged = async (spreadRange: 'all' | 'current') => PDFDocument.load((await exportDocumentToPdf(manager.getState(), {
      tagged: true, download: false, spreadRange,
    })).output('arraybuffer'));
    const first = (pdf: PDFDocument) => pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookup(PDFName.of('First'), PDFDict);
    const title = (item: PDFDict) => item.lookup(PDFName.of('Title'), PDFHexString).decodeText();
    const all = await exportTagged('all');
    expect(title(first(all))).toBe('Édition (revue)');
    const sub = first(all).lookup(PDFName.of('First'), PDFDict);
    expect(title(sub)).toBe('Résumé');
    expect(sub.lookup(PDFName.of('Dest'), PDFArray).get(0)).toBe(all.getPages()[1].ref);
    const current = await exportTagged('current');
    expect(title(first(current))).toBe('Résumé');
    expect(first(current).lookup(PDFName.of('Dest'), PDFArray).get(0)).toBe(current.getPages()[0].ref);
  });
});
