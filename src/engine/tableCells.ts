import type { Spread, TableCell, TableElement } from '../types';

export function tableThread(spreads: Spread[], table: TableElement): TableElement[] {
  return createTableThreadLookup(spreads)(table);
}

/** Callers processing a stable publication snapshot can share one lookup. */
export function createTableThreadLookup(spreads: Spread[]) {
  let frames: Map<string, TableElement> | undefined;
  const threads = new WeakMap<TableElement, TableElement[]>();
  return (table: TableElement): TableElement[] => {
    const cached = threads.get(table);
    if (cached) return cached;
    if (!table.prevFrameId && !table.nextFrameId) {
      const thread = [table];
      threads.set(table, thread);
      return thread;
    }
    if (!frames) {
      frames = new Map();
      for (const spread of spreads) for (const element of spread.elements) {
        if (element.type === 'table') frames.set(element.id, element);
      }
    }
    const thread = resolveTableThread(frames, table);
    threads.set(table, thread);
    // Broken or circular links keep their existing best-effort traversal.
    if (thread.every((frame, index) => (frame.prevFrameId || undefined) === thread[index - 1]?.id &&
      (frame.nextFrameId || undefined) === thread[index + 1]?.id && frames?.get(frame.id) === frame)) {
      for (const frame of thread) threads.set(frame, thread);
    }
    return thread;
  };
}

function resolveTableThread(frames: ReadonlyMap<string, TableElement>, table: TableElement): TableElement[] {
  let head = table; const seen = new Set<string>();
  while (head.prevFrameId && !seen.has(head.id)) { seen.add(head.id); const previous = frames.get(head.prevFrameId); if (!previous) break; head = previous; }
  seen.clear(); const result: TableElement[] = []; let current: TableElement | undefined = head;
  while (current && !seen.has(current.id)) { seen.add(current.id); result.push(current); current = current.nextFrameId ? frames.get(current.nextFrameId) : undefined; }
  return result;
}

/** Returns zero for a cell covered by a preceding horizontal merge. */
export function tableCellSpan(row: TableCell[], column: number): number {
  for (let c = 0; c < row.length;) {
    const span = Math.max(1, Math.min(row.length - c, Math.floor(row[c]?.colSpan || 1)));
    if (c === column) return span;
    if (column < c + span) return 0;
    c += span;
  }
  return 0;
}

export function mergeTableCellRight(cells: TableCell[][], rowIndex: number, column: number): TableCell[][] {
  const result = structuredClone(cells), row = result[rowIndex];
  if (!row) throw new Error('Select a valid table row.');
  const span = tableCellSpan(row, column), next = column + span;
  if (!span || next >= row.length) throw new Error('Select a cell with another cell to its right.');
  if (cells.some(row => row.some(cell => (cell.rowSpan || 1) > 1))) {
    const grid = tableGrid(cells), left = grid[rowIndex][column], right = grid[rowIndex][next];
    if (left.row !== rowIndex || right.row !== rowIndex || left.rowSpan > 1 || right.rowSpan > 1) throw new Error('Unmerge vertical cells before merging horizontally.');
  }
  const right = tableCellSpan(row, next);
  row[column].colSpan = span + right;
  row[column].text = [row[column].text, row[next].text].filter(Boolean).join(' ');
  row[next].text = ''; delete row[next].colSpan;
  return result;
}

export interface TableCellOwner { row: number; column: number; rowSpan: number; colSpan: number; cell: TableCell }
export function tableGrid(cells: TableCell[][], headers = 0, footers = 0): TableCellOwner[][] {
  const columns = cells[0]?.length || 0;
  headers = Math.min(headers, cells.length);
  footers = Math.min(footers, cells.length - headers);
  const grid: TableCellOwner[][] = cells.map(() => []);
  for (let row = 0; row < cells.length; row++) for (let column = 0; column < columns; column++) {
    const cell = cells[row][column];
    if (grid[row][column]) {
      if ((cell.rowSpan || 1) > 1 || (cell.colSpan || 1) > 1) throw new Error('Table merges overlap.');
      continue;
    }
    const rowSpan = cell.rowSpan ?? 1, colSpan = cell.colSpan ?? 1;
    if (!Number.isInteger(rowSpan) || !Number.isInteger(colSpan) || rowSpan < 1 || colSpan < 1 || row + rowSpan > cells.length || column + colSpan > columns) throw new Error('A merged cell extends outside the table.');
    const band = (r: number) => r < headers ? 'header' : r >= cells.length - footers ? 'footer' : 'body';
    if (band(row) !== band(row + rowSpan - 1)) throw new Error('Vertical merges cannot cross header, body or footer boundaries.');
    const owner = { row, column, rowSpan, colSpan, cell };
    for (let r = row; r < row + rowSpan; r++) for (let c = column; c < column + colSpan; c++) {
      if (grid[r][c]) throw new Error('Table merges overlap.');
      grid[r][c] = owner;
    }
  }
  return grid;
}

export function mergeTableCellDown(cells: TableCell[][], row: number, column: number): TableCell[][] {
  const grid = tableGrid(cells), owner = grid[row]?.[column];
  if (!owner || owner.row !== row || owner.column !== column) throw new Error('Select the origin of a merged cell.');
  const below = grid[row + owner.rowSpan]?.[column];
  if (!below || below.row !== row + owner.rowSpan || below.column !== column || below.colSpan !== owner.colSpan) throw new Error('The cell below must have the same horizontal span.');
  const result = structuredClone(cells);
  result[row][column].rowSpan = owner.rowSpan + below.rowSpan;
  result[row][column].text = [owner.cell.text, below.cell.text].filter(Boolean).join('\n');
  for (let r = below.row; r < below.row + below.rowSpan; r++) for (let c = column; c < column + owner.colSpan; c++) {
    result[r][c].text = ''; delete result[r][c].rowSpan; delete result[r][c].colSpan;
  }
  tableGrid(result); return result;
}

export function unmergeTableCell(cells: TableCell[][], row: number, column: number): TableCell[][] {
  const owner = tableGrid(cells)[row]?.[column];
  if (!owner) throw new Error('Select a table cell.');
  const result = structuredClone(cells);
  delete result[owner.row][owner.column].rowSpan; delete result[owner.row][owner.column].colSpan;
  return result;
}
