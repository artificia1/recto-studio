import { scanProofChanges } from '../../src/engine/rasterWasm';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ProjectState } from '../../src/types';
import { createNodePdfRaster } from '../../src/export/pdfRasterNode';
import { pdfExportPayload, type PdfPayload } from '../../src/export/pdfPayload';

export type ProofTarget = { page: number } | { spread: number };

export function openProof(bytes: Uint8Array | PdfPayload) {
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const asset = (folder: string) => path.join(root, folder).replaceAll('\\', '/') + '/';
  return createNodePdfRaster(bytes, {
    standardFontDataUrl: asset('standard_fonts'), cMapUrl: asset('cmaps'), wasmUrl: asset('wasm'),
  });
}

export async function renderProof(source: ProjectState, target: ProofTarget, maxEdge: number) {
  const index = 'spread' in target ? target.spread - 1 : source.spreads.findIndex(spread => spread.pages.some(page => page.pageNumber === target.page));
  const spread = source.spreads[index];
  if (!spread) throw new Error('The requested page or spread is missing from this layout.');
  if (spread.pages.length > 4) throw new Error('Choose an individual page from this spread.');
  const pages = spread.pages.map((page, index) => ({ index, number: page.pageNumber }));
  const selected = 'page' in target ? pages.filter(page => page.number === target.page) : pages;
  const warnings = new Set<string>();
  const { exportDocumentToPdf } = await import('../../src/export/pdfExport');
  const pdf = await exportDocumentToPdf(source, {
    spreadRange: [index], fetchExternalAssets: false, download: false, visualProof: true,
    overprintBlack: false, onWarning: warning => warnings.add(warning),
  });
  const bytes = pdfExportPayload(pdf);
  if (bytes.size > 64 * 1024 * 1024) throw new Error('The proof exceeds the intermediate PDF size limit.');
  const renderer = await openProof(bytes);
  try {
    const png = await renderer.png(selected.map(page => page.index), maxEdge);
    const image = png.bytes.length <= 3 * 1024 * 1024 ? png : await renderer.png(selected.map(page => page.index), 1024);
    return { ...image, spread: index + 1, pages: selected.map(page => page.number), warnings: [...warnings].slice(0, 30) };
  } finally { await renderer.destroy(); }
}

export async function buildProof(source: Parameters<typeof openProof>[0], page: number) {
  const renderer = await openProof(source);
  try {
    if (page > renderer.length) throw new Error(`Proof page ${page} is outside the PDF's ${renderer.length} pages.`);
    return await renderer.png([page - 1], 960);
  } finally {
    await renderer.destroy();
  }
}

export async function visualDiff(before: Awaited<ReturnType<typeof buildProof>>, after: Awaited<ReturnType<typeof buildProof>>) {
  if (before.width !== after.width || before.height !== after.height) return { comparable: false as const };
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const canvas = createCanvas(after.width, after.height);
  const context = canvas.getContext('2d');
  context.drawImage(await loadImage(before.bytes), 0, 0);
  const old = context.getImageData(0, 0, after.width, after.height);
  context.drawImage(await loadImage(after.bytes), 0, 0);
  const current = context.getImageData(0, 0, after.width, after.height);
  const diff = await scanProofChanges(old.data, current.data, after.width);
  context.putImageData(current, 0, 0);
  return { comparable: true as const, ...diff, bytes: canvas.toBuffer('image/png') };
}

export async function locatePdfProofText(source: Uint8Array, query: string, matchCase: boolean, startPage: number, pageLimit: number) {
  const renderer = await openProof(source);
  try {
    if (renderer.length > 500 || startPage > renderer.length) throw new Error('Choose a page within a PDF of up to 500 pages.');
    const result = await renderer.locateText(query, matchCase, startPage, startPage + pageLimit - 1, 30);
    const first = result.matches[0];
    if (!first) return { ...result, pageCount: renderer.length, preview: undefined };
    const proof = await renderer.png([first.page - 1], 960);
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const canvas = createCanvas(proof.width, proof.height);
    const context = canvas.getContext('2d');
    context.drawImage(await loadImage(proof.bytes), 0, 0);
    context.fillStyle = 'rgba(255, 161, 0, 0.28)';
    context.strokeStyle = '#ad5900';
    for (const { left, top, right, bottom } of first.boxes) {
      const x = left * proof.width, y = top * proof.height;
      const width = (right - left) * proof.width, height = (bottom - top) * proof.height;
      if (width <= 0 || height <= 0) continue;
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
    }
    return { ...result, pageCount: renderer.length, preview: canvas.toBuffer('image/png') };
  } finally {
    await renderer.destroy();
  }
}
