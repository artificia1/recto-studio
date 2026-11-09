import type { jsPDF } from 'jspdf';
import type { Font, Glyph, GlyphRun } from 'fontkit';
import type { ProjectState } from '../types';
import { fontManager } from '../fontManager';
import { bindFontDrawing } from './pdfFontDrawing';

export interface PdfGlyphCode { code: number; cid: number; glyphId: number; unicode: string; width: number }
type FontProgram = { type: 'cff' | 'truetype' | 'variable-truetype'; subset: ReturnType<Font['createSubset']> }
  | { type: 'cff2'; cids: Map<number, number> }
  | { type: 'full-truetype'; bytes: Uint8Array };

export interface PdfFontSubset {
  resource: string;
  font: Font;
  program: FontProgram;
  glyphs: Map<string, PdfGlyphCode>;
  pages: Set<number>;
}

const embedded = new WeakMap<jsPDF, Map<Font, PdfFontSubset>>();
export const usedPdfFonts = (doc: jsPDF) => [...(embedded.get(doc)?.values() || [])].filter(entry => entry.glyphs.size);
export const pdfCode = (code: number) => code.toString(16).padStart(4, '0');

export function pdfFontName(doc: jsPDF, family: string) {
  const font = fontManager.getFont(family);
  return font && embedded.get(doc)?.get(font)?.resource;
}

export function registerPdfFonts(doc: jsPDF, assets: ProjectState['embeddedFonts'] = []): string[] {
  const fonts = new Map<Font, PdfFontSubset>();
  embedded.set(doc, fonts);
  bindFontDrawing(doc, (...args) => drawEmbeddedText(doc, ...args));
  const warnings: string[] = [];
  for (const asset of assets) {
    const font = fontManager.getFont(asset.family);
    if (!font || fonts.has(font)) continue;
    const tables = (font as Font & { directory?: { tables: Record<string, unknown> } }).directory?.tables || {};
    const rights = font['OS/2']?.fsType as { noEmbedding?: boolean; noSubsetting?: boolean; bitmapOnly?: boolean } | undefined;
    let program: FontProgram | undefined;
    if (!rights?.noEmbedding && !rights?.bitmapOnly) {
      if (rights?.noSubsetting) {
        if (tables.glyf && !tables.fvar) {
          const source = atob(asset.data);
          // Only a standalone sfnt can be embedded byte-for-byte in FontFile2.
          if (source.startsWith('\x00\x01\x00\x00')) program = { type: 'full-truetype', bytes: Uint8Array.from(source, char => char.charCodeAt(0)) };
        }
      } else if (tables['CFF ']) program = { type: 'cff', subset: font.createSubset() };
      else if (tables.CFF2) program = { type: 'cff2', cids: new Map() };
      else if (tables.glyf) program = { type: tables.fvar ? 'variable-truetype' : 'truetype', subset: font.createSubset() };
    }
    if (!program) {
      warnings.push(`Font “${asset.family}” uses outlines because its format or embedding permissions prevent embedding.`);
      continue;
    }
    fonts.set(font, { resource: `RectoFont${fonts.size + 1}`, font, program, glyphs: new Map(), pages: new Set() });
  }
  return warnings;
}

function encode(entry: PdfFontSubset, glyph: Glyph, unicode: string): PdfGlyphCode {
  const key = `${glyph.id}:${unicode}`;
  let code = entry.glyphs.get(key);
  if (!code) {
    if (entry.glyphs.size >= 65535) throw new Error(`Font “${entry.font.fullName}” uses too many distinct PDF character codes.`);
    const { program } = entry;
    let cid = glyph.id;
    if (program.type === 'cff2') {
      cid = program.cids.get(glyph.id) || program.cids.size + 1;
      if (cid >= 65535) throw new Error('A CFF2 font subset exceeds the PDF glyph limit.');
      program.cids.set(glyph.id, cid);
    } else if (program.type !== 'full-truetype') {
      // Fontkit's declaration says boolean, but the API returns the subset glyph ID.
      cid = Number(program.subset.includeGlyph(entry.font.getGlyph(glyph.id)));
    }
    code = { code: entry.glyphs.size + 1, cid, glyphId: glyph.id, unicode, width: glyph.advanceWidth * 1000 / entry.font.unitsPerEm };
    entry.glyphs.set(key, code);
  }
  return code;
}

/** Draw shaped glyphs as PDF text when glyph order also preserves logical Unicode order. */
function drawEmbeddedText(doc: jsPDF, font: Font, run: GlyphRun, text: string, x: number, y: number, size: number, invisible = false) {
  const entry = embedded.get(doc)?.get(font);
  if (!entry || !text) return false;
  const logical = run.glyphs.map(glyph => String.fromCodePoint(...glyph.codePoints));
  const glyphs = invisible ? font.glyphsForString(text) : run.glyphs;
  if (!invisible && (logical.some(value => !value) || logical.join('') !== text)) return false;
  const values = invisible ? Array.from(text) : logical;
  if (glyphs.length !== values.length || !glyphs.length || glyphs.some(glyph => !glyph.id)) return false;
  const codes = glyphs.map((glyph, index) => encode(entry, glyph, values[index]));
  const internal = doc.internal as typeof doc.internal & {
    write(value: string): void;
    getCoordinateString(value: number): string;
    getVerticalCoordinateString(value: number): string;
  };
  entry.pages.add(doc.getNumberOfPages());
  const scale = size / internal.scaleFactor / font.unitsPerEm;
  let advance = 0;
  const operators = [`BT /${entry.resource} ${size} Tf 0 Tc 0 Tw ${invisible ? 3 : 0} Tr`];
  for (let index = 0; index < glyphs.length; index++) {
    const position = invisible ? { xOffset: 0, yOffset: 0, xAdvance: glyphs[index].advanceWidth } : run.positions[index];
    const px = internal.getCoordinateString(x + (advance + position.xOffset) * scale);
    const py = internal.getVerticalCoordinateString(y - position.yOffset * scale);
    operators.push(`1 0 0 1 ${px} ${py} Tm <${pdfCode(codes[index].code)}> Tj`);
    advance += position.xAdvance;
  }
  operators.push('ET');
  // Text rendering mode is graphics state, so keep the invisible layer local.
  internal.write(`q\n${operators.join('\n')}\nQ`);
  return true;
}
