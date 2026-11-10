import type { ImageAdjustments } from '../types';

export const neutralAdjustments: ImageAdjustments = { black: 0, white: 255, gamma: 1, curve: [] };

export function applyImageAdjustments(data: Uint8Array | Uint8ClampedArray, settings: ImageAdjustments) {
  const points = [{ input: 0, output: 0 }, ...settings.curve, { input: 255, output: 255 }];
  const values = new Uint8Array(256);
  let segment = 0;
  for (let input = 0; input < 256; input++) {
    const normalized = Math.max(0, Math.min(1, (input - settings.black) / (settings.white - settings.black)));
    const level = 255 * Math.pow(normalized, 1 / settings.gamma);
    while (segment < points.length - 2 && level > points[segment + 1].input) segment++;
    const from = points[segment], to = points[segment + 1];
    values[input] = Math.round(from.output + (to.output - from.output) * (level - from.input) / (to.input - from.input));
  }
  for (let offset = 0; offset < data.length; offset += 4) {
    if (settings.grayscale) {
      const gray = values[Math.round(0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2])];
      data[offset] = data[offset + 1] = data[offset + 2] = gray;
    } else {
      data[offset] = values[data[offset]];
      data[offset + 1] = values[data[offset + 1]];
      data[offset + 2] = values[data[offset + 2]];
    }
  }
}

export async function adjustedRasterSource(source: string, settings: ImageAdjustments) {
  const { decodeSrgbRaster } = await import('./rasterPixels');
  const { uint8ArrayToBase64 } = await import('../zip');
  const { data, width, height } = await decodeSrgbRaster(source);
  applyImageAdjustments(data, settings);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not render adjusted artwork.');
    const pixels = context.createImageData(width, height);
    pixels.data.set(data);
    context.putImageData(pixels, 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    return `data:image/png;base64,${uint8ArrayToBase64(new Uint8Array(await png.arrayBuffer()))}`;
  }
  const nativeCanvas = '@napi-rs/canvas';
  const { createCanvas } = await import(/* @vite-ignore */ nativeCanvas);
  const canvas = createCanvas(width, height), context = canvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  pixels.data.set(data);
  context.putImageData(pixels, 0, 0);
  return `data:image/png;base64,${uint8ArrayToBase64(canvas.toBuffer('image/png'))}`;
}

export function adjustedCanvasBitmap(source: HTMLImageElement | HTMLCanvasElement, settings: ImageAdjustments) {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyImageAdjustments(pixels.data, settings);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
