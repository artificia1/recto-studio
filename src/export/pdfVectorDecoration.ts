import type { jsPDF } from 'jspdf';
import type { VectorDecoration } from '../types';
import { hatchLines, meshCells } from '../engine/vectorDecoration';
import { applyCmykDrawColor, applyCmykFillColor } from './pdfColors';

export function drawPdfDecoration(doc: jsPDF, decoration: VectorDecoration, x: number, y: number, width: number, height: number, trace: () => void) {
  doc.saveGraphicsState();
  try {
    trace();
    doc.clip();
    doc.discardPath();
    if (decoration.kind === 'hatch') {
      applyCmykDrawColor(doc, decoration.color);
      doc.setLineWidth(decoration.weight);
      doc.setLineDashPattern([], 0);
      for (const line of hatchLines(decoration, width, height)) {
        doc.line(x + line.x1, y + line.y1, x + line.x2, y + line.y2);
      }
    } else for (const cell of meshCells(decoration)) {
      applyCmykFillColor(doc, cell.ink);
      doc.rect(x + cell.x * width, y + cell.y * height, cell.width * width + 0.001, cell.height * height + 0.001, 'F');
    }
  } finally { doc.restoreGraphicsState(); }
}
