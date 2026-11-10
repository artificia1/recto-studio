import type { jsPDF } from 'jspdf';
import type { VectorPathElement } from '../types';
import { applyCmykDrawColor, applyCmykFillColor, applySpotColor } from './pdfColors';
import { drawPdfGradient } from './pdfGradients';
import { drawPdfDecoration } from './pdfVectorDecoration';

/** Preserve real cubic curves and closed fills instead of exporting sampled stroke segments. */
export function drawVectorPathPdf(doc: jsPDF, path: VectorPathElement, x: number, y: number) {
  if (path.nodes.length < 2) return;
  const operations: { op: string; c: number[] }[] = [{ op: 'm', c: [x + path.nodes[0].x, y + path.nodes[0].y] }];
  const count = path.closed ? path.nodes.length : path.nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i], b = path.nodes[(i + 1) % path.nodes.length];
    operations.push(a.handleOut || b.handleIn ? { op: 'c', c: [x + a.x + (a.handleOut?.x || 0), y + a.y + (a.handleOut?.y || 0), x + b.x + (b.handleIn?.x || 0), y + b.y + (b.handleIn?.y || 0), x + b.x, y + b.y] } : { op: 'l', c: [x + b.x, y + b.y] });
  }
  if (path.closed) operations.push({ op: 'h', c: [] });
  const gradient = path.closed && path.fillGradient;
  const fill = !gradient && path.closed && !!path.fillColor && !['transparent', 'none'].includes(path.fillColor);
  const stroke = path.strokeWidthMm > 0 && !!path.strokeColor && !['transparent', 'none'].includes(path.strokeColor);
  if (fill) applyCmykFillColor(doc, path.fillColor);
  if (stroke) { path.spotColor ? applySpotColor(doc, path.spotColor, true) : applyCmykDrawColor(doc, path.strokeColor); doc.setLineWidth(path.strokeWidthMm); }
  doc.setLineCap(path.strokeCap || 'butt'); doc.setLineJoin(path.strokeJoin || 'miter');
  doc.setLineDashPattern(path.strokePattern ? [path.strokePattern.dash, path.strokePattern.gap] : path.strokeDash === 'dashed' ? [2, 1] : [], 0);
  if (gradient) drawPdfGradient(doc, gradient, x, y, path.width, path.height, () => doc.path(operations));
  if (path.closed && path.decoration && !path.spotColor) {
    if (fill && path.decoration.kind === 'hatch') { doc.path(operations); doc.fill(); }
    drawPdfDecoration(doc, path.decoration, x, y, path.width, path.height, () => doc.path(operations));
    if (stroke) { doc.path(operations); doc.stroke(); }
    return;
  }
  doc.path(operations);
  if (fill && stroke) doc.fillStroke(); else if (fill) doc.fill(); else if (stroke) doc.stroke(); else doc.discardPath();
}
