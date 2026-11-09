import { describe, expect, it } from 'vitest';
import { layoutContentTables } from '../src/engine/tableLayout';
import { mergeTableCellDown, tableGrid, unmergeTableCell } from '../src/engine/tableCells';
import { StateManager } from '../src/state/stateManager';
import type { TableElement } from '../src/types';

const table = (changes: Partial<TableElement> = {}): TableElement => ({ id: 'table', pageId: 'page', type: 'table', x: 0, y: 0, width: 20, height: 22,
  rotation: 0, opacity: 1, locked: false, zIndex: 1, rows: 1, cols: 1, cells: [[{ text: '' }]], rowSizing: 'content', allowRowSplit: true,
  headerRowCount: 0, headerFillColor: '#000', headerTextColor: '#fff', borderColor: '#000', borderWidthMm: 0.2,
  cellPaddingMm: 1, fontFamily: 'Times', fontSizePt: 10, ...changes });
const measure = (text: string) => [...new Intl.Segmenter().segment(text)].length;

describe('advanced table pagination', () => {
  it('continues one long row across changing frame widths without losing or repeating words', () => {
    const text = Array.from({ length: 75 }, (_, i) => `word${i}`).join(' ');
    const source = table({ cells: [[{ text }]] });
    const frames = Array.from({ length: 20 }, (_, i) => ({ ...source, id: `frame${i}`, width: i % 2 ? 35 : 20 }));
    const result = layoutContentTables(frames, measure);
    expect(result.pendingRows).toEqual([]);
    expect(result.frames.flatMap(frame => frame.rows.flatMap(row => row.cells[0].lines)).join(' ').replace(/\s+/g, ' ')).toBe(text);
    expect(result.frames[0].rows[0].continuesOnNext).toBe(true);
    expect(result.frames[1].rows[0].continuedFromPrevious).toBe(true);
    expect(result.frames.every(frame => frame.usedHeight <= source.height + 0.001)).toBe(true);
  });
  it('preserves Unicode clusters, explicit paragraph breaks, padding zero and minimum heights', () => {
    const source = table({ width: 3, height: 10, cellPaddingMm: 0, cells: [[{ text: '👨‍👩‍👧‍👦ab\r\n\r\ncd' }]], rowHeightsMm: [30] });
    const result = layoutContentTables(Array.from({ length: 8 }, (_, i) => ({ ...source, id: String(i) })), measure);
    expect(result.pendingRows).toEqual([]);
    expect(result.frames.flatMap(frame => frame.rows.flatMap(row => row.cells[0].lines)).filter(Boolean).join('')).toBe('👨‍👩‍👧‍👦abcd');
    expect(result.frames.reduce((sum, frame) => sum + frame.usedHeight, 0)).toBeGreaterThanOrEqual(30);
  });
  it('keeps repeated headers and footers around every split fragment', () => {
    const source = table({ height: 30, rows: 3, headerRowCount: 1, footerRowCount: 1,
      cells: [[{ text: 'Header' }], [{ text: 'Long content '.repeat(30) }], [{ text: 'Footer' }]] });
    const result = layoutContentTables(Array.from({ length: 30 }, (_, i) => ({ ...source, id: String(i) })), measure);
    expect(result.pendingRows).toEqual([]);
    for (const frame of result.frames.filter(frame => frame.rows.some(row => row.kind === 'body'))) {
      expect(frame.rows[0].kind).toBe('header'); expect(frame.rows.at(-1)!.kind).toBe('footer');
      expect(frame.usedHeight).toBeLessThanOrEqual(source.height + 0.001);
    }
  });
  it('renders vertical merged cells once and moves their complete group to the next frame', () => {
    const cells = mergeTableCellDown([[{ text: 'A' }, { text: 'B' }], [{ text: 'C' }, { text: 'D' }]], 0, 0);
    expect(tableGrid(cells)[1][0]).toMatchObject({ row: 0, rowSpan: 2 });
    const source = table({ rows: 2, cols: 2, width: 40, height: 8, cells });
    const result = layoutContentTables([source, { ...source, id: 'tail', height: 40 }], measure);
    expect(result.pendingRows).toEqual([]); expect(result.frames[0].rows).toEqual([]);
    const rows = result.frames[1].rows;
    expect(rows[0].cells[0].lines).toEqual(['A', 'C']); expect(rows[1].cells).toHaveLength(1);
    expect(rows[0].cells[0].height).toBeCloseTo(rows[0].height + rows[1].height);
    expect(unmergeTableCell(cells, 0, 0)[0][0].rowSpan).toBeUndefined();
    expect(() => tableGrid(cells, 1)).toThrow('boundaries');
  });
  it('refuses invalid merge updates atomically and records valid edits with one undo', () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Tables', false);
    const source = table({ pageId: manager.getActiveSpread().pages[0].id, rows: 2, cells: [[{ text: 'A' }], [{ text: 'B' }]] }); manager.addElement(source);
    const before = manager.exportJson();
    expect(() => manager.updateTableSource(source.id, { cells: [[{ text: 'A', rowSpan: 3 }], [{ text: 'B' }]] })).toThrow('outside');
    expect(manager.exportJson()).toBe(before);
    manager.updateTableSource(source.id, { cells: mergeTableCellDown(source.cells, 0, 0) });
    manager.undo(); expect(manager.exportJson()).toBe(before);
  });
});
