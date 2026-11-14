import { MM_TO_PX, type Point2D } from './viewport';

export interface RulerPalette { background: string; marks: string; labels: string; cursor: string }

export function drawCanvasRulers(
  rulerTop: HTMLCanvasElement, rulerLeft: HTMLCanvasElement,
  ctxT: CanvasRenderingContext2D, ctxL: CanvasRenderingContext2D,
  origin: Point2D, zoom: number, mouse: Point2D, palette: RulerPalette,
) {
  const pxPerMm = MM_TO_PX * zoom;

  const wT = rulerTop.getBoundingClientRect().width;
  ctxT.fillStyle = palette.background;
  ctxT.fillRect(0, 0, wT, 24);

  ctxT.strokeStyle = palette.marks;
  ctxT.fillStyle = palette.labels;
  ctxT.font = '9px Inter, sans-serif';
  ctxT.textAlign = 'left';
  ctxT.lineWidth = 1;

  const startMmX = Math.floor(-origin.x / pxPerMm);
  const endMmX = Math.ceil((wT - origin.x) / pxPerMm);

  for (let mm = startMmX; mm <= endMmX; mm++) {
    const screenX = origin.x + (mm * pxPerMm);
    if (mm % 50 === 0) {
      ctxT.beginPath();
      ctxT.moveTo(screenX, 10);
      ctxT.lineTo(screenX, 24);
      ctxT.stroke();
      ctxT.fillText(`${mm}`, screenX + 2, 9);
    } else if (mm % 10 === 0) {
      ctxT.beginPath();
      ctxT.moveTo(screenX, 16);
      ctxT.lineTo(screenX, 24);
      ctxT.stroke();
    }
  }

  const cursorTopX = origin.x + (mouse.x * pxPerMm);
  ctxT.strokeStyle = palette.cursor;
  ctxT.beginPath();
  ctxT.moveTo(cursorTopX, 0);
  ctxT.lineTo(cursorTopX, 24);
  ctxT.stroke();

  const hL = rulerLeft.getBoundingClientRect().height;
  ctxL.fillStyle = palette.background;
  ctxL.fillRect(0, 0, 24, hL);

  ctxL.strokeStyle = palette.marks;
  ctxL.fillStyle = palette.labels;
  ctxL.font = '9px Inter, sans-serif';
  ctxL.textAlign = 'right';
  ctxL.lineWidth = 1;

  const startMmY = Math.floor(-origin.y / pxPerMm);
  const endMmY = Math.ceil((hL - origin.y) / pxPerMm);

  for (let mm = startMmY; mm <= endMmY; mm++) {
    const screenY = origin.y + (mm * pxPerMm);
    if (mm % 50 === 0) {
      ctxL.beginPath();
      ctxL.moveTo(10, screenY);
      ctxL.lineTo(24, screenY);
      ctxL.stroke();
      ctxL.save();
      ctxL.translate(9, screenY - 2);
      ctxL.rotate(-Math.PI / 2);
      ctxL.fillText(`${mm}`, 0, 0);
      ctxL.restore();
    } else if (mm % 10 === 0) {
      ctxL.beginPath();
      ctxL.moveTo(16, screenY);
      ctxL.lineTo(24, screenY);
      ctxL.stroke();
    }
  }

  const cursorLeftY = origin.y + (mouse.y * pxPerMm);
  ctxL.strokeStyle = palette.cursor;
  ctxL.beginPath();
  ctxL.moveTo(0, cursorLeftY);
  ctxL.lineTo(24, cursorLeftY);
  ctxL.stroke();
}
