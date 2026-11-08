import type { TableElement } from '../types';
import type { TableFrameLayout, TableLayoutRow, TableLayoutCell } from './tableLayout';
import { fontManager } from '../fontManager';
import { drawFontText, fontTextWidth } from '../export/fontOutlines';
import { applyCmykFillColor, applyCmykDrawColor, applyCmykTextColor } from '../export/pdfColors';

const background = (frame: TableElement, row: TableLayoutRow) => row.kind === 'header' ? frame.headerFillColor : row.kind === 'footer' ? frame.footerFillColor || '#e8e8e8' : row.index % 2 && frame.alternateRowColor ? frame.alternateRowColor : '#ffffff';
const foreground = (frame: TableElement, row: TableLayoutRow) => row.kind === 'header' ? frame.headerTextColor : row.kind === 'footer' ? frame.footerTextColor || '#222222' : '#222222';
const verticalOffset = (box: TableLayoutCell, row: TableLayoutRow, padding: number, leading: number) => {
  const extra = Math.max(0, row.height - padding * 2 - box.lines.length * leading);
  return box.cell.verticalAlign === 'bottom' ? extra : box.cell.verticalAlign === 'middle' ? extra / 2 : 0;
};

export function drawContentTableCanvas(ctx: CanvasRenderingContext2D, frame: TableElement, layout: TableFrameLayout, x: number, y: number, scale: number) {
  const padding = frame.cellPaddingMm ?? 1.5, pt = frame.fontSizePt * 25.4 / 72, leading = pt * 1.35;
  ctx.save(); ctx.font = `${pt * scale}px ${frame.fontFamily}`; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px';
  for (const row of layout.rows) for (const box of row.cells) {
    const bx = x + box.x * scale, by = y + row.y * scale, bw = box.width * scale, bh = row.height * scale;
    const fill = box.cell.fillColor || background(frame, row);
    if (fill !== 'transparent') { ctx.fillStyle = fill; ctx.fillRect(bx, by, bw, bh); }
    if (frame.borderWidthMm > 0) { ctx.lineWidth = frame.borderWidthMm * scale; ctx.strokeStyle = frame.borderColor; ctx.strokeRect(bx, by, bw, bh); }
    ctx.save(); ctx.beginPath(); ctx.rect(bx + padding * scale, by + padding * scale, Math.max(0, bw - padding * 2 * scale), Math.max(0, bh - padding * 2 * scale)); ctx.clip();
    const align = box.cell.align || 'left'; ctx.textAlign = align; ctx.fillStyle = box.cell.textColor || foreground(frame, row);
    const tx = align === 'center' ? bx + bw / 2 : align === 'right' ? bx + bw - padding * scale : bx + padding * scale;
    box.lines.forEach((line, index) => ctx.fillText(line, tx, by + (padding + pt + verticalOffset(box, row, padding, leading) + index * leading) * scale)); ctx.restore();
  }
  ctx.restore();
}

export function drawContentTablePdf(doc: any, frame: TableElement, layout: TableFrameLayout, x: number, y: number, overprintBlack: boolean) {
  const padding = frame.cellPaddingMm ?? 1.5, pt = frame.fontSizePt * 25.4 / 72, leading = pt * 1.35;
  const font = fontManager.getFont(frame.fontFamily);
  doc.saveGraphicsState(); doc.setFontSize(frame.fontSizePt); doc.setFont('times', 'normal');
  for (const row of layout.rows) for (const box of row.cells) {
    const bx = x + box.x, by = y + row.y;
    const fill = box.cell.fillColor || background(frame, row);
    if (fill !== 'transparent') { applyCmykFillColor(doc, fill); doc.rect(bx, by, box.width, row.height, 'F'); }
    if (frame.borderWidthMm > 0) { applyCmykDrawColor(doc, frame.borderColor); doc.setLineWidth(frame.borderWidthMm); doc.rect(bx, by, box.width, row.height, 'S'); }
    doc.saveGraphicsState(); doc.rect(bx + padding, by + padding, Math.max(0, box.width - 2 * padding), Math.max(0, row.height - 2 * padding), null); doc.clip(); doc.discardPath();
    const color = box.cell.textColor || foreground(frame, row); applyCmykTextColor(doc, color, overprintBlack);
    const align = box.cell.align || 'left'; const tx = align === 'center' ? bx + box.width / 2 : align === 'right' ? bx + box.width - padding : bx + padding;
    box.lines.forEach((line, index) => {
      const ty = by + padding + pt + verticalOffset(box, row, padding, leading) + index * leading;
      if (font) { applyCmykFillColor(doc, color); const width = fontTextWidth(font, line, frame.fontSizePt); drawFontText(doc, font, line, tx - (align === 'center' ? width / 2 : align === 'right' ? width : 0), ty, frame.fontSizePt); }
      else doc.text(line, tx, ty, { align });
    });
    doc.restoreGraphicsState();
  }
  doc.restoreGraphicsState();
}
