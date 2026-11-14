import type { ProjectState } from '../types';
import { PDF_PRESETS, type PdfPreset } from '../export/presets';
import { createZipArchive, readZip } from '../zip';
import { calculateCoverSpineMetrics, PAPER_STOCK_PRESETS, type PaperStockPreset } from './spineCalculator';
import { publicationPreflight } from './publicationPreflight';

export const DELIVERY_BINDINGS = ['paperback-perfect', 'paperback-flaps', 'hardcover-case'] as const;
export type DeliveryBinding = typeof DELIVERY_BINDINGS[number];

export interface BookDeliveryRecipe {
  stock: PaperStockPreset;
  binding: DeliveryBinding;
  preset: PdfPreset;
  cover?: ProjectState;
  approvedDimensions?: string;
}

export const defaultBookDelivery: BookDeliveryRecipe = {
  stock: 'cream-60lb', binding: 'paperback-perfect', preset: 'press',
};

export function readBookDelivery(value: unknown, parseChapter: (text: string) => ProjectState): BookDeliveryRecipe {
  if (!value || typeof value !== 'object') throw new Error('Invalid book delivery recipe.');
  const recipe = value as Partial<BookDeliveryRecipe>;
  if (!recipe.stock || !Object.hasOwn(PAPER_STOCK_PRESETS, recipe.stock) || recipe.stock === 'custom' ||
    !recipe.binding || !DELIVERY_BINDINGS.includes(recipe.binding) ||
    !recipe.preset || !Object.hasOwn(PDF_PRESETS, recipe.preset) ||
    (recipe.approvedDimensions !== undefined && typeof recipe.approvedDimensions !== 'string')) {
    throw new Error('Invalid book delivery recipe.');
  }
  return { stock: recipe.stock, binding: recipe.binding, preset: recipe.preset,
    cover: recipe.cover ? parseChapter(JSON.stringify(recipe.cover)) : undefined, approvedDimensions: recipe.approvedDimensions };
}

export function bookCoverDimensions(settings: ProjectState['settings'], pageCount: number, recipe: BookDeliveryRecipe) {
  const { widthMm, heightMm, bleedMm } = settings;
  const metrics = calculateCoverSpineMetrics({ pageCount, stockPreset: recipe.stock, bindingType: recipe.binding,
    trimWidthMm: widthMm, trimHeightMm: heightMm, bleedMm });
  const width = Math.round((metrics.totalWrapWidthMm - 2 * metrics.bleedMm) * 100) / 100;
  const height = Math.round((metrics.totalWrapHeightMm - 2 * metrics.bleedMm) * 100) / 100;
  const signature = JSON.stringify([recipe.stock, recipe.binding, width, height, metrics.spineWidthMm, metrics.bleedMm]);
  const cover = recipe.cover;
  const matches = !!cover && cover.spreads.length === 1 && cover.spreads[0].pages.length === 1 &&
    Math.abs(cover.settings.widthMm - width) <= 0.02 && Math.abs(cover.settings.heightMm - height) <= 0.02 &&
    Math.abs(cover.settings.bleedMm - metrics.bleedMm) <= 0.02;
  return { width, height, signature, matches, pageCount, bleed: metrics.bleedMm, spine: metrics.spineWidthMm };
}

export async function buildBookDelivery(source: ProjectState, delivery: BookDeliveryRecipe, isolatedFonts = false) {
  const book = structuredClone(source);
  const recipe = structuredClone(delivery);
  const dimensions = bookCoverDimensions(book.settings, book.spreads.reduce((count, spread) => count + spread.pages.length, 0), recipe);
  if (!recipe.cover || !dimensions.matches) throw new Error('Choose a one-page cover with the required trim dimensions and bleed.');
  if (recipe.approvedDimensions !== dimensions.signature) throw new Error('Review and approve the cover dimensions for this book before exporting.');
  const warnings: string[] = [];
  const { exportDocumentToPdf } = await import('../export/pdfExport');
  const { exportDocumentToEpubAsync } = await import('../epubExport');
  const pdfOptions = { ...PDF_PRESETS[recipe.preset].options, spreadRange: 'all' as const,
    download: false, strict: true, onWarning: (warning: string) => warnings.push(warning) };
  const withFonts = async <T>(project: ProjectState, run: () => Promise<T>) => {
    if (!isolatedFonts) return run();
    const { fontManager } = await import('../fontManager');
    return fontManager.withProjectFonts(project.embeddedFonts, run);
  };
  const interior = new Uint8Array((await withFonts(book, () => exportDocumentToPdf(book, pdfOptions))).output('arraybuffer'));
  const coverProject = recipe.cover;
  const cover = new Uint8Array((await withFonts(coverProject, () => exportDocumentToPdf(coverProject, pdfOptions))).output('arraybuffer'));
  const ebook = await withFonts(book, () => exportDocumentToEpubAsync(book, { download: false, strict: true }));
  warnings.push(...ebook.warnings);

  const { PDFDocument } = await import('pdf-lib');
  const expectedPages = (await PDFDocument.load(interior)).getPageCount() === dimensions.pageCount &&
    (await PDFDocument.load(cover)).getPageCount() === 1;
  const epubFiles = await readZip(ebook.buffer, 256 * 1024 * 1024);
  if (!expectedPages || new TextDecoder().decode(epubFiles.get('mimetype')) !== 'application/epub+zip' ||
    !epubFiles.has('META-INF/container.xml')) throw new Error('One or more delivery files failed the package checks.');
  const report = { title: book.settings.title, preset: recipe.preset, dimensions,
    checks: ['Interior and cover page counts', 'EPUB mimetype and container'],
    issues: publicationPreflight(book, 'print'), warnings };
  return createZipArchive({ 'interior.pdf': interior, 'cover.pdf': cover, 'ebook.epub': ebook.buffer,
    'delivery-report.json': JSON.stringify(report, null, 2) });
}
