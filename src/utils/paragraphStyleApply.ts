import { stateManager } from '../state';
import type { TextElement } from '../types';
import { planParagraphStyleTarget } from './paragraphStyleTarget';

/**
 * UI bridge for applying a paragraph style. While the frame is being edited inline, the style goes
 * to the paragraphs under the caret / selection; otherwise to the whole frame.
 */
export function applyParagraphStyleToSelection(frameId: string, styleId: string): void {
  const canvas = (window as any).recto?.spreadCanvas;
  const selection: { text: string; start: number; end: number } | null =
    canvas?.getActiveTextSelection?.(frameId) ?? null;

  if (selection) {
    const frame = stateManager.getElementById(frameId) as TextElement | null;
    const target = planParagraphStyleTarget(selection.text, selection.start, selection.end, frame?.storyStart ?? 0);
    if (target.kind === 'range') {
      stateManager.styleStoryRange(frameId, target.start, target.end, styleId);
      return;
    }
  }
  stateManager.applyParagraphStyle(frameId, styleId);
}
