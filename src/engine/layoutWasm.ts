import type { KnuthItem } from './knuthPlass';
import { getRasterWasm, loadRasterWasm } from './rasterWasm';

export async function loadLayoutKernels() {
  const engine = await loadRasterWasm();
  if (!engine?.layout_optimal_breaks || !engine.layout_uniform_lines) return undefined;
  return { optimalBreaks: nativeOptimalBreaks, uniformLines: nativeUniformLines };
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

function nativeUniformLines(text: string, measure: (text: string) => number, widths: number[],
  y: number, padding: number, bottom: number, height: number) {
  const engine = getRasterWasm();
  if (!engine?.layout_uniform_lines || text.length > 8192 || text.includes('\n') || !widths.length || widths.length > 128 ||
      !widths.every(width => Number.isFinite(width) && width > 1)) return undefined;
  const words = text.match(/[^\S\n]+|[^\s]+/gu) || [];
  if (words.length < 16 || words.length > 4096) return undefined;
  const advances = words.map(measure);
  const input = new DataView(engine.memory.buffer, engine.raster_input());
  for (let i = 0; i < words.length; i++) {
    const advance = advances[i];
    if (!Number.isFinite(advance) || advance < 0) return undefined;
    input.setFloat64(i * 16, advance, true);
    input.setUint8(i * 16 + 8, Number(/^\s+$/u.test(words[i])));
  }
  widths.forEach((width, i) => input.setFloat64(words.length * 16 + i * 8, width, true));
  const count = engine.layout_uniform_lines(words.length, widths.length, y, padding, bottom, height);
  if (count < 0 || count > words.length) return undefined;
  const output = new DataView(engine.memory.buffer, engine.raster_output(), count * 4);
  return { words, advances, starts: Array.from({ length: count }, (_, i) => output.getUint32(i * 4, true)) };
}
