import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import type { jsPDF } from 'jspdf';
import { pdfCode, usedPdfFonts } from './pdfFonts';
import { compileVariableTrueType } from './variableTrueTypeSubset';

const identity = { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 };

function cmap(name: string, kind: 'cid' | 'bf', entries: string[]) {
  const lines = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def',
    `/CMapName /${name} def`, `/CMapType ${kind === 'cid' ? 1 : 2} def`,
    '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
  for (let offset = 0; offset < entries.length; offset += 100) {
    const block = entries.slice(offset, offset + 100);
    lines.push(`${block.length} begin${kind}char`, ...block, `end${kind}char`);
  }
  return [...lines, 'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end'].join('\n');
}

const unicodeHex = (text: string) => Array.from({ length: text.length }, (_, index) => pdfCode(text.charCodeAt(index))).join('');

export function installPdfFonts(doc: jsPDF, pdf: PDFDocument) {
  const { context } = pdf;
  const pages = pdf.getPages();
  for (const [index, entry] of usedPdfFonts(doc).entries()) {
    const { font, cff, subset } = entry;
    const glyphs = [...entry.glyphs.values()];
    const prefix = index.toString(26).replace(/./g, digit => String.fromCharCode(65 + parseInt(digit, 26))).padStart(6, 'A');
    const name = `${prefix}+${(font.postscriptName || 'RectoEmbedded').replace(/[^A-Za-z0-9_.-]/g, '-')}`;
    const glyphIds = new Map(glyphs.map(glyph => [glyph.cid, glyph.glyphId]));
    const bytes = entry.variable
      ? compileVariableTrueType(font, [0, ...[...glyphIds].sort(([a], [b]) => a - b).map(([, id]) => id)])
      : subset.encode();
    const stream = context.register(context.flateStream(bytes, cff ? { Subtype: 'CIDFontType0C' } : { Length1: bytes.length }));
    const scale = 1000 / font.unitsPerEm;
    const bbox = font.bbox;
    const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: name,
      Flags: 4 | (font.italicAngle ? 64 : 0), FontBBox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map(value => value * scale),
      ItalicAngle: font.italicAngle || 0, Ascent: font.ascent * scale, Descent: font.descent * scale,
      CapHeight: (font.capHeight || font.ascent) * scale, StemV: 80, [cff ? 'FontFile3' : 'FontFile2']: stream }));
    const widths = [...new Map(glyphs.map(glyph => [glyph.cid, glyph.width]))].sort(([a], [b]) => a - b);
    const descendant = context.register(context.obj({ Type: 'Font', Subtype: cff ? 'CIDFontType0' : 'CIDFontType2', BaseFont: name,
      CIDSystemInfo: identity, FontDescriptor: descriptor, W: widths.flatMap(([cid, width]) => [cid, [width]]),
      ...(cff ? {} : { CIDToGIDMap: 'Identity' }) }));
    const encodingName = `${entry.resource}-H`;
    const encoding = glyphs.every(glyph => glyph.code === glyph.cid) ? PDFName.of('Identity-H') : context.register(context.flateStream(
      cmap(encodingName, 'cid', glyphs.map(glyph => `<${pdfCode(glyph.code)}> ${glyph.cid}`)),
      { Type: 'CMap', CMapName: encodingName, CIDSystemInfo: identity, WMode: 0 }));
    const toUnicode = context.register(context.flateStream(cmap('RectoUnicode', 'bf', glyphs.map(glyph => `<${pdfCode(glyph.code)}> <${unicodeHex(glyph.unicode)}>`))));
    const reference = context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: encoding,
      DescendantFonts: [descendant], ToUnicode: toUnicode }));
    for (const pageNumber of entry.pages) {
      const page = pages[pageNumber - 1];
      const resources = page.node.Resources() || context.obj({});
      page.node.set(PDFName.of('Resources'), resources);
      const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict) || context.obj({});
      fonts.set(PDFName.of(entry.resource), reference);
      resources.set(PDFName.of('Font'), fonts);
    }
  }
}
