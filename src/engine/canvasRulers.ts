import { MM_TO_PX, type Point2D } from './viewport';

export interface RulerPalette { background: string; marks: string; labels: string; cursor: string }

const thickness = 24;

/** The marks stay on their canvas. The cursor moves independently of the canvas drawing. */
export class CanvasRulers {
  private readonly topCursor = document.createElement('span');
  private readonly leftCursor = document.createElement('span');
  private width = 0;
  private height = 0;
  private topKey = '';
  private leftKey = '';
  private cursorX = NaN;
  private cursorY = NaN;
  private cursorColor = '';

  constructor(
    private readonly top: HTMLCanvasElement, private readonly left: HTMLCanvasElement,
    private readonly topContext: CanvasRenderingContext2D, private readonly leftContext: CanvasRenderingContext2D,
  ) {
    this.topCursor.className = 'ruler-cursor ruler-cursor-top';
    this.leftCursor.className = 'ruler-cursor ruler-cursor-left';
    for (const cursor of [this.topCursor, this.leftCursor]) cursor.setAttribute('aria-hidden', 'true');
    top.parentElement?.appendChild(this.topCursor);
    left.parentElement?.appendChild(this.leftCursor);
  }

  resize(width: number, height: number, scale: number) {
    this.width = width;
    this.height = height;
    this.top.width = width * scale;
    this.top.height = thickness * scale;
    this.top.style.width = `${width}px`;
    this.top.style.height = `${thickness}px`;
    this.left.width = thickness * scale;
    this.left.height = height * scale;
    this.left.style.width = `${thickness}px`;
    this.left.style.height = `${height}px`;
    this.topContext.setTransform(scale, 0, 0, scale, 0, 0);
    this.leftContext.setTransform(scale, 0, 0, scale, 0, 0);
    this.invalidateMarks();
  }

  invalidateMarks() {
    this.topKey = this.leftKey = '';
  }

  draw(origin: Point2D, zoom: number, mouse: Point2D, palette: RulerPalette) {
    const pxPerMm = MM_TO_PX * zoom;
    const colors = `${palette.background}:${palette.marks}:${palette.labels}`;
    const topKey = `${origin.x}:${zoom}:${colors}`;
    const leftKey = `${origin.y}:${zoom}:${colors}`;
    if (topKey !== this.topKey) {
      drawMarks(this.topContext, this.width, origin.x, pxPerMm, palette, true);
      this.topKey = topKey;
    }
    if (leftKey !== this.leftKey) {
      drawMarks(this.leftContext, this.height, origin.y, pxPerMm, palette, false);
      this.leftKey = leftKey;
    }

    if (palette.cursor !== this.cursorColor) {
      this.cursorColor = palette.cursor;
      this.topCursor.style.backgroundColor = this.leftCursor.style.backgroundColor = palette.cursor;
    }
    const x = origin.x + mouse.x * pxPerMm, y = origin.y + mouse.y * pxPerMm;
    if (x !== this.cursorX) {
      this.topCursor.style.transform = `translateX(${x - 0.5}px)`;
      this.cursorX = x;
    }
    if (y !== this.cursorY) {
      this.leftCursor.style.transform = `translateY(${y - 0.5}px)`;
      this.cursorY = y;
    }
  }

  destroy() {
    this.topCursor.remove();
    this.leftCursor.remove();
  }
}

function drawMarks(ctx: CanvasRenderingContext2D, length: number, origin: number, pxPerMm: number,
  palette: RulerPalette, horizontal: boolean) {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, horizontal ? length : thickness, horizontal ? thickness : length);
  ctx.strokeStyle = palette.marks;
  ctx.fillStyle = palette.labels;
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = horizontal ? 'left' : 'right';
  ctx.lineWidth = 1;
  const startMm = Math.ceil(Math.floor(-origin / pxPerMm) / 10) * 10;
  const endMm = Math.ceil((length - origin) / pxPerMm);

  ctx.beginPath();
  for (let mm = startMm; mm <= endMm; mm += 10) {
    const position = origin + mm * pxPerMm;
    const major = mm % 50 === 0;
    if (horizontal) {
      ctx.moveTo(position, major ? 10 : 16);
      ctx.lineTo(position, thickness);
      if (major) ctx.fillText(String(mm), position + 2, 9);
    } else {
      ctx.moveTo(major ? 10 : 16, position);
      ctx.lineTo(thickness, position);
      if (major) {
        ctx.save();
        ctx.translate(9, position - 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(mm), 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
}
