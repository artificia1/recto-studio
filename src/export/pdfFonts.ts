import type { jsPDF } from 'jspdf';
import type { Font } from 'fontkit';
import type { ProjectState } from '../types';
import { fontManager } from '../fontManager';
import { base64ToUint8Array } from '../zip';

const embedded = new WeakMap<jsPDF, Map<Font, string>>();
export function pdfFontName(doc: jsPDF, family: string): string | undefined {
  const font = fontManager.getFont(family); return font ? embedded.get(doc)?.get(font) : undefined;
}

/** Preserve shaped outlines; add searchable Unicode text using the real embedded TTF. */
export function registerPdfFonts(doc: jsPDF, assets: ProjectState['embeddedFonts'] = []): string[] {
  const fonts = new Map<Font, string>(); embedded.set(doc, fonts);
  const warnings: string[] = [];
  for (const [index, asset] of assets.entries()) {
    const font = fontManager.getFont(asset.family);
    const bytes = base64ToUint8Array(asset.data);
    if (!font) continue;
    const rights = (font as unknown as { 'OS/2'?: { fsType: { noEmbedding?: boolean; noSubsetting?: boolean; bitmapOnly?: boolean } } })['OS/2']?.fsType;
    if (Object.keys(font.variationAxes || {}).length || bytes[0] !== 0 || bytes[1] !== 1 || bytes[2] !== 0 || bytes[3] !== 0 || rights?.noEmbedding || rights?.noSubsetting || rights?.bitmapOnly) {
      warnings.push(`Font “${asset.family}” uses outlined text only. Import an embeddable, static TTF face for searchable PDF text.`);
      continue;
    }
    const name = `RectoEmbedded${index}`, file = `${name}.ttf`;
    doc.addFileToVFS(file, asset.data);
    doc.addFont(file, name, 'normal');
    const previous = doc.getFont(); doc.setFont(name, 'normal');
    const registered = doc.getFont(); doc.setFont(previous.fontName, previous.fontStyle);
    if (!('Unicode' in (registered.metadata || {}))) {
      warnings.push(`Font “${asset.family}” could not supply a PDF Unicode map; text remains outlined.`); continue;
    }
    fonts.set(font, name);
  }
  return warnings;
}

export function searchableFontText(doc: jsPDF, font: Font, text: string, x: number, y: number, size: number) {
  const name = embedded.get(doc)?.get(font);
  if (!name || !text) return;
  const previous = doc.getFont(), sizeBefore = doc.getFontSize();
  doc.setFont(name, 'normal'); doc.setFontSize(size);
  doc.text(text, x, y, { renderingMode: 'invisible' });
  doc.setFont(previous.fontName, previous.fontStyle); doc.setFontSize(sizeBefore);
}
