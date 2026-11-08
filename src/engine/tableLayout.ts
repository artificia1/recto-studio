import type { TableCell, TableElement } from '../types';
import { measureStoryText } from './storyLayout';
import { graphemes } from './globalTypography';
import { tableCellSpan } from './tableCells';

export interface TableLayoutCell { cell: TableCell; x: number; width: number; lines: string[] }
export interface TableLayoutRow { index: number; kind: 'header' | 'body' | 'footer'; y: number; height: number; cells: TableLayoutCell[]; horizontalOverflow: boolean }
export interface TableFrameLayout { frameId: string; rows: TableLayoutRow[]; usedHeight: number; horizontalOverflow: boolean }
export type TableMeasure = (text: string, frame: TableElement) => number;
const measure: TableMeasure = (text, frame) => measureStoryText(text, { fontFamily: frame.fontFamily, fontSizePt: frame.fontSizePt, color: '#000', letterSpacingPt: 0 });

export function wrapTableText(text: string, width: number, frame: TableElement, widthOf: TableMeasure = measure): { lines: string[]; overflow: boolean } {
  const lines: string[] = []; let overflow = width <= 0;
  for (const paragraph of text.split(/\r\n|\n|\r/)) {
    let line = '';
    for (const word of paragraph.match(/\S+\s*|\s+/gu) || []) {
      if (line && widthOf(line + word.trimEnd(), frame) > width) { lines.push(line.trimEnd()); line = ''; }
      if (widthOf(word.trimEnd(), frame) <= width) line += word;
      else for (const character of graphemes(word)) {
        if (line && widthOf(line + character, frame) > width) { lines.push(line.trimEnd()); line = ''; }
        if (widthOf(character, frame) > width) overflow = true;
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return { lines, overflow };
}

/** Content mode never divides a row or silently advances past one that does not fit. */
export function layoutContentTables(thread: TableElement[], widthOf: TableMeasure = measure) {
  const source = thread[0];
  if (!source) return { frames: [] as TableFrameLayout[], pendingRows: [] as number[] };
  const count = source.cells.length;
  const headers = Math.min(source.headerRowCount || 0, count);
  const footers = Math.min(source.footerRowCount || 0, count - headers);
  const bodyEnd = count - footers;
  let nextRow = headers;
  const frames: TableFrameLayout[] = [];
  for (const [frameIndex, frame] of thread.entries()) {
    const padding = frame.cellPaddingMm ?? 1.5;
    const lineHeight = frame.fontSizePt * 25.4 / 72 * 1.35;
    const weights = Array.from({ length: source.cols }, (_, c) => source.colWidthsMm?.[c] || 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(weight => frame.width * weight / totalWeight);
    let horizontalOverflow = false;
    const row = (index: number, kind: TableLayoutRow['kind']): TableLayoutRow => {
      const cells: TableLayoutCell[] = []; let x = 0, height = lineHeight + padding * 2, overflow = false;
      const values = source.cells[index];
      for (let c = 0; c < source.cols;) {
        const span = tableCellSpan(values, c) || 1;
        const width = widths.slice(c, c + span).reduce((a, b) => a + b, 0);
        const cell = values[c] || { text: '' };
        const wrapped = wrapTableText(cell.text, width - 2 * padding, frame, widthOf);
        overflow ||= wrapped.overflow;
        height = Math.max(height, wrapped.lines.length * lineHeight + padding * 2);
        cells.push({ cell, x, width, lines: wrapped.lines }); x += width; c += span;
      }
      return { index, kind, y: 0, height: Math.max(height, source.rowHeightsMm?.[index] || 0), cells, horizontalOverflow: overflow };
    };
    const headerRows = frameIndex === 0 || frame.repeatHeaderOnOverflow !== false ? Array.from({ length: headers }, (_, index) => row(index, 'header')) : [];
    const footerRows = frameIndex === thread.length - 1 || frame.repeatFooterOnOverflow !== false ? Array.from({ length: footers }, (_, index) => row(bodyEnd + index, 'footer')) : [];
    const reserved = [...headerRows, ...footerRows].reduce((sum, item) => sum + item.height, 0);
    const rows: TableLayoutRow[] = []; let usedHeight = 0;
    const append = (item: TableLayoutRow) => { item.y = usedHeight; rows.push(item); usedHeight += item.height; horizontalOverflow ||= item.horizontalOverflow; };
    if (reserved <= frame.height + 0.001) {
      headerRows.forEach(append);
      const footerHeight = footerRows.reduce((sum, item) => sum + item.height, 0);
      while (nextRow < bodyEnd) {
        const item = row(nextRow, 'body');
        if (usedHeight + item.height + footerHeight > frame.height + 0.001) break;
        append(item); nextRow++;
      }
      footerRows.forEach(append);
    }
    frames.push({ frameId: frame.id, rows, usedHeight, horizontalOverflow: horizontalOverflow || reserved > frame.height + 0.001 });
  }
  return { frames, pendingRows: Array.from({ length: Math.max(0, bodyEnd - nextRow) }, (_, index) => nextRow + index) };
}
