/// <reference lib="webworker" />
import type { ImageAdjustments } from '../types';
import { applyImageAdjustments } from './imageAdjustmentMath';

self.onmessage = (event: MessageEvent<{ bitmap: ImageBitmap; settings: ImageAdjustments }>) => {
  const { bitmap, settings } = event.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image adjustment context unavailable.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    applyImageAdjustments(pixels.data, settings);
    context.putImageData(pixels, 0, 0);
    const result = canvas.transferToImageBitmap();
    self.postMessage(result, [result]);
  } catch {
    self.postMessage(null);
  } finally {
    bitmap.close();
  }
};
