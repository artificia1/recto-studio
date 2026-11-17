import type { ProjectState } from '../types';
import { getRasterWasm, loadRasterWasm } from '../engine/rasterWasm';

export const bindingModes = ['saddle-stitch', 'perfect-bound', 'consecutive-2up', 'mini-zine-8page'] as const;
export type ImpositionBindingMode = typeof bindingModes[number];

export interface ImpositionSheetSide {
  sheetIndex: number;
  side: 'front' | 'back';
  sideNumber: number;
  leftPageNumber: number | null;
  rightPageNumber: number | null;
  leftCreepMm: number;
  rightCreepMm: number;
  signatureIndex: number;
  /** Eight panels in top-to-bottom, left-to-right sheet order. */
  panels?: (number | null)[];
}

export interface ImpositionOptions {
  bindingMode?: ImpositionBindingMode;
  signatureSize?: number;
  creepMmPerSheet?: number;
  includeCutMarks?: boolean;
  includeFoldLine?: boolean;
  includeSheetMetadata?: boolean;
  paperStockWeightGsm?: number;
}

export type ImpositionPlan = ReturnType<typeof planImposition>;

function sheetSide(index: number, sheetIndex: number, back: boolean, signatureIndex: number,
  creep: number, panels: (number | null)[]): ImpositionSheetSide {
  return { sheetIndex, side: back ? 'back' : 'front', sideNumber: index + 1, signatureIndex,
    leftPageNumber: panels[0], rightPageNumber: panels[1], leftCreepMm: creep ? -creep : 0, rightCreepMm: creep,
    ...(panels.length === 8 ? { panels } : {}) };
}

export function planImposition(totalPagesOriginal: number, pageWidthMm: number, pageHeightMm: number,
  options: ImpositionOptions = {}) {
  const bindingMode = options.bindingMode ?? 'saddle-stitch';
  const mode = bindingModes.indexOf(bindingMode);
  const zine = mode === 3;
  const signature = options.signatureSize || 16;
  const creep = options.creepMmPerSheet ?? (options.paperStockWeightGsm || 80) * 0.001;
  const creepPerSheetMm = mode < 2 ? creep : 0;
  if (!Number.isSafeInteger(totalPagesOriginal) || totalPagesOriginal < 0 || totalPagesOriginal > 4096 ||
      !Number.isSafeInteger(signature) || signature < 1 || signature > 4096 ||
      ![pageWidthMm, pageHeightMm].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(creep) || creep < 0 || mode < 0) throw new Error('Choose valid publication dimensions and imposition settings.');
  let signatureSizePages = mode === 0 ? Math.max(4, Math.ceil(totalPagesOriginal / 4) * 4)
    : zine ? 8 : mode === 2 ? 4 : Math.ceil(signature / 4) * 4;
  let signaturesCount = Math.max(1, Math.ceil(totalPagesOriginal / signatureSizePages));
  let totalPagesPadded = signaturesCount * signatureSizePages;
  let sheetsCount = totalPagesPadded / (zine ? 8 : 4);
  const sheetSides: ImpositionSheetSide[] = [];
  const scratch = getRasterWasm();
  const native = scratch?.imposition_plan?.(totalPagesOriginal, mode, signature);
  if (native && scratch) {
    const output = new DataView(scratch.memory.buffer, scratch.raster_output(), 20 + native * 48);
    totalPagesPadded = output.getUint32(4, true);
    sheetsCount = output.getUint32(8, true);
    signatureSizePages = output.getUint32(12, true);
    signaturesCount = output.getUint32(16, true);
    for (let i = 0; i < native; i++) {
      const read = (field: number) => output.getUint32(20 + i * 48 + field * 4, true);
      const panels = Array.from({ length: zine ? 8 : 2 }, (_, slot) => read(slot + 4) || null);
      sheetSides.push(sheetSide(i, read(0), !!read(1), read(2), read(3) * creepPerSheetMm, panels));
    }
  } else {
    const sheetsPerSignature = signatureSizePages / 4;
    for (let i = 0; i < sheetsCount * (zine ? 1 : 2); i++) {
      const sheet = zine ? i : Math.floor(i / 2);
      const back = !zine && i % 2 === 1;
      if (zine || mode === 2) {
        const pages = zine ? [5, 4, 3, 2, 6, 7, 8, 1].map(page => sheet * 8 + page) : [i * 2 + 1, i * 2 + 2];
        sheetSides.push(sheetSide(i, sheet, back, zine ? sheet : 0, 0, pages.map(page => page <= totalPagesOriginal ? page : null)));
      } else {
        const group = Math.floor(sheet / sheetsPerSignature), inner = sheet % sheetsPerSignature;
        const low = group * signatureSizePages + 1 + 2 * inner, high = (group + 1) * signatureSizePages - 2 * inner;
        const pages = back ? [low + 1, high - 1] : [high, low];
        sheetSides.push(sheetSide(i, sheet, back, group, inner * creepPerSheetMm, pages.map(page => page <= totalPagesOriginal ? page : null)));
      }
    }
  }
  return { bindingMode, totalPagesOriginal, totalPagesPadded, blankPagesAdded: totalPagesPadded - totalPagesOriginal,
    sheetsCount, signatureSizePages, signaturesCount, sheetWidthMm: pageWidthMm * (zine ? 4 : 2),
    sheetHeightMm: pageHeightMm * (zine ? 2 : 1), pageWidthMm, pageHeightMm, creepPerSheetMm,
    maxCreepMm: sheetSides.reduce((maximum, side) => Math.max(maximum, side.rightCreepMm), 0), sheetSides };
}

export function calculateImpositionPlan(state: ProjectState, options?: ImpositionOptions) {
  return planImposition(state.spreads.reduce((sum, spread) => sum + spread.pages.length, 0),
    state.settings.widthMm || 210, state.settings.heightMm || 297, options);
}

export async function exportImposedBookletPdf(state: ProjectState, options: ImpositionOptions = {}) {
  const [{ exportDocumentToPdf }, { loadPdfChunks }, { pdfExportPayload }, { exportSignatureSheetProof }] = await Promise.all([
    import('./pdfExport'), import('./pdfChunkReader'), import('./pdfPayload'), import('./signatureSheetProof'), loadRasterWasm(),
  ]);
  const plan = calculateImpositionPlan(state, options);
  if (!plan.totalPagesOriginal) throw new Error('Add a page before exporting imposed sheets.');
  const interior = await exportDocumentToPdf(state, { download: false, includeCropMarks: false });
  return exportSignatureSheetProof(await loadPdfChunks(pdfExportPayload(interior)), plan, options);
}
