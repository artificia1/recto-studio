import { cmykDisplayColor, explicitCmyk, rgbColor } from './inkColors';
import type { FillGradient } from '../types';

export function gradientCoordinates(gradient: FillGradient, x: number, y: number, width: number, height: number) {
  const x1 = x + gradient.start.x * width, y1 = y + gradient.start.y * height;
  const x2 = x + gradient.end.x * width, y2 = y + gradient.end.y * height;
  return { x1, y1, x2, y2, radius: Math.hypot(x2 - x1, y2 - y1) };
}

export function displayGradientColor(color: string) {
  const ink = explicitCmyk(color);
  return ink ? cmykDisplayColor(ink) : color;
}

export function validGradient(gradient: FillGradient) {
  return [gradient.start.x, gradient.start.y, gradient.end.x, gradient.end.y].every(value => Math.abs(value) <= 32) &&
    (gradient.start.x !== gradient.end.x || gradient.start.y !== gradient.end.y) &&
    gradient.stops.length >= 2 && gradient.stops.length <= 16 &&
    gradient.stops.every(({ offset, color }, i, stops) => offset >= 0 && offset <= 1 &&
      (!i || offset > stops[i - 1].offset) && !!(explicitCmyk(color) || rgbColor(color)));
}

export function canvasGradient(ctx: CanvasRenderingContext2D, gradient: FillGradient, x: number, y: number, width: number, height: number, monochrome = false) {
  const { x1, y1, x2, y2, radius } = gradientCoordinates(gradient, x, y, width, height);
  if (!radius) return monochrome ? '#000000' : displayGradientColor(gradient.stops[0].color);
  const fill = gradient.kind === 'radial' ? ctx.createRadialGradient(x1, y1, 0, x1, y1, radius) : ctx.createLinearGradient(x1, y1, x2, y2);
  for (const stop of gradient.stops) fill.addColorStop(stop.offset, monochrome ? '#000000' : displayGradientColor(stop.color));
  return fill;
}
