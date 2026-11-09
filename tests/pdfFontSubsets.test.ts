import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { fontManager } from '../src/fontManager';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { createNodePdfRaster } from '../src/export/pdfRasterNode';
import { accessiblePublication } from './fixtures/accessiblePublication';

function requireWholeFont(file: string) {
  const source = new Uint8Array(readFileSync(`tests/fixtures/fonts/${file}`));
  const table = new DataView(source.buffer);
  const tables = new Map<string, number>();
  for (let entry = 12; entry < 12 + 16 * table.getUint16(4); entry += 16) {
    tables.set(new TextDecoder().decode(source.subarray(entry, entry + 4)), entry);
  }
  const os2 = tables.get('OS/2')!, os2Offset = table.getUint32(os2 + 8);
  const adjustment = table.getUint32(tables.get('head')! + 8) + 8;
  const original = table.getUint16(os2Offset + 8), flags = 0x0104; // preview & print, no subsetting
  const delta = (flags - original) << 16;
  table.setUint16(os2Offset + 8, flags);
  table.setUint32(os2 + 4, (table.getUint32(os2 + 4) + delta) >>> 0);
  table.setUint32(adjustment, (table.getUint32(adjustment) - 2 * delta) >>> 0);
  return { source, table, tables };
}

describe('OpenType PDF subsets', () => {
  it.each([
    { file: 'SourceSansPro-Regular.otf', format: 'FontFile3', type: '/CIDFontType0', fixture: 'cff', variations: undefined },
    { file: 'Roboto-Variable.ttf', format: 'FontFile2', type: '/CIDFontType2', fixture: 'variable', variations: { wght: 780, wdth: 85 } },
    { file: 'RectoCffTest-Variable.otf', format: 'FontFile3', type: '/CIDFontType0', fixture: 'cff2', variations: { wght: 780, opsz: 35 } },
  ])('embeds, renders and extracts $file', async ({ file, format, type, variations, fixture }) => {
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
    writeFileSync(`test-results/export-validation/accessible-${fixture}.pdf`, bytes);
  }, 60000);

  it('embeds an entire static TrueType font when its flags permit embedding but prohibit subsetting', async () => {
    const { source } = requireWholeFont('OpenSans-Regular.ttf');
    const { manager, body } = await accessiblePublication();
    const family = await fontManager.registerFontBuffer('OpenSans-Full.ttf', source);
    const state = manager.getState();
    state.embeddedFonts = [fontManager.getFontAsset(family)!];
    state.spreads[0].elements = [{ ...body, fontFamily: family, text: 'Fully embedded text', storyContent: undefined, textContent: undefined, rawStoryText: undefined }];
    const bytes = new Uint8Array((await exportDocumentToPdf(state, { download: false, accessibility: 'pdfua1' })).output('arraybuffer'));
    const pdf = await PDFDocument.load(bytes);
    const font = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'), PDFDict).lookup(PDFName.of('RectoFont1'), PDFDict);
    const descriptor = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('FontDescriptor'), PDFDict);
    expect(descriptor.get(PDFName.of('FontName'))?.toString()).not.toContain('+');
    expect(decodePDFRawStream(descriptor.lookup(PDFName.of('FontFile2'), PDFRawStream)).decode()).toEqual(source);
    mkdirSync('test-results/export-validation', { recursive: true });
    writeFileSync('test-results/export-validation/accessible-full-truetype.pdf', bytes);
  }, 60000);

  it('shares an untouched CFF font program across multiple searchable single-byte encodings', async () => {
    const { source, table, tables } = requireWholeFont('SourceSansPro-Regular.otf');
    const entry = tables.get('CFF ')!, offset = table.getUint32(entry + 8), length = table.getUint32(entry + 12);
    const family = await fontManager.registerFontBuffer('SourceSansPro-Full.otf', source);
    const fontSource = fontManager.getFont(family)!;
    const chars = fontSource.characterSet.filter(code => code >= 0x41 && code <= 0x52f && /\p{L}/u.test(String.fromCodePoint(code))).slice(0, 275);
    expect(chars.length).toBeGreaterThan(255);
    const text = chars.map(code => String.fromCodePoint(code)).join(' ');
    const { manager, body } = await accessiblePublication();
    const state = manager.getState();
    state.embeddedFonts = [fontManager.getFontAsset(family)!];
    state.spreads[0].elements = [{ ...body, height: 200, width: 160, fontFamily: family, fontSizePt: 10, text,
      storyContent: undefined, textContent: undefined, rawStoryText: undefined }];
    const bytes = new Uint8Array((await exportDocumentToPdf(state, { download: false, accessibility: 'pdfua1' })).output('arraybuffer'));
    const pdf = await PDFDocument.load(bytes);
    const fonts = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const first = fonts.lookup(PDFName.of('RectoFont1'), PDFDict), second = fonts.lookup(PDFName.of('RectoFont1_2'), PDFDict);
    expect(first.get(PDFName.of('Subtype'))?.toString()).toBe('/Type1');
    expect(first.get(PDFName.of('FontDescriptor'))).toBe(second.get(PDFName.of('FontDescriptor')));
    const descriptor = first.lookup(PDFName.of('FontDescriptor'), PDFDict);
    const stream = descriptor.lookup(PDFName.of('FontFile3'), PDFRawStream);
    expect(stream.dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Type1C');
    expect(decodePDFRawStream(stream).decode()).toEqual(source.subarray(offset, offset + length));
    const raster = await createNodePdfRaster(bytes);
    try { expect((await raster.tile(0, 0, 0, 400, 170, 1)).some(value => value < 100)).toBe(true); }
    finally { await raster.destroy(); }
    const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = engine.getDocument({ data: bytes.slice(), useSystemFonts: false });
    try {
      const content = await (await (await task.promise).getPage(1)).getTextContent();
      // PDF.js normalizes compatibility characters such as the micro sign during extraction.
      expect(content.items.map(item => 'str' in item ? item.str : '').join('').replace(/\s/g, '').normalize('NFKC')).toBe(text.replace(/\s/g, '').normalize('NFKC'));
    } finally { await task.destroy(); }
    mkdirSync('test-results/export-validation', { recursive: true });
    writeFileSync('test-results/export-validation/accessible-full-cff.pdf', bytes);
  }, 60000);
});
