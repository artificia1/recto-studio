import { describe, it, expect } from 'vitest';
import { tableEngine } from '../src/engine/tableEngine';
import { TableElement, TableCell } from '../src/types';
import { stateManager } from '../src/state';
import { jsPDF } from 'jspdf';

describe('Table Engine & Multi-Page Overflow Threading', () => {
  const dummyCells: TableCell[][] = [
    // Header row 0
    [{ text: 'SKU' }, { text: 'Item' }, { text: 'Price' }],
    // Header row 1
    [{ text: 'ID' }, { text: 'Product' }, { text: 'USD' }],
    // Data rows 2 to 7
    [{ text: '001' }, { text: 'Mechanical Watch' }, { text: '$240' }],
    [{ text: '002' }, { text: 'Leather Band' }, { text: '$35' }],
    [{ text: '003' }, { text: 'Sapphire Crystal' }, { text: '$80' }],
    [{ text: '004' }, { text: 'Bezel Ring' }, { text: '$45' }],
    [{ text: '005' }, { text: 'Rotor Weight' }, { text: '$60' }],
    [{ text: '006' }, { text: 'Balance Spring' }, { text: '$95' }],
  ];

  const parentTable: TableElement = {
    id: 'test-tbl-1',
    type: 'table',
    pageId: 'page-1',
    x: 20,
    y: 20,
    width: 160,
    height: 60,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    rows: 8,
    cols: 3,
    headerRowCount: 2,
    headerFillColor: '#242424',
    headerTextColor: '#ffffff',
    borderColor: '#333333',
    borderWidthMm: 0.3,
    cellPaddingMm: 1.5,
    fontFamily: 'Inter, sans-serif',
    fontSizePt: 9,
    repeatHeaderOnOverflow: true,
    cells: dummyCells,
    nextFrameId: 'test-tbl-2',
  };

  const childTable: TableElement = {
    ...parentTable,
    id: 'test-tbl-2',
    pageId: 'page-2',
    prevFrameId: 'test-tbl-1',
    nextFrameId: undefined,
  };

  it('computes frame slices with repeating headers on continuation frames', () => {
    const thread = [parentTable, childTable];

    const slice1 = tableEngine.computeFrameSlice(parentTable, thread);
    expect(slice1.isFirstFrame).toBe(true);
    expect(slice1.headerRows.length).toBe(2);
    expect(slice1.headerRows[0][0].text).toBe('SKU');
    expect(slice1.bodyRows.length).toBeGreaterThan(0);

    const slice2 = tableEngine.computeFrameSlice(childTable, thread);
    expect(slice2.isFirstFrame).toBe(false);
    expect(slice2.headerRows.length).toBe(2); // Repeating header!
    expect(slice2.headerRows[0][0].text).toBe('SKU');
    expect(slice2.bodyRows.length).toBeGreaterThan(0);
    // Body rows on child must start after slice 1
    expect(slice2.bodyRows[0].originalRowIndex).toBeGreaterThan(slice1.bodyRows[0].originalRowIndex);
  });

  it('exports table to PDF with DeviceCMYK fills, borders, and text', () => {
    const doc = new jsPDF({ unit: 'mm', compress: false });
    expect(() => {
      tableEngine.exportPdfTable(doc, parentTable, 20, 20, 160, 60, [parentTable], true);
    }).not.toThrow();

    const pdfOut = doc.output();
    expect(pdfOut.length).toBeGreaterThan(500);
    expect(pdfOut).toContain('SKU');
    expect(pdfOut).toContain('Mechanical Watch');
  });

  it('links and unlinks table frames in stateManager', () => {
    stateManager.addElement(parentTable);
    stateManager.addElement({
      ...childTable,
      cells: [],
    });

    const linked = stateManager.linkTableFrames(parentTable.id, childTable.id);
    expect(linked).toBe(true);
    const updatedChild = stateManager.getElementById(childTable.id) as TableElement;
    expect(updatedChild.cells.length).toBe(parentTable.cells.length);
    expect(updatedChild.prevFrameId).toBe(parentTable.id);

    const unlinked = stateManager.unlinkTableFrame(childTable.id);
    expect(unlinked).toBe(true);
    const unlinkedChild = stateManager.getElementById(childTable.id) as TableElement;
    expect(unlinkedChild.prevFrameId).toBeUndefined();

    stateManager.deleteElement(parentTable.id);
    stateManager.deleteElement(childTable.id);
  });
});
