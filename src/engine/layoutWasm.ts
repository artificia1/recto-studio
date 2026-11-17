import type { KnuthItem } from './knuthPlass';
import type { WrapObstacle } from './wrapGeometry';
import type { StoryRun } from '../types';
import type { RunStyle, StoryMeasure } from './storyLayout';
import { getRasterWasm, loadRasterWasm } from './rasterWasm';
import { nativeFootnotes, nativeTableRows } from './paginationWasm';
import { measureRegisteredFont, registerShapingFont, shapeRegisteredFont } from './fontShapingWasm';

export async function loadLayoutKernels() {
  const engine = await loadRasterWasm();
  if (!engine?.layout_optimal_breaks) return undefined;
  return { optimalBreaks: nativeOptimalBreaks, storyLines: nativeStoryLines, place: nativePlacement,
    tableRows: nativeTableRows, footnotes: nativeFootnotes, shapeFont: shapeRegisteredFont,
    measureFont: measureRegisteredFont, registerFont: registerShapingFont };
}

function nativePlacement(obstacles: WrapObstacle[], x: number, frameY: number, padding: number, bottom: number,
  width: number, gutter: number, columns: number) {
  const engine = getRasterWasm();
  const place = engine?.layout_place_line;
  const frame = [x, frameY, padding, bottom, width, gutter, columns];
  if (!engine || !place || !frame.every(Number.isFinite)) return undefined;
  const header = 96;
  let length = header;
  for (const { polygons } of obstacles) for (const { points } of polygons) {
    length += 32 + points.length * 16;
    // Prevent a pathological image silhouette from dominating each layout probe.
    if (length > 128 * 1024) return undefined;
  }
  const bytes = new Uint8Array(length);
  const data = new DataView(bytes.buffer);
  frame.forEach((value, index) => data.setFloat64(16 + index * 8, value, true));
  let offset = header;
  for (const { polygons, gap } of obstacles) for (const { points, closed, minY, maxY } of polygons) {
    if (![gap, minY, maxY].every(Number.isFinite)) return undefined;
    data.setUint32(offset, points.length, true);
    data.setUint8(offset + 4, Number(closed));
    data.setFloat64(offset + 8, gap, true);
    data.setFloat64(offset + 16, minY, true);
    data.setFloat64(offset + 24, maxY, true);
    offset += 32;
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
      data.setFloat64(offset, point.x, true);
      data.setFloat64(offset + 8, point.y, true);
      offset += 16;
    }
  }
  return (column: number, y: number, height: number, start: number, pitch: number) => {
    if (!Number.isFinite(y + height + start + pitch)) return undefined;
    data.setFloat64(0, column, true);
    data.setFloat64(8, y, true);
    data.setFloat64(72, height, true);
    data.setFloat64(80, start, true);
    data.setFloat64(88, pitch, true);
    new Uint8Array(engine.memory.buffer, engine.raster_input(), length).set(bytes);
    const status = place(length);
    if (status < 0) return undefined;
    const output = new DataView(engine.memory.buffer, engine.raster_output(), 32);
    return { column: output.getFloat64(0, true), y: output.getFloat64(8, true),
      inset: output.getFloat64(16, true), width: output.getFloat64(24, true), fits: status === 1 };
  };
}

export function nativeOptimalBreaks(items: KnuthItem[], lineWidths: number | number[], tolerance: number, hyphenCost: number) {
  const engine = getRasterWasm();
  if (!engine?.layout_optimal_breaks || items.length > 2048) return undefined;
  const widths = Array.isArray(lineWidths) ? lineWidths : [lineWidths];
  if (!widths.length || widths.length > 2048 || !widths.every(Number.isFinite)
      || !Number.isFinite(tolerance) || !Number.isFinite(hyphenCost)) return undefined;
  const input = new DataView(engine.memory.buffer, engine.raster_input());
  for (const [i, item] of items.entries()) {
    const offset = i * 40;
    const stretch = item.type === 'glue' ? item.stretch : 0;
    const shrink = item.type === 'glue' ? item.shrink : 0;
    const penalty = item.type === 'penalty' ? item.penalty : 0;
    if (![item.width, stretch, shrink, penalty].every(Number.isFinite)) return undefined;
    input.setUint8(offset, item.type === 'box' ? 0 : item.type === 'glue' ? 1 : 2);
    input.setUint8(offset + 1, Number(item.type === 'penalty' && item.flagged));
    input.setFloat64(offset + 8, item.width, true);
    input.setFloat64(offset + 16, stretch, true);
    input.setFloat64(offset + 24, shrink, true);
    input.setFloat64(offset + 32, penalty, true);
  }
  widths.forEach((width, i) => input.setFloat64(items.length * 40 + i * 8, width || widths[0], true));
  let count: number;
  try {
    count = engine.layout_optimal_breaks(items.length, widths.length, tolerance, hyphenCost);
  } catch {
    // A trapped invocation must leave editing available through the JS solver.
    return undefined;
  }
  if (count === -1) return null;
  if (count < 0 || count > items.length) return undefined;
  const output = new DataView(engine.memory.buffer, engine.raster_output(), count * 16);
  return Array.from({ length: count }, (_, i) => ({
    itemIndex: output.getUint32(i * 16, true), ratio: output.getFloat64(i * 16 + 8, true),
  }));
}

function nativeStoryLines(runs: StoryRun[], resolve: (run: StoryRun) => RunStyle, measure: StoryMeasure,
  x: number, width: number, gutter: number, column: number, columns: number,
  y: number, padding: number, bottom: number, height: number) {
  const engine = getRasterWasm();
  if (!engine?.layout_story_lines || !Number.isInteger(columns) || columns > 128 || column >= columns) return undefined;
  const widths = Array.from({ length: columns - column }, (_, index) => {
    const left = x + padding + (index + column) * (width + gutter);
    return left + width - left;
  });
  if (!widths.every(value => Number.isFinite(value) && value > 1)) return undefined;
  const tokens: { text: string; width: number; style: RunStyle }[] = [];
  let length = 0;
  for (const run of runs) {
    length += run.text.length;
    if (length > 8192) return undefined;
    const style = resolve(run);
    let rendered = run.text;
    if (run.noteId) {
      style.fontSizePt *= 0.7;
      const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
      rendered = rendered.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => String(digits.indexOf(digit)));
    }
    for (const text of rendered.match(/[^\S\n]+|\n|[^\s]+/gu) || []) {
      tokens.push({ text, width: 0, style });
    }
  }
  if (tokens.length < 16 || tokens.length > 4096) return undefined;
  // Finish callbacks before acquiring shared scratch memory.
  for (const token of tokens) {
    const { text, style } = token;
    if (text === '\n') continue;
    token.width = measure(text, style) + Array.from(text).length * style.letterSpacingPt * (25.4 / 72);
    if (!Number.isFinite(token.width) || token.width < 0) return undefined;
  }
  const input = new DataView(engine.memory.buffer, engine.raster_input());
  for (const [i, token] of tokens.entries()) {
    input.setFloat64(i * 16, token.width, true);
    input.setUint8(i * 16 + 8, token.text === '\n' ? 2 : Number(/^\s+$/u.test(token.text)));
  }
  widths.forEach((value, i) => input.setFloat64(tokens.length * 16 + i * 8, value, true));
  const count = engine.layout_story_lines(tokens.length, widths.length, y, padding, bottom, height);
  if (count < 0 || count > tokens.length) return undefined;
  const output = new DataView(engine.memory.buffer, engine.raster_output(), count * 4);
  return { tokens, starts: Array.from({ length: count }, (_, i) => output.getUint32(i * 4, true)) };
}
