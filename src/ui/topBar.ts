// Papercut Studio Top Navigation & Global Header Controller
import { stateManager } from '../state/stateManager';
import { exportDocumentToPdf } from '../export/pdfExport';
import { exportDocumentToEpub } from '../epubExport';
import { exportDocumentToFlipbook } from '../flipbookExport';
import { packageDocument } from '../packageExport';

export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];

/** Formats a numeric zoom level (e.g. 1.25) to a clean human percentage (125%). */
export function formatZoomPercentage(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/** Steps the viewport zoom in or out to the nearest preset. */
export function stepZoom(currentZoom: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    const next = ZOOM_PRESETS.find((z) => z > currentZoom + 0.01);
    return next ?? Math.min(8.0, currentZoom * 1.25);
  } else {
    const reversed = [...ZOOM_PRESETS].reverse();
    const prev = reversed.find((z) => z < currentZoom - 0.01);
    return prev ?? Math.max(0.1, currentZoom * 0.8);
  }
}

/** Dispatches a standard undo action to the state stack. */
export function triggerUndo(): void {
  stateManager.undo();
}

/** Dispatches a standard redo action to the state stack. */
export function triggerRedo(): void {
  stateManager.redo();
}

/** Triggers full print-ready PDF export with crop marks and bleeds. */
export async function triggerPdfExport(): Promise<void> {
  const state = stateManager.getState();
  await exportDocumentToPdf(state, {
    includeBleed: true,
    includeCropMarks: true,
    includeRegistrationMarks: true,
    includeColorBars: true,
    spreadRange: 'all',
  });
}

/** Triggers EPUB 3 digital output package generation. */
export async function triggerEpubExport(): Promise<void> {
  const state = stateManager.getState();
  await exportDocumentToEpub(state);
}

/** Triggers interactive web flipbook export package generation. */
export async function triggerFlipbookExport(): Promise<void> {
  const state = stateManager.getState();
  await exportDocumentToFlipbook(state);
}

/** Triggers one-click print document packaging. */
export async function triggerPrintPackage(): Promise<void> {
  const state = stateManager.getState();
  await packageDocument(state, { download: true });
}
