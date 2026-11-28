/**
 * The part of in-place text editing that the startup bundle needs: whether it is switched on and
 * whether a frame can be edited that way. The editor itself (`interaction/liveTextEditor` and the
 * geometry in `liveTextEditing`) is loaded on demand, so it stays out of the startup budget.
 */
import type { ParagraphStyle, TextElement } from '../types';

const STORAGE_KEY = 'recto.liveTextEditing';

/** In-place editing is on unless it was switched off; the textarea editor remains the fallback. */
export function liveTextEditingEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

export function setLiveTextEditingEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
  } catch { /* Private browsing: the choice lasts for this page only. */ }
}

/**
 * Plain frames keep the legacy renderer for features the story composer does not draw. Editing those
 * in place would show different typography than the finished frame, so they use the textarea editor.
 */
export function supportsLiveEditing(frame: TextElement, styles: ParagraphStyle[]): boolean {
  if (frame.textContent) return true;
  const style = styles.find(item => item.id === frame.paragraphStyleId);
  const columns = frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns || 1);
  if ((frame.dropCapLines ?? 0) >= 2) return false;
  if (frame.openTypeFeatures && Object.values(frame.openTypeFeatures).some(Boolean)) return false;
  if ((style?.grepStyles || frame.grepStyles)?.length) return false;
  if (frame.verticalAlign === 'middle' || frame.verticalAlign === 'bottom') return false;
  if (frame.balanceColumns && columns > 1) return false;
  return !/\{(cond|xref|index):/.test(frame.text || '');
}
