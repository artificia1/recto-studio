import { pdfRangeOptions } from './pdfRanges';
import type { PdfPayload } from './pdfPayload';

/** Native canvas is only loaded by the headless exporter, never bundled into the app. */
export async function createNodePdfRaster(source: Uint8Array | PdfPayload, assets?: { standardFontDataUrl: string; cMapUrl: string; wasmUrl: string }) {
  const canvasModule = '@napi-rs/canvas', pdfModule = 'pdfjs-dist/legacy/build/pdf.mjs';
  const native = await import(/* @vite-ignore */ canvasModule);
  const engine = await import(/* @vite-ignore */ pdfModule);
  const task = engine.getDocument({
    ...(source instanceof Uint8Array ? { data: new Uint8Array(source) }
      : pdfRangeOptions(engine.PDFDataRangeTransport, source, () => { void task.destroy().catch(() => {}); })),
    useSystemFonts: false, isEvalSupported: false, ...assets,
  });
  const pdf = await task.promise.catch(async (error: unknown) => { await task.destroy(); throw error; });
  return {
    length: pdf.numPages as number,
    async locateText(query: string, matchCase: boolean, startPage: number, endPage: number, limit: number) {
      const { locateProofText } = await import('./proofTextLocator');
      const matches = [];
      let nextPage: number | null = null;
      for (let index = startPage; index <= Math.min(endPage, pdf.numPages); index++) {
        const page = await pdf.getPage(index);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const { items } = await page.getTextContent();
          const found = locateProofText(items.filter((item: { str?: string }) => typeof item.str === 'string'),
            query, matchCase, viewport, limit + 1);
          if (matches.length && matches.length + found.length > limit) {
            nextPage = index;
            break;
          }
          matches.push(...found.slice(0, limit).map(match => ({ ...match, page: index })));
          if (found.length > limit) return { matches, nextPage: index < pdf.numPages ? index + 1 : null, pageTruncated: index };
          if (matches.length >= limit || index === endPage) {
            nextPage = index < pdf.numPages ? index + 1 : null;
            break;
          }
        } finally {
          page.cleanup();
        }
      }
      return { matches, nextPage, pageTruncated: null };
    },
    async scan(pageIndices?: readonly number[]) {
      const { proofFingerprint, proofScanEdge } = await import('../engine/proofFingerprint');
      if (pdf.numPages > 500) throw new Error('Review supports up to 500 pages per PDF.');
      const pages = [];
      const selected = pageIndices ?? Array.from({ length: pdf.numPages }, (_, index) => index);
      for (const index of selected) {
        if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) throw new Error('The proof page does not exist.');
        const page = await pdf.getPage(index + 1);
        try {
          const natural = page.getViewport({ scale: 1 });
          if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) throw new Error('The PDF contains an invalid page size.');
          const viewport = page.getViewport({ scale: proofScanEdge / Math.max(natural.width, natural.height) });
          const canvas = native.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d');
          await page.render({ canvas, canvasContext: context, viewport, annotationMode: engine.AnnotationMode.DISABLE, background: '#ffffff' }).promise;
          const { items } = await page.getTextContent();
          const text = items.flatMap((item: { str?: string }) => typeof item.str === 'string' ? [item.str] : []).join(' ');
          pages.push(await proofFingerprint(text, context.getImageData(0, 0, canvas.width, canvas.height).data, natural));
        } finally { page.cleanup(); }
      }
      return pages;
    },
    async tile(pageIndex: number, x: number, y: number, width: number, height: number, scale: number): Promise<Uint8ClampedArray> {
      const page = await pdf.getPage(pageIndex + 1), canvas = native.createCanvas(width, height), context = canvas.getContext('2d');
      try {
        await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x, -y], background: '#ffffff' }).promise;
        return context.getImageData(0, 0, width, height).data;
      } finally {
        page.cleanup();
        canvas.width = canvas.height = 1;
      }
    },
    async png(pageIndices: readonly number[], maxEdge: number) {
      const pages = await Promise.all(pageIndices.map(index => pdf.getPage(index + 1)));
      const viewports = pages.map(page => page.getViewport({ scale: 1 }));
      const gutter = pages.length > 1 ? 4 : 0;
      const totalWidth = viewports.reduce((sum, view) => sum + view.width, 0);
      const height = Math.max(...viewports.map(view => view.height));
      const scale = Math.min((maxEdge - gutter * (pages.length - 1) - pages.length) / totalWidth, maxEdge / height);
      const width = viewports.reduce((sum, view) => sum + Math.ceil(view.width * scale), gutter * (pages.length - 1));
      const pixelHeight = Math.ceil(height * scale);
      const canvas = native.createCanvas(width, pixelHeight);
      const context = canvas.getContext('2d');
      context.fillStyle = '#dedede';
      context.fillRect(0, 0, width, pixelHeight);
      let left = 0;
      for (const page of pages) {
        try {
          const viewport = page.getViewport({ scale });
          const pageCanvas = native.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvas: pageCanvas, canvasContext: pageCanvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
          context.drawImage(pageCanvas, left, 0);
          left += pageCanvas.width + gutter;
        } finally { page.cleanup(); }
      }
      return { bytes: canvas.toBuffer('image/png') as Buffer, width, height: pixelHeight };
    },
    async destroy() { await task.destroy(); },
  };
}
