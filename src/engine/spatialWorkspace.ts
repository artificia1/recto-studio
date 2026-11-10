import type { ProjectState } from '../types';

export function spreadGrid(state: ProjectState, columns: number) {
  if (!Number.isInteger(columns) || columns < 1 || columns > 8) throw new Error('Choose 1 to 8 columns.');
  const pageWidth = state.settings.widthMm;
  const pageHeight = state.settings.heightMm;
  const widestSpread = state.spreads.reduce((count, spread) => Math.max(count, spread.pages.length), 1);
  const columnWidth = widestSpread * pageWidth + 90;
  const rowHeight = pageHeight + 100;
  const cells = state.spreads.map((spread, index) => ({
    spread,
    index,
    x: 45 + index % columns * columnWidth,
    y: 50 + Math.floor(index / columns) * rowHeight,
    width: spread.pages.length * pageWidth,
    height: pageHeight,
  }));
  return { cells, columns, rowHeight, width: columns * columnWidth, height: Math.max(1, Math.ceil(cells.length / columns)) * rowHeight };
}

export function visibleSpreadCells(
  grid: ReturnType<typeof spreadGrid>,
  viewport: { x: number; y: number; width: number; height: number },
) {
  const firstRow = Math.max(0, Math.floor(viewport.y / grid.rowHeight));
  const lastRow = Math.floor((viewport.y + viewport.height) / grid.rowHeight);
  if (lastRow < firstRow) return [];
  // Each spread is entirely inside its grid row. Test only intersecting rows.
  return grid.cells.slice(firstRow * grid.columns, (lastRow + 1) * grid.columns).filter(cell =>
    cell.x < viewport.x + viewport.width && cell.x + cell.width > viewport.x &&
    cell.y < viewport.y + viewport.height && cell.y + cell.height > viewport.y,
  );
}

export function workspaceDrop(state: ProjectState, columns: number, x: number, y: number) {
  const cell = spreadGrid(state, columns).cells.find(cell => x >= cell.x - 30 && x <= cell.x + cell.width + 30 && y >= cell.y - 30 && y <= cell.y + cell.height + 30);
  if (!cell?.spread.pages.length) return;
  const index = Math.max(0, Math.min(cell.spread.pages.length - 1, Math.floor((x - cell.x) / state.settings.widthMm)));
  return { pageId: cell.spread.pages[index].id, x: x - cell.x - index * state.settings.widthMm, y: y - cell.y,
    pasteboard: x < cell.x || x > cell.x + cell.width || y < cell.y || y > cell.y + cell.height };
}
