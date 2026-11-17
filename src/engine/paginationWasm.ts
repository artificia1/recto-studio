import type { NoteContinuation, NoteLine } from './footnoteFlow';
import { getRasterWasm } from './rasterWasm';

export function nativeTableRows(start: number, end: number, frame: number, used: number, footer: number,
  padding: number, leading: number, consumed: number, split: boolean,
  read: (index: number) => { height: number; minimum: number; lines: number; groupEnd: number }) {
  const engine = getRasterWasm();
  const run = engine?.layout_table_rows;
  const count = end - start;
  if (!engine || !run || count < 0 || count > 8192 || leading <= 0 ||
      ![frame, used, footer, padding, leading, consumed].every(Number.isFinite)) return undefined;
  const rows = Array.from({ length: count }, (_, index) => read(start + index));
  const input = new DataView(engine.memory.buffer, engine.raster_input(), count * 24);
  for (const [index, row] of rows.entries()) {
    if (!Number.isFinite(row.height) || !Number.isFinite(row.minimum) || row.groupEnd > end ||
        !Number.isSafeInteger(row.lines) || row.lines < 0 || row.lines > 0xffffffff) return undefined;
    const offset = index * 24;
    input.setFloat64(offset, row.height, true);
    input.setFloat64(offset + 8, row.minimum, true);
    input.setUint32(offset + 16, row.lines, true);
    input.setUint32(offset + 20, row.groupEnd - start, true);
  }
  const written = run(count, frame, used, footer, padding, leading, consumed, split);
  if (written < 0 || written > count) return undefined;
  const output = new DataView(engine.memory.buffer, engine.raster_output(), written * 16);
  return Array.from({ length: written }, (_, i) => ({
    index: start + output.getUint32(i * 16, true),
    lines: output.getUint32(i * 16 + 4, true), height: output.getFloat64(i * 16 + 8, true),
  }));
}

export function nativeFootnotes(anchors: NoteContinuation[][], carry: NoteContinuation[], capacity: number,
  step: number, lineHeight: number, continuationLabel: (item: NoteContinuation) => string[]) {
  const engine = getRasterWasm();
  const run = engine?.layout_note_columns;
  if (!engine || !run || !Number.isInteger(capacity) || capacity < 0 || capacity > 65_535 || anchors.length > 128) return undefined;
  const notes = [
    ...carry.map(item => ({ item, anchor: 0xffffffff })),
    ...anchors.flatMap((items, anchor) => items.map(item => ({ item, anchor }))),
  ];
  if (notes.length > 4096) return undefined;
  const labels = notes.map(({ item }) => continuationLabel(item));
  const input = new DataView(engine.memory.buffer, engine.raster_input(), notes.length * 16);
  for (const [i, { item, anchor }] of notes.entries()) {
    input.setUint32(i * 16, item.rows.length, true);
    input.setUint32(i * 16 + 4, labels[i].length, true);
    input.setUint32(i * 16 + 8, anchor, true);
    input.setUint8(i * 16 + 12, Number(item.started));
  }
  const size = run(notes.length, anchors.length, capacity);
  if (size < 16 || size > engine.raster_capacity()) return undefined;
  const output = new DataView(engine.memory.buffer, engine.raster_output(), size);
  const lines: NoteLine[] = [];
  let offset = 16;
  const pieces = output.getUint32(0, true), remainder = output.getUint32(4, true);
  for (let i = 0; i < pieces; i++, offset += 24) {
    const index = output.getUint32(offset, true), column = output.getUint32(offset + 4, true);
    let row = output.getUint32(offset + 8, true);
    const start = output.getUint32(offset + 12, true), count = output.getUint32(offset + 16, true);
    const label = output.getUint32(offset + 20, true);
    const item = notes[index].item;
    for (const text of [...labels[index].slice(0, label), ...item.rows.slice(start, start + count)]) {
      lines.push({ text, noteId: item.note.id, column, x: column * step, y: row++ * lineHeight });
    }
  }
  const pending: NoteContinuation[] = [];
  for (let i = 0; i < remainder; i++, offset += 8) {
    const item = notes[output.getUint32(offset, true)].item;
    const start = output.getUint32(offset + 4, true);
    pending.push(start ? { ...item, rows: item.rows.slice(start), started: true } : item);
  }
  return { lines, carry: pending, maxRows: output.getUint32(8, true), unplacedAnchors: output.getUint32(12, true) };
}
