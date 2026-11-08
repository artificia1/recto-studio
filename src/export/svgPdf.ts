import type { jsPDF } from 'jspdf';
import type { ImageElement } from '../types';
import { calculateImageFitting } from '../canvas';

/** Desktop/browser retain vectors. Node renders self-contained artwork at 300 dpi. */
export async function drawSvgPdf(doc: jsPDF, svgSource: string, image: ImageElement, x: number, y: number) {
  if (typeof DOMParser !== 'undefined') {
    const svg = new DOMParser().parseFromString(svgSource, 'image/svg+xml').documentElement;
    if (svg.localName !== 'svg') throw new Error('Invalid SVG artwork.');
    const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const sourceWidth = (image.equation ? parseFloat(svg.getAttribute('width') || '') : image.originalWidth) || box?.[2] || image.width;
    const sourceHeight = (image.equation ? parseFloat(svg.getAttribute('height') || '') : image.originalHeight) || box?.[3] || image.height;
    const fit = calculateImageFitting(x, y, image.width, image.height, sourceWidth * 25.4 / 96, sourceHeight * 25.4 / 96, image.fitMode || 'fit', image.focalPoint);
    const { svg2pdf } = await import('svg2pdf.js');
    await svg2pdf(svg, doc, { x: fit.drawX, y: fit.drawY, width: fit.drawW, height: fit.drawH });
  } else {
    const { Resvg } = await import('@resvg/resvg-js');
    // Intrinsic dimensions do not require scanning installed system fonts.
    const original = new Resvg(svgSource, { font: { loadSystemFonts: false } });
    const fit = calculateImageFitting(x, y, image.width, image.height, original.width * 25.4 / 96, original.height * 25.4 / 96, image.fitMode || 'fit', image.focalPoint);
    const pixels = Math.max(1, Math.ceil(fit.drawW * 300 / 25.4));
    if (!Number.isFinite(original.width) || !original.width || !original.height || pixels * pixels * original.height / original.width > 20_000_000) {
      throw new Error('SVG exceeds the 20-megapixel headless render limit. Reduce the artwork size.');
    }
    const rendered = new Resvg(svgSource, {
      fitTo: { mode: 'width', value: pixels },
      font: { loadSystemFonts: /<\s*(?:[\w-]+:)?text(?:\s|>)/i.test(svgSource) },
    }).render();
    doc.addImage(new Uint8Array(rendered.asPng()), 'PNG', fit.drawX, fit.drawY, fit.drawW, fit.drawH);
  }
}
