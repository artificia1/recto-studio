import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { ProofPage } from '../engine/proofComparison';

const limit = 75 * 1024 * 1024;
const maximumPages = 500;
const reviewTypes = new Set(['Text', 'FreeText', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Ink', 'Square', 'Circle', 'Line', 'Stamp', 'Polygon', 'PolyLine', 'Caret']);

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function draw(page: PDFPageProxy, edge: number) {
  const natural = page.getViewport({ scale: 1 });
  if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) throw new Error('The PDF contains an invalid page size.');
  const viewport = page.getViewport({ scale: edge / Math.max(natural.width, natural.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Could not create a PDF preview.');
  await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE, background: '#ffffff' }).promise;
  return { canvas, context, natural };
}

export interface PdfReviewNote { page: number; x: number; y: number; author: string; text: string }

export async function proofDifference(before: string, after: string): Promise<string> {
  if (!before || !after) return '';
  const decode = async (src: string) => { const image = new Image(); image.src = src; await image.decode(); return image; };
  const [a, b] = await Promise.all([decode(before), decode(after)]);
  if (a.width !== b.width || a.height !== b.height) return '';
  const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  ctx.drawImage(a, 0, 0);
  const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.drawImage(b, 0, 0);
  const revised = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < revised.data.length; index += 4) {
    const change = Math.max(Math.abs(original.data[index] - revised.data[index]), Math.abs(original.data[index + 1] - revised.data[index + 1]), Math.abs(original.data[index + 2] - revised.data[index + 2]));
    if (change > 18) { revised.data[index] = 180; revised.data[index + 1] = 26; revised.data[index + 2] = 68; }
    else for (let channel = 0; channel < 3; channel++) revised.data[index + channel] = 218 + revised.data[index + channel] * 0.145;
  }
  ctx.putImageData(revised, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function openReviewPdf(input: File | ArrayBuffer, signal?: AbortSignal) {
  if ((input instanceof ArrayBuffer ? input.byteLength : input.size) > limit) throw new Error('Choose a PDF up to 75 MiB.');
  const data = new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer());
  signal?.throwIfAborted();
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({ data, useSystemFonts: true, maxImageSize: 20_000_000, canvasMaxAreaInBytes: 64 * 1024 * 1024, stopAtErrors: true });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= task.destroy().catch(() => {});
  const abort = () => { void close(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maximumPages) throw new Error('Review supports up to 500 pages per PDF.');
    return {
      length: pdf.numPages,
      async scan(onProgress?: (count: number) => void): Promise<ProofPage[]> {
        const pages: ProofPage[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          signal?.throwIfAborted();
          const page = await pdf.getPage(index);
          try {
            const { canvas, context, natural } = await draw(page, 384);
            const raster = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const content = await page.getTextContent();
            const text = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ').replace(/\s+/g, ' ').trim();
            const textSignature = await digest(new TextEncoder().encode(text));
            const width = Math.round(natural.width * 100) / 100, height = Math.round(natural.height * 100) / 100;
            const artwork = await digest(new Uint8Array(raster.buffer));
            const signature = `${width}:${height}:${textSignature}:${artwork}`;
            pages.push({ width, height, textSignature, signature });
            onProgress?.(index);
          } finally { page.cleanup(); }
        }
        return pages;
      },
      async preview(index: number) {
        if (index >= pdf.numPages) return '';
        const page = await pdf.getPage(index + 1);
        try { return (await draw(page, 1100)).canvas.toDataURL('image/png'); }
        finally { page.cleanup(); }
      },
      async notes(): Promise<PdfReviewNote[]> {
        const result: PdfReviewNote[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          signal?.throwIfAborted();
          const page = await pdf.getPage(index);
          const viewport = page.getViewport({ scale: 1 });
          for (const annotation of await page.getAnnotations({ intent: 'any' })) {
            if (!reviewTypes.has(annotation.subtype)) continue;
            const text = annotation.contentsObj?.str;
            if (typeof text !== 'string' || !text.trim() || !Array.isArray(annotation.rect) || annotation.rect.length !== 4 || !annotation.rect.every(Number.isFinite)) continue;
            const [left, bottom, right, top] = annotation.rect;
            const x = (left + right) / 2, y = (top + bottom) / 2;
            const [a, b, c, d, e, f] = viewport.transform;
            const normalized = (value: number, dimension: number) => Math.max(0, Math.min(1, value / dimension));
            const author = annotation.titleObj?.str;
            if (result.length >= 2000) throw new Error('Import up to 2,000 review comments at a time.');
            result.push({ page: index - 1, x: normalized(a * x + c * y + e, viewport.width), y: normalized(b * x + d * y + f, viewport.height),
              text: text.trim().slice(0, 10000), author: typeof author === 'string' ? author.trim().slice(0, 100) || 'Reviewer' : 'Reviewer' });
          }
          page.cleanup();
        }
        return result;
      },
      async close() { signal?.removeEventListener('abort', abort); await close(); },
    };
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    await close();
    throw error;
  }
}
