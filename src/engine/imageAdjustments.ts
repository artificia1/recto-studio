import type { ImageAdjustments } from '../types';
import { adjustDesktopRaster } from '../desktop';

import { adjustmentLookup, applyImageAdjustments, applyLookup } from './imageAdjustmentMath';
export { applyImageAdjustments, neutralAdjustments } from './imageAdjustmentMath';

export async function adjustedRasterSource(source: string, settings: ImageAdjustments) {
  const { decodeSrgbRaster } = await import('./rasterPixels');
  const { uint8ArrayToBase64 } = await import('../zip');
  const { data, width, height } = await decodeSrgbRaster(source);
  const values = adjustmentLookup(settings);
  const grayscale = !!settings.grayscale;
  const processed = data.length >= 64 * 1024
    ? await import('./rasterWasm').then(module => module.mutateWasmRaster(data, values, grayscale)).catch(() => 0)
    : 0;
  if (processed < data.length && (processed > 0 || !await adjustDesktopRaster(data, values, grayscale))) {
    applyLookup(data.subarray(processed), values, grayscale);
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    let png: Blob;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not render adjusted artwork.');
      const pixels = typeof ImageData === 'function'
        ? new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), width, height)
        : context.createImageData(width, height);
      if (pixels.data.buffer !== data.buffer) pixels.data.set(data);
      context.putImageData(pixels, 0, 0);
      png = await canvas.convertToBlob({ type: 'image/png' });
    } finally {
      canvas.width = canvas.height = 0;
    }
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

export function adjustmentPreviewSize(source: HTMLImageElement | HTMLCanvasElement, maxPixels: number) {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, 1600 / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function adjustedCanvasBitmap(source: HTMLImageElement | HTMLCanvasElement, settings: ImageAdjustments, maxPixels: number) {
  const canvas = document.createElement('canvas');
  const size = adjustmentPreviewSize(source, maxPixels);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyImageAdjustments(pixels.data, settings);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
