import type { TableElement } from '../types';
import type { TableFrameLayout, TableLayoutRow, TableMeasure } from './tableLayout';
import { wrapTableText } from './tableLayout';
import { tableGrid } from './tableCells';

function lineEnds(text: string, lines: string[]): number[] {
  let cursor = 0;
  return lines.map(line => {
    const start = line ? text.indexOf(line, cursor) : cursor;
    if (start < 0) throw new Error('Table text could not be mapped to its source.');
    cursor = start + line.length;
    while (cursor < text.length && /[\t ]/.test(text[cursor])) cursor++;
    if (text[cursor] === '\r') cursor++;
    if (text[cursor] === '\n') cursor++;
    return cursor;
  });
}

/** Split ordinary rows by complete lines. Vertically merged row groups stay together. */
export function layoutAdvancedTables(thread: TableElement[], measure: TableMeasure) {
  const source = thread[0];
  const headers = Math.min(source.headerRowCount, source.rows);
  const footers = Math.min(source.footerRowCount || 0, source.rows - headers);
  const bodyEnd = source.rows - footers;
  const grid = tableGrid(source.cells, headers, footers);
  let next = headers, consumedHeight = 0;
  let offsets = new Map<number, number>();
  const frames: TableFrameLayout[] = [];
  for (const [frameIndex, frame] of thread.entries()) {
    const padding = frame.cellPaddingMm ?? 1.5, leading = frame.fontSizePt * 25.4 / 72 * 1.35;
    const weights = Array.from({ length: source.cols }, (_, c) => source.colWidthsMm?.[c] || 1);
    const total = weights.reduce((a, b) => a + b, 0), widths = weights.map(value => value / total * frame.width);
    const x = [0]; widths.forEach(width => x.push(x.at(-1)! + width));
    const heights = source.cells.map((_, r) => Math.max(leading + 2 * padding, source.rowHeightsMm?.[r] || 0));
    const anchors = grid.flatMap((row, r) => row.filter((owner, c) => owner.row === r && owner.column === c));
    const wrapped = new Map(anchors.map(owner => {
      const width = x[owner.column + owner.colSpan] - x[owner.column];
      const text = wrapTableText(owner.cell.text, width - 2 * padding, frame, measure);
      if (owner.rowSpan === 1) heights[owner.row] = Math.max(heights[owner.row], text.lines.length * leading + 2 * padding);
      return [owner, { ...text, width }];
    }));
    for (const owner of anchors.filter(owner => owner.rowSpan > 1)) {
      const needed = wrapped.get(owner)!.lines.length * leading + 2 * padding;
      const available = heights.slice(owner.row, owner.row + owner.rowSpan).reduce((a, b) => a + b, 0);
      if (needed > available) for (let r = owner.row; r < owner.row + owner.rowSpan; r++) heights[r] += (needed - available) / owner.rowSpan;
    }
    const makeRow = (r: number, kind: TableLayoutRow['kind']): TableLayoutRow => ({ index: r, kind, y: 0, height: heights[r], horizontalOverflow: false,
      cells: anchors.filter(owner => owner.row === r).map(owner => {
        const text = wrapped.get(owner)!;
        return { cell: owner.cell, column: owner.column, x: x[owner.column], width: text.width, lines: text.lines,
          height: heights.slice(r, r + owner.rowSpan).reduce((a, b) => a + b, 0) };
      }) });
    const headerRows = frameIndex === 0 || frame.repeatHeaderOnOverflow !== false ? Array.from({ length: headers }, (_, r) => makeRow(r, 'header')) : [];
    const footerRows = frameIndex === thread.length - 1 || frame.repeatFooterOnOverflow !== false ? Array.from({ length: source.rows - bodyEnd }, (_, r) => makeRow(bodyEnd + r, 'footer')) : [];
    const footerHeight = footerRows.reduce((sum, row) => sum + row.height, 0);
    const rows: TableLayoutRow[] = []; let usedHeight = 0, horizontalOverflow = false;
    const append = (row: TableLayoutRow) => {
      row.y = usedHeight; rows.push(row); usedHeight += row.height;
      horizontalOverflow ||= anchors.some(owner => owner.row === row.index && wrapped.get(owner)!.overflow);
    };
    const reserved = footerHeight + headerRows.reduce((sum, row) => sum + row.height, 0);
    if (reserved <= frame.height + 0.001) {
      headerRows.forEach(append);
      while (next < bodyEnd) {
        let groupEnd = next + 1;
        for (let r = next; r < groupEnd; r++) for (const owner of grid[r]) groupEnd = Math.max(groupEnd, owner.row + owner.rowSpan);
        const available = frame.height - usedHeight - footerHeight;
        if (groupEnd > next + 1) {
          if (heights.slice(next, groupEnd).reduce((a, b) => a + b, 0) > available + 0.001) break;
          while (next < groupEnd) append(makeRow(next++, 'body'));
          continue;
        }
        const row = makeRow(next, 'body');
        const remaining = row.cells.map(box => {
          const offset = offsets.get(box.column!) || 0, text = box.cell.text.slice(offset);
          const result = wrapTableText(text, box.width - 2 * padding, frame, measure);
          return { box, offset, text, result, ends: lineEnds(text, result.lines) };
        });
        const needed = Math.max(leading + 2 * padding, (source.rowHeightsMm?.[next] || 0) - consumedHeight,
          ...remaining.map(cell => cell.result.lines.length * leading + 2 * padding));
        if (needed > available + 0.001 && (!source.allowRowSplit || available < leading + 2 * padding)) break;
        row.height = Math.min(needed, available);
        row.continuedFromPrevious = consumedHeight > 0;
        const count = Math.max(1, Math.floor((row.height - padding * 2 + 0.0001) / leading));
        row.cells = remaining.map(({ box, offset, text, result, ends }) => {
          const taken = Math.min(count, result.lines.length);
          offsets.set(box.column!, offset + (taken === result.lines.length ? text.length : ends[taken - 1]));
          return { ...box, height: row.height, lines: result.lines.slice(0, taken) };
        });
        consumedHeight += row.height;
        const complete = remaining.every(cell => (offsets.get(cell.box.column!) || 0) >= cell.box.cell.text.length) && consumedHeight >= (source.rowHeightsMm?.[next] || 0) - 0.001;
        row.continuesOnNext = !complete; append(row);
        if (!complete) break;
        next++; consumedHeight = 0; offsets = new Map();
      }
      footerRows.forEach(append);
    }
    frames.push({ frameId: frame.id, rows, usedHeight, horizontalOverflow: horizontalOverflow || reserved > frame.height + 0.001 });
  }
  return { frames, pendingRows: Array.from({ length: Math.max(0, bodyEnd - next) }, (_, r) => next + r) };
}
