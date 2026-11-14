import { createRequire } from 'node:module';
import path from 'node:path';
import type { ProjectState } from '../../src/types';
import { createNodePdfRaster } from '../../src/export/pdfRasterNode';

export type ProofTarget = { page: number } | { spread: number };

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
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  if (bytes.length > 64 * 1024 * 1024) throw new Error('The proof exceeds the intermediate PDF size limit.');
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const asset = (folder: string) => path.join(root, folder).replaceAll('\\', '/') + '/';
  const renderer = await createNodePdfRaster(bytes, {
    standardFontDataUrl: asset('standard_fonts'), cMapUrl: asset('cmaps'), wasmUrl: asset('wasm'),
  });
  try {
    const png = await renderer.png(selected.map(page => page.index), maxEdge);
    const image = png.bytes.length <= 3 * 1024 * 1024 ? png : await renderer.png(selected.map(page => page.index), 1024);
    return { ...image, spread: index + 1, pages: selected.map(page => page.number), warnings: [...warnings].slice(0, 30) };
  } finally { await renderer.destroy(); }
}
