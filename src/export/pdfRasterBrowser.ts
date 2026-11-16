import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { pdfRangeOptions } from './pdfRanges';
import type { PdfPayload } from './pdfPayload';

export async function createBrowserPdfRaster(source: PdfPayload) {
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({
    ...pdfRangeOptions(PDFDataRangeTransport, source, () => { void task.destroy().catch(() => {}); }),
    useSystemFonts: false,
  });
  const pdf = await task.promise.catch(async error => { await task.destroy(); throw error; });
  return {
    async tile(pageIndex: number, x: number, y: number, width: number, height: number, scale: number) {
      const page = await pdf.getPage(pageIndex + 1), canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      try {
        const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!context) throw new Error('Could not create a PDF raster tile.');
        await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x, -y], background: '#ffffff' }).promise;
        return context.getImageData(0, 0, width, height).data;
      } finally {
        page.cleanup();
        canvas.width = canvas.height = 1;
      }
    },
    async destroy() { await task.destroy(); },
  };
}
