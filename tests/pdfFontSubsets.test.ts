import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { fontManager } from '../src/fontManager';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { createNodePdfRaster } from '../src/export/pdfRasterNode';
import { accessiblePublication } from './fixtures/accessiblePublication';

describe('OpenType PDF subsets', () => {
  it.each([
    { file: 'SourceSansPro-Regular.otf', format: 'FontFile3', type: '/CIDFontType0', variations: undefined },
    { file: 'Roboto-Variable.ttf', format: 'FontFile2', type: '/CIDFontType2', variations: { wght: 780, wdth: 85 } },
  ])('embeds, renders and extracts $file', async ({ file, format, type, variations }) => {
    const source = readFileSync(`tests/fixtures/fonts/${file}`);
    const family = await fontManager.registerFontBuffer(file, source, variations);
    const { manager, body } = await accessiblePublication();
    const state = manager.getState();
    state.embeddedFonts = [fontManager.getFontAsset(family)!];
    state.spreads[0].elements = [{ ...body, fontFamily: family, text: 'Office café Ångström', storyContent: undefined, textContent: undefined, rawStoryText: undefined }];
    const result = await exportDocumentToPdf(state, { download: false, accessibility: 'pdfua1' });
    const bytes = new Uint8Array(result.output('arraybuffer'));
    const pdf = await PDFDocument.load(bytes);
    const fonts = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const font = fonts.lookup(PDFName.of('RectoFont1'), PDFDict);
    const descendant = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    expect(descendant.get(PDFName.of('Subtype'))?.toString()).toBe(type);
    const embedded = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict).lookup(PDFName.of(format), PDFRawStream);
    expect(decodePDFRawStream(embedded).decode().length).toBeLessThan(source.length / 2);
    const raster = await createNodePdfRaster(bytes);
    try { expect((await raster.tile(0, 0, 0, 360, 140, 1)).some(value => value < 100)).toBe(true); }
    finally { await raster.destroy(); }
    const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = engine.getDocument({ data: bytes.slice(), useSystemFonts: false });
    try {
      const page = await (await task.promise).getPage(1);
      const content = await page.getTextContent();
      expect(content.items.map(item => 'str' in item ? item.str : '').join('')).toBe('Office café Ångström');
    } finally { await task.destroy(); }
    mkdirSync('test-results/export-validation', { recursive: true });
    writeFileSync(`test-results/export-validation/accessible-${variations ? 'variable' : 'cff'}.pdf`, bytes);
  }, 60000);
});
