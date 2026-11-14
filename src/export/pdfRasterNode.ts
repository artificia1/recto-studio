/** Native canvas is only loaded by the headless exporter, never bundled into the app. */
export async function createNodePdfRaster(bytes: Uint8Array, assets?: { standardFontDataUrl: string; cMapUrl: string; wasmUrl: string }) {
  const canvasModule = '@napi-rs/canvas', pdfModule = 'pdfjs-dist/legacy/build/pdf.mjs';
  const native = await import(/* @vite-ignore */ canvasModule);
  const engine = await import(/* @vite-ignore */ pdfModule);
  const task = engine.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false, ...assets });
  const pdf = await task.promise.catch(async (error: unknown) => { await task.destroy(); throw error; });
  return {
    async tile(pageIndex: number, x: number, y: number, width: number, height: number, scale: number): Promise<Uint8ClampedArray> {
      const page = await pdf.getPage(pageIndex + 1), canvas = native.createCanvas(width, height), context = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x, -y], background: '#ffffff' }).promise;
      const pixels = context.getImageData(0, 0, width, height).data; page.cleanup(); return pixels;
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
