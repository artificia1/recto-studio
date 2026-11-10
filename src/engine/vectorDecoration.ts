import type { VectorDecoration } from '../types';
import { cmykDisplayColor, explicitCmyk, rgbColor, type Cmyk } from './inkColors';

type Mesh = Extract<VectorDecoration, { kind: 'mesh' }>;
type Hatch = Extract<VectorDecoration, { kind: 'hatch' }>;

export function validDecorationColor(color: string, process?: boolean) {
  return process === true ? !!explicitCmyk(color) : process === false ? !!rgbColor(color) : !!(explicitCmyk(color) || rgbColor(color));
}

export function hatchLines(settings: Hatch, width: number, height: number) {
  const distance = Math.hypot(width, height) / 2;
  const count = Math.min(2048, Math.ceil(distance / settings.spacing));
  return (settings.crossed ? [settings.angle, settings.angle + 90] : [settings.angle]).flatMap(degrees => {
    const angle = degrees * Math.PI / 180, dx = Math.cos(angle), dy = Math.sin(angle);
    return Array.from({ length: count * 2 + 1 }, (_, i) => {
      const offset = (i - count) * settings.spacing;
      const x = width / 2 - dy * offset, y = height / 2 + dx * offset;
      return { x1: x - dx * distance, y1: y - dy * distance, x2: x + dx * distance, y2: y + dy * distance };
    });
  });
}

export function meshCells(mesh: Mesh) {
  const process = !!explicitCmyk(mesh.colors[0]);
  const colors = mesh.colors.map(color => process ? explicitCmyk(color)! : rgbColor(color)!);
  if (colors.some(channels => !channels)) throw new Error('Mesh colors must use the same color space.');
  const xCount = (mesh.columns - 1) * 12, yCount = (mesh.rows - 1) * 12;
  return Array.from({ length: xCount * yCount }, (_, index) => {
    const x = index % xCount, y = Math.floor(index / xCount);
    const column = Math.floor(x / 12), row = Math.floor(y / 12);
    const a = (x % 12 + 0.5) / 12, b = (y % 12 + 0.5) / 12;
    const top = row * mesh.columns + column, bottom = top + mesh.columns;
    const values = colors[top].map((start, channel) => (start * (1 - a) + colors[top + 1][channel] * a) * (1 - b) +
      (colors[bottom][channel] * (1 - a) + colors[bottom + 1][channel] * a) * b);
    const ink = process ? `cmyk(${values.map(value => value.toFixed(2)).join(',')})` : `rgb(${values.map(Math.round).join(',')})`;
    return { x: x / xCount, y: y / yCount, width: 1 / xCount, height: 1 / yCount, ink };
  });
}

const meshPreview = new WeakMap<Mesh, HTMLCanvasElement>();
const displayInk = (value: string) => {
  const cmyk = explicitCmyk(value);
  return cmyk ? cmykDisplayColor(cmyk as Cmyk) : value;
};

export function drawCanvasDecoration(ctx: CanvasRenderingContext2D, decoration: VectorDecoration,
  x: number, y: number, width: number, height: number, scale: number, path?: Path2D) {
  ctx.save();
  if (path) ctx.clip(path);
  else ctx.clip();
  if (decoration.kind === 'hatch') {
    const lines = new Path2D();
    for (const line of hatchLines(decoration, width, height)) {
      lines.moveTo(x + line.x1 * scale, y + line.y1 * scale);
      lines.lineTo(x + line.x2 * scale, y + line.y2 * scale);
    }
    ctx.setLineDash([]);
    ctx.lineWidth = decoration.weight * scale;
    ctx.strokeStyle = displayInk(decoration.color);
    ctx.stroke(lines);
  } else {
    let tile = meshPreview.get(decoration);
    if (!tile) {
      tile = document.createElement('canvas');
      tile.width = (decoration.columns - 1) * 12;
      tile.height = (decoration.rows - 1) * 12;
      const paint = tile.getContext('2d');
      if (paint) for (const cell of meshCells(decoration)) {
        paint.fillStyle = displayInk(cell.ink);
        paint.fillRect(Math.round(cell.x * tile.width), Math.round(cell.y * tile.height), 1, 1);
      }
      meshPreview.set(decoration, tile);
    }
    ctx.drawImage(tile, x, y, width * scale, height * scale);
  }
  ctx.restore();
}
