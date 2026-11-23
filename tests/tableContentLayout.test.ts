import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import type { TableElement } from '../src/types';
import { layoutContentTables, wrapTableText } from '../src/engine/tableLayout';
import * as tableLayout from '../src/engine/tableLayout';
import { tableEngine } from '../src/engine/tableEngine';
import { tableThread } from '../src/engine/tableCells';
import { StateManager } from '../src/state/stateManager';
import { parseProject } from '../src/state/projectValidation';
import { publicationPreflight } from '../src/engine/publicationPreflight';
import { exportDocumentToPdf } from '../src/export/pdfExport';

const table = (overrides: Partial<TableElement> = {}): TableElement => ({ id: 'table', type: 'table', pageId: 'page',
  x: 10, y: 10, width: 20, height: 21, rotation: 0, opacity: 1, zIndex: 1, locked: false,
  rowSizing: 'content', rows: 5, cols: 1, cells: ['Header', 'alpha beta gamma delta', 'B', 'C', 'D'].map(text => [{ text }]),
  headerRowCount: 1, headerFillColor: '#222222', headerTextColor: '#ffffff', cellPaddingMm: 1,
  fontFamily: 'Times', fontSizePt: 10, borderWidthMm: 0, borderColor: '#000000', ...overrides });
const widthOf = (text: string) => Array.from(text).length;

describe('content-sized table rows', () => {
  it('wraps words, explicit line breaks and whole Unicode graphemes', () => {
    expect(wrapTableText('alpha beta\ngamma', 6, table(), widthOf).lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(wrapTableText('👨‍👩‍👧‍👦ab', 1, table(), text => [...new Intl.Segmenter().segment(text)].length).lines).toEqual(['👨‍👩‍👧‍👦', 'a', 'b']);
  });
  it('continues whole rows in order, reserves repeat headers and never loses rows', () => {
    const head = table(), tail = table({ id: 'tail', height: 30 });
    const result = layoutContentTables([head, tail], widthOf);
    expect(result.frames[0].rows.map(row => row.index)).toEqual([0, 1]);
    expect(result.frames[0].rows[1].cells[0].lines).toEqual(['alpha beta gamma', 'delta']);
    expect(result.frames[1].rows.map(row => row.index)).toEqual([0, 2, 3, 4]);
    expect(result.pendingRows).toEqual([]);
    expect(result.frames.every((frame, i) => frame.usedHeight <= [head, tail][i].height)).toBe(true);
    tail.height = 1;
    expect(layoutContentTables([head, tail], widthOf).pendingRows).toEqual([2, 3, 4]);
  });
  it('supports merged widths, row minima and footer reservations', () => {
    const source = table({ cols: 2, width: 10, height: 60, rows: 3, headerRowCount: 0, footerRowCount: 1,
      rowHeightsMm: [20], cells: [[{ text: 'abcdef', colSpan: 2 }, { text: '' }], [{ text: 'a' }, { text: 'b' }], [{ text: 'Footer', colSpan: 2 }, { text: '' }]] });
    const result = layoutContentTables([source], widthOf);
    expect(result.frames[0].rows[0].height).toBe(20);
    expect(result.frames[0].rows[0].cells).toHaveLength(1);
    expect(result.frames[0].rows[0].cells[0].lines).toEqual(['abcdef']);
    expect(result.frames[0].rows.at(-1)!.kind).toBe('footer');
  });
  it('does not report overflow for a skipped row that fits in a wider continuation', () => {
    const head = table({ width: 1, height: 1, headerRowCount: 0, cells: [[{ text: 'wide' }]], rows: 1 });
    const tail = { ...head, id: 'tail', width: 40, height: 20 };
    const result = layoutContentTables([head, tail], widthOf);
    expect(result.pendingRows).toEqual([]);
    expect(result.frames.map(frame => frame.horizontalOverflow)).toEqual([false, false]);
  });
  it('reports oversized rows and blocks PDF rather than silently omitting them', () => {
    const source = table({ height: 1 }); const doc = new jsPDF();
    expect(() => tableEngine.exportPdfTable(doc, source, 10, 10, source.width, source.height)).toThrow('does not fit');
    const manager = new StateManager(); manager.createBlankProject('A4', 'Table review', false);
    source.pageId = manager.getActiveSpread().pages[0].id; manager.addElement(source);
    expect(publicationPreflight(manager.getState()).some(issue => issue.message.includes('table row(s) do not fit'))).toBe(true);
  });
  it('renders all fitted text to PDF and respects zero-width borders', () => {
    const source = table({ width: 150, height: 160, cells: [[{ text: 'HEADER' }], [{ text: 'BODY TOKEN' }]], rows: 2 });
    const doc = new jsPDF({ compress: false });
    tableEngine.exportPdfTable(doc, source, 10, 10, source.width, source.height);
    const operators = (doc.internal as unknown as { pages: string[][] }).pages[1];
    expect(operators.join('\n')).toContain('BODY TOKEN'); expect(operators).not.toContain('S');
  });
  it('composes a linked table once for PDF painting and keeps the rows on their own pages', async () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Catalog', false);
    manager.addElement(table({
      pageId: manager.getActiveSpread().pages[0].id,
      width: 100,
      height: 15,
      rows: 4,
      cells: ['CATALOG HEADER', 'FIRST ITEM', 'SECOND ITEM', 'THIRD ITEM'].map(text => [{ text }]),
    }));
    const second = manager.addTableContinuationPage('table');
    manager.addTableContinuationPage(second);

    const layouts = new Set<tableLayout.ContentTableLayout>();
    const createLookup = tableLayout.createContentTableLayoutLookup;
    const compose = vi.spyOn(tableLayout, 'createContentTableLayoutLookup').mockImplementation(() => {
      const lookup = createLookup();
      return thread => {
        const layout = lookup(thread);
        if (layout) layouts.add(layout);
        return layout;
      };
    });
    try {
      const doc = await exportDocumentToPdf(manager.getState(), { download: false });
      expect(compose).toHaveBeenCalledTimes(1);
      expect(layouts.size).toBe(1);
      expect(doc.getNumberOfPages()).toBe(3);
      const pages = (doc.internal as unknown as { pages: string[][] }).pages;
      for (const [index, item] of ['FIRST ITEM', 'SECOND ITEM', 'THIRD ITEM'].entries()) {
        const operators = pages[index + 1].join('\n');
        expect(operators).toContain('CATALOG HEADER');
        expect(operators).toContain(item);
        expect(operators.match(/(FIRST|SECOND|THIRD) ITEM/g)).toEqual([item]);
      }
    } finally {
      compose.mockRestore();
    }
  });
  it('adds a continuation atomically and edits canonical cells from a different page', () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Tables', false);
    manager.addElement(table({ pageId: manager.getActiveSpread().pages[0].id, masterSourceId: 'master-table', isOverridden: true,
      anchor: { parentTextId: 'parent-story', mode: 'aboveLine' } }));
    const before = manager.exportJson(); const next = manager.addTableContinuationPage('table');
    expect(manager.getState().spreads).toHaveLength(2);
    expect(manager.getElementById(next)!.masterSourceId).toBeUndefined();
    expect(manager.getElementById(next)!.isOverridden).toBeUndefined();
    expect(manager.getElementById(next)!.anchor).toBeUndefined();
    expect(manager.getElementById('table')!.masterSourceId).toBe('master-table');
    expect(manager.getActiveSpread().pages[0].side).toBe('single');
    expect(tableThread(manager.getState().spreads, manager.getElementById(next) as TableElement).map(item => item.id)).toEqual(['table', next]);
    manager.undo(); expect(manager.exportJson()).toBe(before); manager.redo();
    manager.updateTableCell(next, 1, 0, 'Updated from page two');
    expect((manager.getElementById('table') as TableElement).cells[1][0].text).toBe('Updated from page two');
    const restored = parseProject(manager.exportJson(), manager.getState());
    expect((restored.spreads[0].elements[0] as TableElement).rowSizing).toBe('content');
    manager.updateElement(next, { locked: true }); const locked = manager.exportJson();
    expect(() => manager.updateTableCell('table', 1, 0, 'Forbidden')).toThrow('Unlock');
    expect(() => manager.addTableContinuationPage('table')).toThrow('Unlock');
    expect(manager.exportJson()).toBe(locked);
  });
  it('edits shared continuation cells without rebuilding the publication and validates changes atomically', () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Tables', false);
    const head = table({ pageId: manager.getActiveSpread().pages[0].id });
    manager.addElement(head);
    const tailId = manager.addTableContinuationPage(head.id);
    const spreads = manager.getState().spreads;
    const tail = manager.getElementById(tailId) as TableElement;
    expect(tail.cells).toBe(head.cells);
    const before = manager.exportJson();
    expect(() => manager.updateTableSource(tailId, { cols: 6 })).toThrow('cell dimensions');
    expect(() => manager.updateTableSource(tailId, { cells: Array.from({ length: 5 }, () => Array(1)) })).toThrow('expected an object');
    expect(manager.exportJson()).toBe(before);
    const unchanged = head.cells[0];
    manager.updateTableCell(tailId, 1, 0, 'Revised');
    expect(manager.getState().spreads).toBe(spreads);
    expect(tail.cells).toBe(head.cells);
    expect(head.cells[0]).toBe(unchanged);
    expect(head.cells[1][0].text).toBe('Revised');
    manager.undo();
    expect(manager.exportJson()).toBe(before);
    manager.redo();
    expect((manager.getElementById(tailId) as TableElement).cells[1][0].text).toBe('Revised');
  });
  it('blocks a PDF when a linked continuation is excluded from publication', async () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Hidden continuation', false);
    manager.addElement(table({ pageId: manager.getActiveSpread().pages[0].id, width: 100, height: 40 }));
    const next = manager.addTableContinuationPage('table'); manager.updateElement(next, { editorialOnly: true });
    await expect(exportDocumentToPdf(manager.getState(), { download: false })).rejects.toThrow('excluded');
  });
});
