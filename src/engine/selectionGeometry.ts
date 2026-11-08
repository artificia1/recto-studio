import type { CanvasElement, ProjectState } from '../types';

export function restorePlacedPasteboard(state: ProjectState, element: CanvasElement) {
  if (!element.pasteboard) return;
  const spread = state.spreads[state.activeSpreadIndex], width = state.settings.widthMm;
  const globalX = spread.pages.findIndex(page => page.id === element.pageId) * width + element.x;
  const center = globalX + element.width / 2, centerY = element.y + element.height / 2;
  if (center >= 0 && center < spread.pages.length * width && centerY >= 0 && centerY < state.settings.heightMm) {
    const pageIndex = Math.floor(center / width);
    element.pageId = spread.pages[pageIndex].id; element.x = globalX - pageIndex * width; delete element.pasteboard;
  }
}

/** A locked member protects the whole flat group during direct manipulation. */
export function lockedArtworkIds(state: ProjectState) {
  const elements = state.spreads[state.activeSpreadIndex].elements;
  const locked = elements.filter(element => element.locked || element.editorialOnly || state.layers.find(layer => layer.id === (element.layerId || 'layer-1'))?.locked);
  const groups = new Set(locked.map(element => element.groupId).filter(Boolean));
  return new Set(elements.filter(element => locked.includes(element) || (element.groupId && groups.has(element.groupId))).map(element => element.id));
}

export function selectionUnits(state: ProjectState, skipEditorial = false) {
  const spread = state.spreads[state.activeSpreadIndex], ids = new Set(state.selectedElementIds);
  const groups = new Set(spread.elements.filter(element => ids.has(element.id)).map(element => element.groupId).filter(Boolean));
  const editorialGroups = new Set(spread.elements.filter(element => element.editorialOnly).map(element => element.groupId).filter(Boolean));
  const selected = spread.elements.filter(element => (ids.has(element.id) || (element.groupId && groups.has(element.groupId))) &&
    (!skipEditorial || (!element.editorialOnly && (!element.groupId || !editorialGroups.has(element.groupId)))));
  const locked = lockedArtworkIds(state);
  if (selected.some(element => locked.has(element.id))) throw new Error('Unlock every selected object and its layer first.');
  const units = new Map<string, { members: CanvasElement[]; left: number; top: number; right: number; bottom: number }>();
  for (const element of selected) {
    const page = Math.max(0, spread.pages.findIndex(page => page.id === element.pageId)), angle = element.rotation * Math.PI / 180;
    const width = Math.abs(element.width * Math.cos(angle)) + Math.abs(element.height * Math.sin(angle));
    const height = Math.abs(element.width * Math.sin(angle)) + Math.abs(element.height * Math.cos(angle));
    const cx = page * state.settings.widthMm + element.x + element.width / 2, cy = element.y + element.height / 2;
    const key = element.groupId || element.id;
    const unit = units.get(key) || { members: [], left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    unit.members.push(element); unit.left = Math.min(unit.left, cx - width / 2); unit.right = Math.max(unit.right, cx + width / 2);
    unit.top = Math.min(unit.top, cy - height / 2); unit.bottom = Math.max(unit.bottom, cy + height / 2); units.set(key, unit);
  }
  return [...units.values()];
}

export function arrangeSelection(state: ProjectState, operation: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical', gap?: number) {
  const units = selectionUnits(state, true);
  if (gap !== undefined && (!Number.isFinite(gap) || gap < 0 || gap > 2500)) throw new Error('Spacing must be between 0 and 2,500 mm.');
  const distribute = operation === 'horizontal' || operation === 'vertical';
  if (units.length < (distribute && gap === undefined ? 3 : 2)) return false;
  const horizontal = ['left', 'center', 'right', 'horizontal'].includes(operation);
  const start = horizontal ? 'left' : 'top', end = horizontal ? 'right' : 'bottom';
  const move = (unit: typeof units[number], delta: number) => unit.members.forEach(element => {
    if (horizontal) {
      const spread = state.spreads[state.activeSpreadIndex], width = state.settings.widthMm;
      const globalX = Math.max(0, spread.pages.findIndex(page => page.id === element.pageId)) * width + element.x + delta;
      const pageIndex = Math.max(0, Math.min(spread.pages.length - 1, Math.floor((globalX + element.width / 2) / width)));
      element.x = globalX - pageIndex * width; element.pageId = spread.pages[pageIndex].id;
    } else element.y += delta;
  });
  if (distribute) {
    units.sort((a, b) => a[start] - b[start]);
    const spacing = gap ?? (units.at(-1)![end] - units[0][start] - units.reduce((size, unit) => size + unit[end] - unit[start], 0)) / (units.length - 1);
    let cursor = units[0][start];
    units.forEach(unit => { move(unit, cursor - unit[start]); cursor += unit[end] - unit[start] + spacing; });
  } else {
    const min = Math.min(...units.map(unit => unit[start])), max = Math.max(...units.map(unit => unit[end]));
    const center = operation === 'center' || operation === 'middle', trailing = operation === 'right' || operation === 'bottom';
    units.forEach(unit => move(unit, center ? (min + max - unit[start] - unit[end]) / 2 : trailing ? max - unit[end] : min - unit[start]));
  }
  return true;
}
