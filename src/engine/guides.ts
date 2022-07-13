// Papercut Studio Print Guides & Metric Rulers Engine
// InDesign-standard magenta margins (#d82676), cyan column gutters (#00c8d7), and bleed perimeter (#e63946)
import { DocumentSettings, Spread, Page } from '../types/index';
import { mmToPx, MM_TO_PX, Point2D } from './viewport';

export interface GuideColors {
  margin: string;
  bleed: string;
  column: string;
  spine: string;
  baseline: string;
}

export const DEFAULT_GUIDE_COLORS: GuideColors = {
  margin: '#d82676', // InDesign margin magenta
  bleed: '#e63946',  // Commercial bleed boundary red
  column: 'rgba(0, 200, 215, 0.45)', // Column guide cyan
  spine: 'rgba(100, 100, 100, 0.4)',  // Spread spine fold line
  baseline: 'rgba(70, 130, 255, 0.15)', // Baseline grid pitch
};

/** Renders the commercial print bleed box surrounding the spread. */
export function drawBleedPerimeter(
  ctx: CanvasRenderingContext2D,
  originPx: Point2D,
  spreadWidthMm: number,
  spreadHeightMm: number,
  bleedMm: number,
  zoom: number,
  color = DEFAULT_GUIDE_COLORS.bleed
): void {
  if (bleedMm <= 0) return;

  const bleedPx = mmToPx(bleedMm, zoom);
  const spreadWPx = mmToPx(spreadWidthMm, zoom);
  const spreadHPx = mmToPx(spreadHeightMm, zoom);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(
    originPx.x - bleedPx,
    originPx.y - bleedPx,
    spreadWPx + bleedPx * 2,
    spreadHPx + bleedPx * 2
  );
  ctx.restore();
}

/** Renders facing-page margin boundaries, column grid guides, and spine fold. */
export function drawSpreadGuides(
  ctx: CanvasRenderingContext2D,
  originPx: Point2D,
  spread: Spread,
  settings: DocumentSettings,
  zoom: number,
  colors = DEFAULT_GUIDE_COLORS
): void {
  const { widthMm, heightMm, margins, columnCount, columnGutterMm } = settings;
  const pageWPx = mmToPx(widthMm, zoom);
  const pageHPx = mmToPx(heightMm, zoom);

  ctx.save();
  ctx.lineWidth = 1;

  spread.pages.forEach((page, pageIdx) => {
    const pageOriginX = originPx.x + pageIdx * pageWPx;
    const pageOriginY = originPx.y;

    // Determine inside/outside margin orientation for facing pages
    const isLeftPage = page.side === 'left';
    const leftMarginMm = isLeftPage ? margins.outsideMm : margins.insideMm;
    const rightMarginMm = isLeftPage ? margins.insideMm : margins.outsideMm;

    const topPx = mmToPx(margins.topMm, zoom);
    const bottomPx = mmToPx(margins.bottomMm, zoom);
    const leftPx = mmToPx(leftMarginMm, zoom);
    const rightPx = mmToPx(rightMarginMm, zoom);

    const marginBoxX = pageOriginX + leftPx;
    const marginBoxY = pageOriginY + topPx;
    const marginBoxW = pageWPx - leftPx - rightPx;
    const marginBoxH = pageHPx - topPx - bottomPx;

    // InDesign magenta margins
    ctx.strokeStyle = colors.margin;
    ctx.setLineDash([]);
    ctx.strokeRect(marginBoxX, marginBoxY, marginBoxW, marginBoxH);

    // Multi-column grid gutters
    if (columnCount > 1 && marginBoxW > 0) {
      ctx.strokeStyle = colors.column;
      const totalGuttersW = (columnCount - 1) * mmToPx(columnGutterMm, zoom);
      const colWPx = (marginBoxW - totalGuttersW) / columnCount;
      const gutterPx = mmToPx(columnGutterMm, zoom);

      for (let c = 0; c < columnCount - 1; c++) {
        const gutterLeftX = marginBoxX + (c + 1) * colWPx + c * gutterPx;
        const gutterRightX = gutterLeftX + gutterPx;

        ctx.strokeRect(gutterLeftX, marginBoxY, 0, marginBoxH);
        ctx.strokeRect(gutterRightX, marginBoxY, 0, marginBoxH);
      }
    }
  });

  // Spine divide line between facing pages
  if (spread.pages.length > 1) {
    ctx.strokeStyle = colors.spine;
    ctx.setLineDash([]);
    const spineX = originPx.x + pageWPx;
    ctx.beginPath();
    ctx.moveTo(spineX, originPx.y);
    ctx.lineTo(spineX, originPx.y + pageHPx);
    ctx.stroke();
  }

  ctx.restore();
}

/** Renders the typographic baseline grid across page areas. */
export function drawBaselineGrid(
  ctx: CanvasRenderingContext2D,
  originPx: Point2D,
  spread: Spread,
  settings: DocumentSettings,
  zoom: number,
  color = DEFAULT_GUIDE_COLORS.baseline
): void {
  const { baselineGrid, widthMm, heightMm } = settings;
  if (!baselineGrid || !baselineGrid.enabled) return;

  const pageWPx = mmToPx(widthMm, zoom);
  const totalWPx = pageWPx * spread.pages.length;
  const pageHPx = mmToPx(heightMm, zoom);

  const startPx = mmToPx(baselineGrid.startMm || 0, zoom);
  const incrementMm = (baselineGrid.incrementPt * 25.4) / 72;
  const incrementPx = mmToPx(incrementMm, zoom);

  if (incrementPx < 4) return; // Prevent dense moire artifacting at low zoom

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  ctx.beginPath();
  let currentY = originPx.y + startPx;
  const maxY = originPx.y + pageHPx;

  while (currentY <= maxY) {
    ctx.moveTo(originPx.x, currentY);
    ctx.lineTo(originPx.x + totalWPx, currentY);
    currentY += incrementPx;
  }
  ctx.stroke();
  ctx.restore();
}

/** Draws metric millimeter rulers along the top and left edges of the viewport. */
export function drawRuler(
  ctx: CanvasRenderingContext2D,
  orientation: 'horizontal' | 'vertical',
  lengthPx: number,
  spreadOriginOffsetPx: number,
  zoom: number,
  mouseCoordPx?: number
): void {
  const isHoriz = orientation === 'horizontal';
  const breadthPx = 24;

  ctx.clearRect(0, 0, isHoriz ? lengthPx : breadthPx, isHoriz ? breadthPx : lengthPx);
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, isHoriz ? lengthPx : breadthPx, isHoriz ? breadthPx : lengthPx);

  // Border separator
  ctx.strokeStyle = '#383838';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (isHoriz) {
    ctx.moveTo(0, breadthPx - 0.5);
    ctx.lineTo(lengthPx, breadthPx - 0.5);
  } else {
    ctx.moveTo(breadthPx - 0.5, 0);
    ctx.lineTo(breadthPx - 0.5, lengthPx);
  }
  ctx.stroke();

  // Metric ticks (10mm major, 5mm medium, 1mm minor)
  const pxPerMm = MM_TO_PX * zoom;
  const firstMm = Math.floor(-spreadOriginOffsetPx / pxPerMm);
  const lastMm = Math.ceil((lengthPx - spreadOriginOffsetPx) / pxPerMm);

  ctx.fillStyle = '#888888';
  ctx.strokeStyle = '#555555';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let mm = firstMm; mm <= lastMm; mm++) {
    const posPx = spreadOriginOffsetPx + mm * pxPerMm;
    if (posPx < 0 || posPx > lengthPx) continue;

    const isMajor = mm % 10 === 0;
    const isMid = mm % 5 === 0;
    const tickLen = isMajor ? 12 : isMid ? 8 : 4;

    ctx.beginPath();
    if (isHoriz) {
      ctx.moveTo(posPx, breadthPx - tickLen);
      ctx.lineTo(posPx, breadthPx);
    } else {
      ctx.moveTo(breadthPx - tickLen, posPx);
      ctx.lineTo(breadthPx, posPx);
    }
    ctx.stroke();

    if (isMajor) {
      if (isHoriz) {
        ctx.fillText(mm.toString(), posPx + 2, 2);
      } else {
        ctx.save();
        ctx.translate(2, posPx + 2);
        ctx.fillText(mm.toString(), 0, 0);
        ctx.restore();
      }
    }
  }

  // Current cursor indicator hairline
  if (typeof mouseCoordPx === 'number') {
    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (isHoriz) {
      ctx.moveTo(mouseCoordPx, 0);
      ctx.lineTo(mouseCoordPx, breadthPx);
    } else {
      ctx.moveTo(0, mouseCoordPx);
      ctx.lineTo(breadthPx, mouseCoordPx);
    }
    ctx.stroke();
  }
}
