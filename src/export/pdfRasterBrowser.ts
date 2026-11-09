import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

export async function createBrowserPdfRaster(bytes: Uint8Array) {
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  return {
    async tile(pageIndex: number, x: number, y: number, width: number, height: number, scale: number) {
      const page = await pdf.getPage(pageIndex + 1), canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
      await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x, -y], background: '#ffffff' }).promise;
      const pixels = context.getImageData(0, 0, width, height).data; page.cleanup();
      return pixels;
    },
    async destroy() { await task.destroy(); },
  };
}
