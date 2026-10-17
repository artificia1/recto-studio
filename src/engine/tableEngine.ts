/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Multi-Page Threaded Table Engine with Repeating Headers/Footers,
 * Row Keep Options, and Prepress DeviceCMYK Vector Output.
 */

import { TableElement, TableCell } from '../types/index';
import { applyCmykFillColor, applyCmykDrawColor, applyCmykTextColor } from '../export/pdfExport';

export interface TableRowSlice {
  frameId: string;
  isFirstFrame: boolean;
  headerRows: TableCell[][];
  bodyRows: { originalRowIndex: number; cells: TableCell[] }[];
  footerRows: TableCell[][];
  totalRenderedRows: number;
}

export class TableEngine {
  /**
   * Computes the row slice distribution for a threaded table chain across pages.
   */
  public computeFrameSlice(
    table: TableElement,
    allTablesInThread: TableElement[] = [table]
  ): TableRowSlice {
    const totalRows = table.rows || (table.cells ? table.cells.length : 0);
    const headerCount = Math.min(table.headerRowCount || 0, totalRows);
    const footerCount = Math.min(table.footerRowCount || 0, Math.max(0, totalRows - headerCount));

    const isFirstFrame = !table.prevFrameId;
    const headerRows = table.cells.slice(0, headerCount);
    const footerRows = footerCount > 0 ? table.cells.slice(totalRows - footerCount) : [];
    const allBodyRows = table.cells.slice(headerCount, totalRows - footerCount);

    // If this table is standalone or is not threaded, render all rows that fit
    if (allTablesInThread.length <= 1) {
      return {
        frameId: table.id,
        isFirstFrame: true,
        headerRows,
        bodyRows: allBodyRows.map((cells, idx) => ({
          originalRowIndex: headerCount + idx,
          cells,
        })),
        footerRows,
        totalRenderedRows: totalRows,
      };
    }

    // Determine thread index
    const threadIndex = allTablesInThread.findIndex((t) => t.id === table.id);
    const safeIndex = threadIndex >= 0 ? threadIndex : 0;

    // Distribute body rows across frames in the thread chain
    const numFrames = Math.max(1, allTablesInThread.length);
    const bodyRowsPerFrame = Math.max(1, Math.ceil(allBodyRows.length / numFrames));
    const bodyStartIndex = safeIndex * bodyRowsPerFrame;
    const sliceBody = allBodyRows.slice(bodyStartIndex, bodyStartIndex + bodyRowsPerFrame);

    return {
      frameId: table.id,
      isFirstFrame: safeIndex === 0,
      headerRows: (safeIndex === 0 || table.repeatHeaderOnOverflow !== false) ? headerRows : [],
      bodyRows: sliceBody.map((cells, idx) => ({
        originalRowIndex: headerCount + bodyStartIndex + idx,
        cells,
      })),
      footerRows: (safeIndex === allTablesInThread.length - 1 || table.repeatFooterOnOverflow !== false) ? footerRows : [],
      totalRenderedRows: (headerRows.length + sliceBody.length + footerRows.length),
    };
  }

  /**
   * Renders a TableElement onto an HTML5 2D canvas context with repeating headers/footers.
   */
  public renderCanvasTable(
    ctx: CanvasRenderingContext2D,
    table: TableElement,
    screenX: number,
    screenY: number,
    screenW: number,
    screenH: number,
    pxPerMm: number,
    zoom: number,
    allTablesInThread: TableElement[] = [table]
  ): void {
    const slice = this.computeFrameSlice(table, allTablesInThread);
    const cols = Math.max(1, table.cols || 1);

    // Combine displayed rows: header + body + footer
    const displayRows: { cells: TableCell[]; isHeader: boolean; isFooter: boolean; originalIndex: number }[] = [];
    slice.headerRows.forEach((r, i) => displayRows.push({ cells: r, isHeader: true, isFooter: false, originalIndex: i }));
    slice.bodyRows.forEach((r) => displayRows.push({ cells: r.cells, isHeader: false, isFooter: false, originalIndex: r.originalRowIndex }));
    slice.footerRows.forEach((r, i) => displayRows.push({ cells: r, isHeader: false, isFooter: true, originalIndex: (table.rows - slice.footerRows.length + i) }));

    const numRows = Math.max(1, displayRows.length);
    const cellW = screenW / cols;
    const cellH = screenH / numRows;
    const paddingPx = (table.cellPaddingMm || 1.5) * pxPerMm;
    const fontSizePx = (table.fontSizePt * (96 / 72)) * zoom;
    const borderColor = table.borderColor || '#333333';
    const borderWidthPx = (table.borderWidthMm || 0.3) * pxPerMm;

    // 1. Draw cell backgrounds
    for (let r = 0; r < numRows; r++) {
      const rowItem = displayRows[r];
      for (let c = 0; c < cols; c++) {
        const cX = screenX + (c * cellW);
        const cY = screenY + (r * cellH);
        const cell = rowItem.cells?.[c];

        let cellBg = cell?.fillColor;
        if (!cellBg) {
          if (rowItem.isHeader) {
            cellBg = table.headerFillColor || '#242424';
          } else if (rowItem.isFooter) {
            cellBg = table.footerFillColor || '#e8e8e8';
          } else if (table.alternateRowColor && rowItem.originalIndex % 2 === 1) {
            cellBg = table.alternateRowColor;
          } else {
            cellBg = '#ffffff';
          }
        }

        if (cellBg && cellBg !== 'transparent') {
          ctx.fillStyle = cellBg;
          ctx.fillRect(cX, cY, cellW, cellH);
        }
      }
    }

    // 2. Draw grid lines
    if (borderWidthPx > 0) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidthPx;
      ctx.strokeRect(screenX, screenY, screenW, screenH);

      for (let r = 1; r < numRows; r++) {
        const y = screenY + (r * cellH);
        ctx.beginPath();
        ctx.moveTo(screenX, y);
        ctx.lineTo(screenX + screenW, y);
        ctx.stroke();
      }

      for (let c = 1; c < cols; c++) {
        const x = screenX + (c * cellW);
        ctx.beginPath();
        ctx.moveTo(x, screenY);
        ctx.lineTo(x, screenY + screenH);
        ctx.stroke();
      }
    }

    // 3. Render cell typography
    ctx.font = `${fontSizePx}px ${table.fontFamily || 'Inter, sans-serif'}`;
    for (let r = 0; r < numRows; r++) {
      const rowItem = displayRows[r];
      for (let c = 0; c < cols; c++) {
        const cX = screenX + (c * cellW);
        const cY = screenY + (r * cellH);
        const cell = rowItem.cells?.[c];
        const textStr = cell?.text || '';

        if (textStr) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(cX + paddingPx, cY + paddingPx, Math.max(1, cellW - (paddingPx * 2)), Math.max(1, cellH - (paddingPx * 2)));
          ctx.clip();

          let textCol = cell?.textColor;
          if (!textCol) {
            if (rowItem.isHeader) {
              textCol = table.headerTextColor || '#ffffff';
            } else if (rowItem.isFooter) {
              textCol = table.footerTextColor || '#222222';
            } else {
              textCol = '#222222';
            }
          }
          ctx.fillStyle = textCol;

          const align = cell?.align || (rowItem.isHeader ? 'left' : 'left');
          ctx.textAlign = align;
          ctx.textBaseline = 'middle';

          let drawX = cX + paddingPx;
          if (align === 'center') drawX = cX + cellW / 2;
          else if (align === 'right') drawX = cX + cellW - paddingPx;

          const drawY = cY + (cellH / 2);
          ctx.fillText(textStr, drawX, drawY);
          ctx.restore();
        }
      }
    }
  }

  /**
   * Exports a table to pure PostScript DeviceCMYK PDF vector operators with repeating headers.
   */
  public exportPdfTable(
    doc: any,
    table: TableElement,
    xMm: number,
    yMm: number,
    wMm: number,
    hMm: number,
    allTablesInThread: TableElement[] = [table],
    overprintBlack: boolean = true
  ): void {
    const slice = this.computeFrameSlice(table, allTablesInThread);
    const cols = Math.max(1, table.cols || 1);

    const displayRows: { cells: TableCell[]; isHeader: boolean; isFooter: boolean; originalIndex: number }[] = [];
    slice.headerRows.forEach((r, i) => displayRows.push({ cells: r, isHeader: true, isFooter: false, originalIndex: i }));
    slice.bodyRows.forEach((r) => displayRows.push({ cells: r.cells, isHeader: false, isFooter: false, originalIndex: r.originalRowIndex }));
    slice.footerRows.forEach((r, i) => displayRows.push({ cells: r, isHeader: false, isFooter: true, originalIndex: (table.rows - slice.footerRows.length + i) }));

    const numRows = Math.max(1, displayRows.length);
    const cellW = wMm / cols;
    const cellH = hMm / numRows;
    const padding = table.cellPaddingMm || 1.5;

    // 1. Draw cell fills
    for (let r = 0; r < numRows; r++) {
      const rowItem = displayRows[r];
      for (let c = 0; c < cols; c++) {
        const cX = xMm + (c * cellW);
        const cY = yMm + (r * cellH);
        const cell = rowItem.cells?.[c];

        let cellBg = cell?.fillColor;
        if (!cellBg) {
          if (rowItem.isHeader) {
            cellBg = table.headerFillColor || '#242424';
          } else if (rowItem.isFooter) {
            cellBg = table.footerFillColor || '#e8e8e8';
          } else if (table.alternateRowColor && rowItem.originalIndex % 2 === 1) {
            cellBg = table.alternateRowColor;
          }
        }

        if (cellBg && cellBg !== 'transparent') {
          applyCmykFillColor(doc, cellBg);
          doc.rect(cX, cY, cellW, cellH, 'F');
        }
      }
    }

    // 2. Draw cell borders
    const borderW = table.borderWidthMm || 0.3;
    if (borderW > 0) {
      applyCmykDrawColor(doc, table.borderColor || '#333333');
      doc.setLineWidth(borderW);
      doc.rect(xMm, yMm, wMm, hMm, 'S');

      for (let r = 1; r < numRows; r++) {
        const y = yMm + (r * cellH);
        doc.line(xMm, y, xMm + wMm, y);
      }
      for (let c = 1; c < cols; c++) {
        const x = xMm + (c * cellW);
        doc.line(x, yMm, x, yMm + hMm);
      }
    }

    // 3. Draw text in DeviceCMYK with Overprint Black support
    doc.setFontSize(table.fontSizePt || 9);
    for (let r = 0; r < numRows; r++) {
      const rowItem = displayRows[r];
      for (let c = 0; c < cols; c++) {
        const cX = xMm + (c * cellW);
        const cY = yMm + (r * cellH);
        const cell = rowItem.cells?.[c];
        const textStr = cell?.text || '';

        if (textStr) {
          let textCol = cell?.textColor;
          if (!textCol) {
            if (rowItem.isHeader) textCol = table.headerTextColor || '#ffffff';
            else if (rowItem.isFooter) textCol = table.footerTextColor || '#222222';
            else textCol = '#222222';
          }

          applyCmykTextColor(doc, textCol, overprintBlack);

          const align = cell?.align || 'left';
          let drawX = cX + padding;
          if (align === 'center') drawX = cX + (cellW / 2);
          else if (align === 'right') drawX = cX + cellW - padding;

          const drawY = cY + (cellH / 2) + ((table.fontSizePt * 0.3527) / 3);
          doc.text(textStr, drawX, drawY, { align: align as any });
        }
      }
    }
  }
}

export const tableEngine = new TableEngine();
