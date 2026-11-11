import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { generateFixedEpubPackage } from '../src/export/fixedEpub';
import { generateEpubPackage } from '../src/epubExport';
import { accessiblePublication } from './fixtures/accessiblePublication';
import type { CanvasElement } from '../src/types';

const key = (dict: PDFDict, name: string) => dict.get(PDFName.of(name))?.toString();
function structure(pdf: PDFDocument) {
  const result: PDFDict[] = [];
  const visit = (dict: PDFDict) => {
    result.push(dict);
    const children = dict.lookup(PDFName.of('K'));
    for (const child of children instanceof PDFArray ? children.asArray() : []) { const value = pdf.context.lookup(child); if (value instanceof PDFDict) visit(value); }
  };
  visit(pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict)); return result;
}

describe('strict accessible publication PDFs', () => {
  it('writes semantic headings, lists and vertically merged tables with Unicode fonts', async () => {
    const { manager } = await accessiblePublication();
    manager.insertFootnote('body', 'A fully tagged editorial note.', 45);
    const doc = await exportDocumentToPdf(manager.getState(), { download: false, accessibility: 'pdfua1' });
    const pdf = await PDFDocument.load(doc.output('arraybuffer')), items = structure(pdf), roles = items.map(item => key(item, 'S'));
    for (const role of ['Document', 'H1', 'P', 'L', 'LI', 'Lbl', 'LBody', 'Note', 'Table', 'TR', 'TH', 'TD']) expect(roles).toContain(`/${role}`);
    expect(roles.filter(role => role === '/L')).toHaveLength(1); expect(roles.filter(role => role === '/LI')).toHaveLength(2);
    const merged = items.find(item => item.lookupMaybe(PDFName.of('A'), PDFDict)?.get(PDFName.of('RowSpan'))?.toString() === '2');
    expect(key(merged!, 'S')).toBe('/TD');
    const metadata = pdf.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
    expect(new TextDecoder().decode(decodePDFRawStream(metadata).decode())).toContain('pdfuaid:part="1"');
    expect((doc as any).accessibilityReport.humanReviewRequired).toBe(true);
    mkdirSync('test-results/export-validation', { recursive: true });
    writeFileSync('test-results/export-validation/accessible-ua1.pdf', new Uint8Array(doc.output('arraybuffer')));
  }, 60000);

  it('keeps one logical table across split rows and marks repeated headers as furniture', async () => {
    const { manager, table } = await accessiblePublication();
    manager.updateTableSource(table.id, { allowRowSplit: true, cells: [[{ text: 'Category' }, { text: 'Amount' }], [{ text: 'Long body cell '.repeat(90) }, { text: '100' }]], rows: 2 });
    manager.updateElement(table.id, { height: 30 });
    const tail = manager.addTableContinuationPage(table.id); manager.updateElement(tail, { y: 15, height: 260 });
    const doc = await exportDocumentToPdf(manager.getState(), { download: false, accessibility: 'pdfua1' });
    const pdf = await PDFDocument.load(doc.output('arraybuffer')), items = structure(pdf);
    expect(pdf.getPageCount()).toBe(2);
    expect(items.filter(item => key(item, 'S') === '/Table')).toHaveLength(1);
    expect(items.filter(item => key(item, 'S') === '/TH')).toHaveLength(2);
    expect(items.filter(item => key(item, 'S') === '/TD')).toHaveLength(2);
    const fixed = generateFixedEpubPackage(manager.getState());
    expect(fixed['OEBPS/page-2.xhtml']).toContain('<th scope="col"');
    expect(fixed['OEBPS/page-2.xhtml']).toContain('Long body cell');
    const reflow = generateEpubPackage(manager.getState(), { strict: true });
    expect(reflow['OEBPS/page_2.xhtml']).toBeUndefined();
    expect(reflow['OEBPS/page_1.xhtml']).toContain('Long body cell');
    writeFileSync('test-results/export-validation/accessible-continuation.pdf', new Uint8Array(doc.output('arraybuffer')));
  }, 60000);

  it('requires embedded text, meaningful image descriptions and complete semantics', async () => {
    const { manager, body } = await accessiblePublication();
    manager.updateElement('body', { fontFamily: 'Times' });
    await expect(exportDocumentToPdf(manager.getState(), { download: false, accessibility: 'pdfua1' })).rejects.toThrow('embedded');
    manager.updateElement('body', { fontFamily: body.fontFamily });
    const image = { ...body, id: 'image', type: 'image', text: undefined, y: 220, width: 10, height: 10, src: '', fitMode: 'fit' } as unknown as CanvasElement;
    manager.addElement(image);
    await expect(exportDocumentToPdf(manager.getState(), { download: false, accessibility: 'pdfua1' })).rejects.toThrow(/image|asset/i);
    await expect(exportDocumentToPdf(manager.getState(), { download: false, accessibility: 'pdfua1', spreadRange: 'current' })).rejects.toThrow('whole publication');
    await expect(exportDocumentToPdf(manager.getState(), { download: false, accessibility: 'pdfua1', transparency: 'flatten' })).rejects.toThrow('separate tagged');
  }, 60000);

  it('validates heading levels using reading order and refuses interactive annotations', async () => {
    const { manager } = await accessiblePublication();
    const state = manager.getState(); state.paragraphStyles.find(style => style.id === 'ua-heading')!.pdfTag = 'H3';
    await expect(exportDocumentToPdf(state, { download: false, accessibility: 'pdfua1' })).rejects.toThrow('heading levels');
    state.paragraphStyles.find(style => style.id === 'ua-heading')!.pdfTag = 'H1';
    manager.updateElement('body', { interactiveField: { type: 'text', fieldName: 'Unsupported annotation' } });
    await expect(exportDocumentToPdf(manager.getState(), { download: false, accessibility: 'pdfua1' })).rejects.toThrow('annotation tagging');
  }, 60000);
});
