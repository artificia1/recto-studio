import type { ProjectState } from '../types';

export function spreadGrid(state: ProjectState, columns: number) {
  if (!Number.isInteger(columns) || columns < 1 || columns > 8) throw new Error('Choose 1 to 8 columns.');
  const width = Math.max(...state.spreads.map(spread => spread.pages.length), 1) * state.settings.widthMm + 90;
  const height = state.settings.heightMm + 100;
  const cells = state.spreads.map((spread, index) => ({ spread, index, x: 45 + index % columns * width, y: 50 + Math.floor(index / columns) * height, width: spread.pages.length * state.settings.widthMm, height: state.settings.heightMm }));
  return { cells, width: columns * width, height: Math.max(1, Math.ceil(cells.length / columns)) * height };
}

export function workspaceDrop(state: ProjectState, columns: number, x: number, y: number) {
  const cell = spreadGrid(state, columns).cells.find(cell => x >= cell.x - 30 && x <= cell.x + cell.width + 30 && y >= cell.y - 30 && y <= cell.y + cell.height + 30);
  if (!cell) return;
  const index = Math.max(0, Math.min(cell.spread.pages.length - 1, Math.floor((x - cell.x) / state.settings.widthMm)));
  return { pageId: cell.spread.pages[index].id, x: x - cell.x - index * state.settings.widthMm, y: y - cell.y,
    pasteboard: x < cell.x || x > cell.x + cell.width || y < cell.y || y > cell.y + cell.height };
}
