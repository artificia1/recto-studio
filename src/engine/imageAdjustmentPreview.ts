import type { ImageAdjustments } from '../types';
import { adjustedCanvasBitmap, adjustmentPreviewSize } from './imageAdjustments';

export async function renderAdjustmentPreview(source: HTMLImageElement | HTMLCanvasElement,
  settings: ImageAdjustments, maxPixels: number, signal: AbortSignal): Promise<ImageBitmap | HTMLCanvasElement | null> {
  if (signal.aborted) return null;
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined;
    try {
      const size = adjustmentPreviewSize(source, maxPixels);
      bitmap = await createImageBitmap(source, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' });
      if (signal.aborted) return null;
      const result = await submit(bitmap, settings, signal);
      if (result) return result;
    } catch {
      // Older WebViews and unsupported image sources use the same bounded preview on the main thread.
    } finally {
      bitmap?.close();
    }
  }
  if (signal.aborted) return null;
  const result = adjustedCanvasBitmap(source, settings, maxPixels);
  return result instanceof HTMLCanvasElement && result !== source ? result : null;
}

function submit(bitmap: ImageBitmap, settings: ImageAdjustments, signal: AbortSignal): Promise<ImageBitmap | null> {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./imageAdjustmentWorker.ts', import.meta.url), { type: 'module' });
    const cancel = () => finish(null);
    const timeout = setTimeout(cancel, 10_000);
    function finish(image: ImageBitmap | null) {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      resolve(image);
    }
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<ImageBitmap | null>) => finish(event.data);
    worker.onerror = worker.onmessageerror = cancel;
    try { worker.postMessage({ bitmap, settings }, [bitmap]); }
    catch { cancel(); }
  });
}
