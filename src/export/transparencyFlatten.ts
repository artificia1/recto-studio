import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import type { CanvasElement, ProjectState } from '../types';
import { convertIcc } from '../engine/colorService';
import { profileBytes } from '../engine/iccProfiles';
import { requirePdfFonts } from './pdfPress';

export interface PixelRect { x: number; y: number; width: number; height: number }

/** A non-overlapping rectangle union keeps even-odd clipping correct at overlaps. */
export function flattenRegions(rects: PixelRect[]): PixelRect[] {
  const ys = [...new Set(rects.flatMap(rect => [rect.y, rect.y + rect.height]))].sort((a, b) => a - b), result: PixelRect[] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const ranges = rects.filter(rect => rect.y < ys[i + 1] && rect.y + rect.height > ys[i]).map(rect => [rect.x, rect.x + rect.width]).sort((a, b) => a[0] - b[0]);
    let left: number | undefined, right = 0;
    const flush = () => { if (left !== undefined) result.push({ x: left, y: ys[i], width: right - left, height: ys[i + 1] - ys[i] }); };
    for (const [a, b] of ranges) { if (left === undefined) { left = a; right = b; } else if (a <= right) right = Math.max(right, b); else { flush(); left = a; right = b; } }
    flush();
  }
  return result;
}

function bounds(element: CanvasElement, origin: number, scale: number): PixelRect {
  const angle = (element.rotation || 0) * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const stroke = element.type === 'shape' || element.type === 'path' ? element.strokeWidthMm : element.borderWidthMm;
  const extra = (element.type === 'text' ? 1.2 : 0.3) + Math.max(0, stroke || 0) * 2;
  if (element.type === 'path' && element.nodes.length) {
    const cos = Math.cos(angle), sin = Math.sin(angle), xs: number[] = [], ys: number[] = [];
    for (const node of element.nodes) for (const handle of [{ x: 0, y: 0 }, node.handleIn, node.handleOut].filter((point): point is { x: number; y: number } => !!point)) {
      const x = node.x + handle.x - element.width / 2, y = node.y + handle.y - element.height / 2;
      xs.push((origin + element.x + element.width / 2 + x * cos - y * sin) * scale); ys.push((origin + element.y + element.height / 2 + x * sin + y * cos) * scale);
    }
    const minimum = (values: number[]) => values.reduce((a, b) => Math.min(a, b), Infinity), maximum = (values: number[]) => values.reduce((a, b) => Math.max(a, b), -Infinity);
    const x = Math.floor(minimum(xs) - extra * scale), y = Math.floor(minimum(ys) - extra * scale);
    return { x, y, width: Math.ceil(maximum(xs) + extra * scale) - x, height: Math.ceil(maximum(ys) + extra * scale) - y };
  }
  const width = (element.width * c + element.height * s + 2 * extra) * scale, height = (element.width * s + element.height * c + 2 * extra) * scale;
  return { x: Math.floor((origin + element.x + element.width / 2) * scale - width / 2), y: Math.floor((origin + element.y + element.height / 2) * scale - height / 2), width: Math.ceil(width) + 1, height: Math.ceil(height) + 1 };
}

const intersects = (a: PixelRect, b: PixelRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
/** Rasterize transparency regions, retain vectors elsewhere, then remove live transparency resources. */
export async function flattenPdfTransparency(bytes: Uint8Array, state: ProjectState, pageArtwork: CanvasElement[][], originMm: number, dpi = 300) {
  if (!Number.isFinite(dpi) || dpi < 150 || dpi > 600) throw new Error('Flattening resolution must be between 150 and 600 dpi.');
  const settings = state.settings.colorManagement;
  if (!settings?.convertPdf) throw new Error('Import a CMYK output ICC profile and enable PDF conversion before flattening for print.');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false }), scale = dpi / 72, mmScale = dpi / 25.4;
  if (pdf.getPageCount() !== pageArtwork.length) throw new Error('The flattening page map does not match the PDF.');
  const plans = pdf.getPages().map((page, index) => {
    const elements = pageArtwork[index];
    if (elements.some(element => element.shadow)) throw new Error('Supply pre-rendered shadow artwork before flattening. This PDF exporter does not reproduce object shadows.');
    const width = Math.ceil(page.getWidth() * scale), height = Math.ceil(page.getHeight() * scale);
    const transparent = elements.filter(element => element.opacity < 1 || (element.blendMode && element.blendMode !== 'normal') || (element.type === 'image' && (element.equation || !/^data:image\/jpe?g[;,]/i.test(element.src))));
    const clipped = transparent.map(element => bounds(element, originMm, mmScale)).map(rect => {
      const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
      return { x, y, width: Math.min(width, rect.x + rect.width) - x, height: Math.min(height, rect.y + rect.height) - y };
    }).filter(rect => rect.width > 0 && rect.height > 0);
    const regions = clipped.length > 500 ? [{ x: 0, y: 0, width, height }] : flattenRegions(clipped);
    if (elements.some(element => element.spotColor && regions.some(region => intersects(region, bounds(element, originMm, mmScale))))) throw new Error('A transparency region intersects a spot ink. Use live transparency or have the printer flatten this spot-colour interaction.');
    if (page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size()) throw new Error('Remove interactive annotations before creating a flattened print PDF.');
    if (transparent.some(element => element.type === 'table' && element.rowSizing !== 'content')) throw new Error('Choose content-sized rows before flattening a transparent table.');
    return regions;
  });
  const hasRegions = plans.some(regions => regions.length);
  if (hasRegions) requirePdfFonts(pdf);
  const renderer = !hasRegions ? undefined : typeof document === 'undefined' ? await (await import('./pdfRasterNode')).createNodePdfRaster(bytes) : await (await import('./pdfRasterBrowser')).createBrowserPdfRaster(bytes);
  let rasterTiles = 0, pixelsProcessed = 0;
  try {
    for (const [index, page] of pdf.getPages().entries()) {
      const regions = plans[index]; if (!regions.length) continue;
      const parts = [`q 0 0 ${page.getWidth()} ${page.getHeight()} re`];
      for (const region of regions) parts.push(`${region.x / scale} ${page.getHeight() - (region.y + region.height) / scale} ${region.width / scale} ${region.height / scale} re`);
      parts.push('W* n');
      const original = page.node.get(PDFName.of('Contents'));
      const originalStreams = original ? pdf.context.lookup(original) : undefined;
      const contents = PDFArray.withContext(pdf.context);
      contents.push(pdf.context.register(pdf.context.flateStream(parts.join('\n'))));
      if (originalStreams instanceof PDFArray) for (const value of originalStreams.asArray()) contents.push(value);
      else if (original) contents.push(original);
      contents.push(pdf.context.register(pdf.context.flateStream('Q')));
      page.node.set(PDFName.of('Contents'), contents);
      const resources = page.node.Resources() || pdf.context.obj({}); page.node.set(PDFName.of('Resources'), resources);
      // Shared jsPDF resource dictionaries need a unique XObject dictionary per page.
      const ownResources = resources.clone(pdf.context), oldImages = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
      const images = oldImages?.clone(pdf.context) || pdf.context.obj({}); ownResources.set(PDFName.of('XObject'), images); page.node.set(PDFName.of('Resources'), ownResources);
      const draw: string[] = [];
      for (const region of regions) for (let dy = 0; dy < region.height; dy += 1024) for (let dx = 0; dx < region.width; dx += 1024) {
        const width = Math.min(1024, region.width - dx), height = Math.min(1024, region.height - dy), x = region.x + dx, y = region.y + dy;
        pixelsProcessed += width * height;
        if (pixelsProcessed > 250_000_000 || ++rasterTiles > 4096) throw new Error('This flattening job exceeds 250 million pixels or 4,096 tiles. Export a smaller page range.');
        const rgba = await renderer!.tile(index, x, y, width, height, scale), rgb = new Uint8Array(width * height * 3);
        for (let p = 0; p < width * height; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(255 + (rgba[p * 4 + c] - 255) * rgba[p * 4 + 3] / 255);
        const cmyk = await convertIcc({ pixels: rgb, profile: profileBytes(settings.outputProfile), direction: 'rgb-to-cmyk', intent: settings.intent, blackPointCompensation: settings.blackPointCompensation, preservePureBlack: settings.preservePureBlack });
        const image = pdf.context.register(pdf.context.flateStream(cmyk, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }));
        const name = `RectoFlat${rasterTiles}`; images.set(PDFName.of(name), image);
        draw.push(`q ${width / scale} 0 0 ${height / scale} ${x / scale} ${page.getHeight() - (y + height) / scale} cm /${name} Do Q`);
      }
      contents.push(pdf.context.register(pdf.context.flateStream(draw.join('\n'))));
    }
  } finally { await renderer?.destroy(); }
  const seen = new Set<object>();
  const scrub = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return; seen.add(value);
    if (value instanceof PDFRawStream) { scrub(value.dict); return; }
    if (value instanceof PDFDict) {
      for (const key of ['SMask', 'SMaskInData', 'ca', 'CA', 'BM']) value.delete(PDFName.of(key));
      const group = value.lookupMaybe(PDFName.of('Group'), PDFDict);
      if (group?.get(PDFName.of('S'))?.toString() === '/Transparency') value.delete(PDFName.of('Group'));
      for (const [, child] of value.entries()) scrub(child);
    } else if (value instanceof PDFArray) value.asArray().forEach(scrub);
  };
  pdf.context.enumerateIndirectObjects().forEach(([, value]) => scrub(value));
  return { bytes: await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }), rasterTiles, flattenedPages: plans.filter(regions => regions.length).length };
}
