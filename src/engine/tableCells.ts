import type { Spread, TableCell, TableElement } from '../types';

export function tableThread(spreads: Spread[], table: TableElement): TableElement[] {
  const frames = new Map(spreads.flatMap(spread => spread.elements).filter((element): element is TableElement => element.type === 'table').map(frame => [frame.id, frame]));
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
  const right = tableCellSpan(row, next);
  row[column].colSpan = span + right;
  row[column].text = [row[column].text, row[next].text].filter(Boolean).join(' ');
  row[next].text = ''; delete row[next].colSpan;
  return result;
}
