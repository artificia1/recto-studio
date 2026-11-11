import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { generateEpubPackage } from '../src/epubExport';
import { generateFixedEpubPackage } from '../src/export/fixedEpub';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { readingEntries, reviewReadingOrder } from '../src/engine/readingOrder';
import { accessiblePublication } from './fixtures/accessiblePublication';
import type { CanvasElement, TextElement } from '../src/types';

const rolesIn = (pdf: PDFDocument) => {
  const roles: string[] = [];
  const visit = (dict: PDFDict) => {
    const role = dict.get(PDFName.of('S'));
    if (role) roles.push(role.toString());
    const kids = dict.lookup(PDFName.of('K'));
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) {
      const child = pdf.context.lookup(kid);
      if (child instanceof PDFDict) visit(child);
    }
  };
  visit(pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict));
  return roles;
};

describe('shared accessibility workspace', () => {
  it('preserves authored order across two pages in PDF and both EPUB editions', async () => {
    const { manager, body, family, table } = await accessiblePublication();
    const first = manager.getActiveSpread();
    const figure = {
      ...body, id: 'decoration', type: 'image', name: 'Decorative art', width: 12, height: 12,
      src: `data:image/png;base64,${readFileSync('tests/fixtures/icc/alpha-sample.png').toString('base64')}`,
      fitMode: 'fit', decorative: true,
    } as CanvasElement;
    const heading: TextElement = { ...body, id: 'feature', name: 'Feature heading', text: 'Feature opens here',
      storyContent: undefined, rawStoryText: undefined, textContent: undefined,
      y: 105, height: 24, columns: 1, readingOrder: 1, readingRole: 'H1', readingArticle: 'Feature' };
    manager.addElement(heading);
    manager.addElement(figure);
    manager.updateElement(body.id, { readingOrder: 2, readingArticle: 'Feature' });
    manager.updateElement(table.id, { readingOrder: 3, readingArticle: 'Feature' });
    manager.addElement({ ...heading, id: 'results-caption', text: 'Reported categories', readingRole: undefined,
      readingOrder: 4, captionForId: table.id, y: 205 });
    manager.addSpread();
    const second = manager.getActiveSpread();
    const tail: TextElement = { ...heading, id: 'followup', name: 'Follow-up', text: 'Feature continues here', readingRole: 'H2',
      pageId: second.pages[0].id, y: 25, fontFamily: family };
    manager.addElement(tail);
    const state = manager.getState();
    expect(first.id).not.toBe(second.id);
    expect(readingEntries(state).filter(entry => entry.element.readingArticle).map(entry => entry.element.id))
      .toEqual(['feature', 'body', 'table', 'results-caption', 'followup']);
    expect(reviewReadingOrder(readingEntries(state), state)).toEqual([]);

    const fixed = generateFixedEpubPackage(state), reflow = generateEpubPackage(state, { strict: true });
    for (const [files, separator] of [[fixed, '-'], [reflow, '_']] as const) {
      const html = String(files[`OEBPS/page${separator}1.xhtml`]);
      const text = html.replace(/<[^>]*>/g, '');
      expect(html).toContain('<section aria-label="Feature">');
      expect(text).toContain('Feature opens here');
      expect(text.indexOf('Feature opens here')).toBeLessThan(text.indexOf('Accessible publishing'));
      expect(text.indexOf('Accessible publishing')).toBeLessThan(text.indexOf('Category'));
      expect(html).toContain('scope="col"');
      expect(html).toContain('rowspan="2"');
      expect(html).toContain('alt=""');
      expect(html).toMatch(/<table[^>]* aria-describedby="frame-[a-z0-9]+"/);
      expect(text.indexOf('Category')).toBeLessThan(text.indexOf('Reported categories'));
      expect(String(files[`OEBPS/page${separator}2.xhtml`]).replace(/<[^>]*>/g, '')).toContain('Feature continues here');
    }
    const doc = await exportDocumentToPdf(state, { download: false, accessibility: 'pdfua1' });
    const pdf = await PDFDocument.load(doc.output('arraybuffer'));
    const roles = rolesIn(pdf);
    expect(roles.filter(role => role === '/Sect')).toHaveLength(1);
    expect(roles.filter(role => role === '/H1')).toHaveLength(2);
    expect(roles.indexOf('/TH')).toBeLessThan(roles.indexOf('/H2'));
    expect(roles.indexOf('/TH')).toBeLessThan(roles.indexOf('/Caption'));
    expect(roles).not.toContain('/Figure');
    const document = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict)
      .lookup(PDFName.of('K'), PDFArray).lookup(0, PDFDict);
    const section = document.lookup(PDFName.of('K'), PDFArray).lookup(0, PDFDict);
    expect(section.lookup(PDFName.of('ID'), PDFHexString).decodeText()).toBe('article:0');
  }, 60000);

  it('surfaces missing descriptions, heading gaps and interrupted articles', async () => {
    const { manager, body, table } = await accessiblePublication();
    manager.updateElement(body.id, { readingRole: 'H3', readingArticle: 'Feature', readingOrder: 1 });
    manager.updateElement(table.id, { readingArticle: 'Feature', readingOrder: 3 });
    manager.addElement({ ...body, id: 'figure', type: 'image', readingOrder: 2, fitMode: 'fit', src: '' } as CanvasElement);
    const state = manager.getState();
    const findings = reviewReadingOrder(readingEntries(state), state);
    expect(findings.map(finding => finding.id)).toEqual(['body:heading', 'figure:alt', 'table:article']);
  });
});
