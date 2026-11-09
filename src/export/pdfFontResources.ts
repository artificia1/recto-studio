import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import type { jsPDF } from 'jspdf';
import { pdfCode, simpleBank, simpleCode, simpleResource, usedPdfFonts } from './pdfFonts';
import { compileVariableTrueType } from './variableTrueTypeSubset';
import { compileCff2 } from './cff2Subset';

const identity = { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 };

function cmap(name: string, kind: 'cid' | 'bf', entries: string[], oneByte = false, ros = identity) {
  const lines = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    `/CIDSystemInfo << /Registry ${ros.Registry} /Ordering ${ros.Ordering} /Supplement ${ros.Supplement} >> def`,
    `/CMapName /${name} def`, `/CMapType ${kind === 'cid' ? 1 : 2} def`,
    '1 begincodespacerange', oneByte ? '<00> <FF>' : '<0000> <FFFF>', 'endcodespacerange'];
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
    const { font, program } = entry;
    const fullCff = program.type === 'full-cff' ? program.cff : undefined;
    const simple = fullCff?.kind === 'name';
    const cff = program.type === 'cff' || program.type === 'cff2' || !!fullCff;
    const glyphs = [...entry.glyphs.values()];
    const prefix = index.toString(26).replace(/./g, digit => String.fromCharCode(65 + parseInt(digit, 26))).padStart(6, 'A');
    const family = (font.postscriptName || 'RectoEmbedded').replace(/[^A-Za-z0-9_.-]/g, '-');
    const name = fullCff?.name || (program.type === 'full-truetype' ? family : `${prefix}+${family}`);
    const glyphIds = new Map(glyphs.map(glyph => [glyph.cid, glyph.glyphId]));
    const sortedIds = () => [0, ...[...glyphIds].sort(([a], [b]) => a - b).map(([, id]) => id)];
    const compiled = program.type === 'cff2' ? compileCff2(font, sortedIds(), name) : undefined;
    const bytes = program.type === 'full-cff' ? program.cff.bytes : program.type === 'full-truetype' ? program.bytes : program.type === 'cff2' ? compiled!.bytes :
      program.type === 'variable-truetype' ? compileVariableTrueType(font, sortedIds()) : program.subset.encode();
    const stream = context.register(context.flateStream(bytes, cff ? { Subtype: simple ? 'Type1C' : 'CIDFontType0C' } : { Length1: bytes.length }));
    const scale = 1000 / font.unitsPerEm;
    const bbox = font.bbox;
    const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: name,
      Flags: (simple ? 32 : 4) | (font.italicAngle ? 64 : 0), FontBBox: (compiled?.bounds || [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]).map(value => value * scale),
      ItalicAngle: font.italicAngle || 0, Ascent: font.ascent * scale, Descent: font.descent * scale,
      CapHeight: (font.capHeight || font.ascent) * scale, StemV: 80, [cff ? 'FontFile3' : 'FontFile2']: stream }));
    const attach = (resource: string, reference: ReturnType<typeof context.register>) => {
      for (const pageNumber of entry.pages) {
        const page = pages[pageNumber - 1];
        const resources = page.node.Resources() || context.obj({});
        page.node.set(PDFName.of('Resources'), resources);
        const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict) || context.obj({});
        fonts.set(PDFName.of(resource), reference);
        resources.set(PDFName.of('Font'), fonts);
      }
    };
    if (fullCff?.kind === 'name') {
      for (let offset = 0; offset < glyphs.length; offset += 255) {
        const bank = glyphs.slice(offset, offset + 255);
        const toUnicode = context.register(context.flateStream(cmap('RectoUnicode', 'bf', bank.map(glyph => `<${simpleCode(glyph.code)}> <${unicodeHex(glyph.unicode)}>`), true)));
        const reference = context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: name, FontDescriptor: descriptor,
          FirstChar: 1, LastChar: bank.length, Widths: bank.map(glyph => glyph.width), ToUnicode: toUnicode,
          Encoding: { Type: 'Encoding', Differences: [1, ...bank.map(glyph => PDFName.of(fullCff.glyphName(glyph.glyphId)!))] } }));
        attach(simpleResource(entry.resource, simpleBank(offset + 1)), reference);
      }
      continue;
    }
    const ros = fullCff?.kind === 'cid' ? { Registry: PDFString.of(fullCff.registry), Ordering: PDFString.of(fullCff.ordering), Supplement: fullCff.supplement } : identity;
    const widths = [...new Map(glyphs.map(glyph => [glyph.cid, glyph.width]))].sort(([a], [b]) => a - b);
    const descendant = context.register(context.obj({ Type: 'Font', Subtype: cff ? 'CIDFontType0' : 'CIDFontType2', BaseFont: name,
      CIDSystemInfo: ros, FontDescriptor: descriptor, W: widths.flatMap(([cid, width]) => [cid, [width]]),
      ...(cff ? {} : { CIDToGIDMap: 'Identity' }) }));
    const encodingName = `${entry.resource}-H`;
    const encoding = !fullCff && glyphs.every(glyph => glyph.code === glyph.cid) ? PDFName.of('Identity-H') : context.register(context.flateStream(
      cmap(encodingName, 'cid', glyphs.map(glyph => `<${pdfCode(glyph.code)}> ${glyph.cid}`), false, ros),
      { Type: 'CMap', CMapName: encodingName, CIDSystemInfo: ros, WMode: 0 }));
    const toUnicode = context.register(context.flateStream(cmap('RectoUnicode', 'bf', glyphs.map(glyph => `<${pdfCode(glyph.code)}> <${unicodeHex(glyph.unicode)}>`))));
    const reference = context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: encoding,
      DescendantFonts: [descendant], ToUnicode: toUnicode }));
    attach(entry.resource, reference);
  }
}
