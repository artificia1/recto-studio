import { jsPDF } from 'jspdf';
import type { ProjectState, ColorManagementSettings } from '../types';
import { profileBytes } from '../engine/iccProfiles';
import { convertIcc } from '../engine/colorService';
import { explicitCmyk, rgbColor, type Cmyk } from '../engine/inkColors';
import { setManagedPdfColors } from './pdfColors';
import { decodeSrgbRaster } from '../engine/rasterPixels';

function binary(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return chunks.join('');
}

// jsPDF's DeviceCMYK image writer uses an inverted Decode array. Store
// complemented samples so the decoded plate values match the LCMS result.
(jsPDF.API as any).processRECTOCMYK = (bytes: Uint8Array, index: number, alias: string) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4), height = view.getUint32(8), imageLength = view.getUint32(12), alphaLength = view.getUint32(16);
  if (!width || !height || width * height > 40_000_000 || 20 + imageLength + alphaLength !== bytes.length) throw new Error('Invalid managed raster payload.');
  return { index, alias, width, height, colorSpace: 'DeviceCMYK', bitsPerComponent: 8, filter: 'FlateDecode', predictor: 1,
    data: binary(bytes.subarray(20, 20 + imageLength)),
    ...(alphaLength ? { sMask: binary(bytes.subarray(20 + imageLength)), sMaskBitsPerComponent: 8 } : {}) };
};

function addOutputIntent(doc: jsPDF, settings: ColorManagementSettings, bytes: Uint8Array) {
  const internal = doc.internal as any;
  let profileId = 0, intentId = 0;
  const description = settings.outputProfile.description.replace(/[^\x20-\x7e]/g, '?');
  internal.events.subscribe('putResources', () => {
    profileId = internal.newObject();
    internal.putStream({ data: binary(bytes), additionalKeyValues: [{ key: 'N', value: '4' }, { key: 'Alternate', value: '/DeviceCMYK' }] });
    internal.write('endobj');
    intentId = internal.newObject();
    internal.write(`<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (Custom) /Info (${internal.pdfEscape(description)}) /DestOutputProfile ${profileId} 0 R >>`);
    internal.write('endobj');
  });
  internal.events.subscribe('putCatalog', () => internal.write(`/OutputIntents [${intentId} 0 R]`));
}

const colorFields = new Set(['color', 'fillColor', 'strokeColor', 'backgroundColor', 'borderColor', 'textColor', 'headerFillColor', 'headerTextColor', 'footerFillColor', 'footerTextColor', 'alternateRowColor']);
function collectColors(state: ProjectState): string[] {
  const colors = new Set(['#000000', '#ffffff', '#222222', '#333333', '#555555', '#e8e8e8', '#f9f9f9', 'black', 'white']);
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (colorFields.has(key) && typeof child === 'string') {
        const color = child.trim().toLowerCase();
        if (color && color !== 'transparent' && color !== 'none' && !explicitCmyk(color)) colors.add(color);
      } else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(state.spreads); visit(state.masterSpreads); visit(state.paragraphStyles); visit(state.characterStyles);
  if (colors.size > 4096) throw new Error('ICC export supports up to 4,096 distinct vector colours.');
  return [...colors];
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}


export async function prepareManagedPdf(doc: jsPDF, state: ProjectState) {
  const settings = state.settings.colorManagement;
  if (!settings?.convertPdf) return undefined;
  const profile = profileBytes(settings.outputProfile);
  const transform = (pixels: Uint8Array) => convertIcc({ profile, pixels, direction: 'rgb-to-cmyk', intent: settings.intent,
    blackPointCompensation: settings.blackPointCompensation, preservePureBlack: settings.preservePureBlack });
  const names = collectColors(state), pixels = new Uint8Array(names.length * 3);
  names.forEach((name, index) => {
    const color = rgbColor(name);
    if (!color) throw new Error(`ICC export cannot interpret colour “${name}”. Use a hex, RGB or CMYK colour, or flatten the artwork.`);
    pixels.set(color, index * 3);
  });
  const converted = await transform(pixels), colors = new Map<string, Cmyk>();
  names.forEach((name, index) => colors.set(name, Array.from(converted.subarray(index * 4, index * 4 + 4), channel => channel / 255 * 100) as Cmyk));
  setManagedPdfColors(doc, colors);
  addOutputIntent(doc, settings, profile);
  const cache = new Map<string, Promise<{ width: number; height: number; bytes: Uint8Array; alias: string }>>();
  let nextRaster = 0;
  return {
    raster(src: string) {
      if (!cache.has(src)) {
        const alias = `RectoICC${++nextRaster}`;
        cache.set(src, (async () => {
        const image = await decodeSrgbRaster(src), count = image.width * image.height;
        const ink = new Uint8Array(count * 4), alpha = new Uint8Array(count);
        let transparent = false;
        for (let start = 0; start < count; start += 262144) {
          const length = Math.min(262144, count - start), rgb = new Uint8Array(length * 3);
          for (let pixel = 0; pixel < length; pixel++) {
            const offset = (start + pixel) * 4;
            rgb.set(image.data.subarray(offset, offset + 3), pixel * 3);
            alpha[start + pixel] = image.data[offset + 3]; transparent ||= alpha[start + pixel] < 255;
          }
          const tile = await transform(rgb);
          for (let byte = 0; byte < tile.length; byte++) ink[start * 4 + byte] = 255 - tile[byte];
        }
        const data = await deflate(ink), mask = transparent ? await deflate(alpha) : new Uint8Array();
        const bytes = new Uint8Array(20 + data.length + mask.length), view = new DataView(bytes.buffer);
        bytes.set([82, 67, 77, 89]);
        view.setUint32(4, image.width); view.setUint32(8, image.height); view.setUint32(12, data.length); view.setUint32(16, mask.length);
        bytes.set(data, 20); bytes.set(mask, 20 + data.length);
        return { width: image.width, height: image.height, bytes, alias };
      })());
      }
      return cache.get(src)!;
    },
  };
}
