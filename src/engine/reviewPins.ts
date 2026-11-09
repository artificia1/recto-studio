import type { CommentPin, ProjectState } from '../types';

export function reviewPinPosition(state: ProjectState, note: CommentPin, onlySpread?: number) {
  if (note.unplaced) return;
  if (note.pageId) {
    if (onlySpread !== undefined) {
      const pageIndex = state.spreads[onlySpread]?.pages.findIndex(page => page.id === note.pageId) ?? -1;
      return pageIndex < 0 ? undefined : { spreadIndex: onlySpread, x: note.x + pageIndex * state.settings.widthMm, y: note.y };
    }
    for (const [spreadIndex, spread] of state.spreads.entries()) {
      const pageIndex = spread.pages.findIndex(page => page.id === note.pageId);
      if (pageIndex >= 0) return { spreadIndex, x: note.x + pageIndex * state.settings.widthMm, y: note.y };
    }
    return;
  }
  if (onlySpread !== undefined && (note.spreadId ? state.spreads[onlySpread]?.id === note.spreadId : note.spreadIndex === onlySpread)) {
    return { spreadIndex: onlySpread, x: note.x, y: note.y };
  }
  if (onlySpread !== undefined) return;
  const spreadIndex = note.spreadId ? state.spreads.findIndex(spread => spread.id === note.spreadId) : note.spreadIndex;
  if (state.spreads[spreadIndex]) return { spreadIndex, x: note.x, y: note.y };
}
