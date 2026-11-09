/** Native canvas is only loaded by the headless exporter, never bundled into the app. */
export async function createNodePdfRaster(bytes: Uint8Array) {
  const canvasModule = '@napi-rs/canvas', pdfModule = 'pdfjs-dist/legacy/build/pdf.mjs';
  const native = await import(/* @vite-ignore */ canvasModule);
  const engine = await import(/* @vite-ignore */ pdfModule);
  const task = engine.getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  return {
    async tile(pageIndex: number, x: number, y: number, width: number, height: number, scale: number): Promise<Uint8ClampedArray> {
      const page = await pdf.getPage(pageIndex + 1), canvas = native.createCanvas(width, height), context = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x, -y], background: '#ffffff' }).promise;
      const pixels = context.getImageData(0, 0, width, height).data; page.cleanup(); return pixels;
    },
    async destroy() { await task.destroy(); },
  };
}
