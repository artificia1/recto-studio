import type { Font, GlyphPosition, GlyphRun } from 'fontkit';

export type PositionedFontRun = Pick<GlyphRun, 'glyphs' | 'positions' | 'advanceWidth'> & { logical?: string[] };

interface Shaper {
  memory: WebAssembly.Memory;
  font_ptr(): number;
  shape_input(): number;
  shape_output(): number;
  shape_run(fontLength: number, textLength: number, axisCount: number): number;
}

interface Source { bytes: Uint8Array; axes: [string, number][] }
const sources = new WeakMap<Font, Source>();
const encoder = new TextEncoder(), decoder = new TextDecoder();
let loading: Promise<Shaper | undefined> | undefined;
let engine: Shaper | undefined, resident: Source | undefined;

function loadShaper() {
  loading ??= (async () => {
    const url = new URL('../wasm/font-shaping.wasm?no-inline', import.meta.url);
    let bytes: Uint8Array<ArrayBuffer> | ArrayBuffer;
    if (url.protocol === 'file:') {
      const { readFile } = await import('node:fs/promises');
      bytes = new Uint8Array(await readFile(url));
    } else {
      const response = await fetch(url);
      if (!response.ok) return undefined;
      bytes = await response.arrayBuffer();
    }
    const { instance } = await WebAssembly.instantiate(bytes);
    return engine = instance.exports as unknown as Shaper;
  })().catch(() => undefined);
  return loading;
}

export async function registerShapingFont(font: Font, bytes: Uint8Array, variations?: Record<string, number>) {
  // Fontkit still handles compressed font containers and fonts beyond the scratch limit.
  if (bytes.length < 12 || bytes.length > 4 * 1024 * 1024) return;
  const format = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  if (format !== 0x00010000 && format !== 0x4f54544f && format !== 0x74727565) return;
  const axes = Object.entries(variations ?? {});
  if (axes.length > 32 || axes.some(([tag, value]) => !/^[ -~]{4}$/.test(tag) || !Number.isFinite(value))) return;
  if (await loadShaper()) sources.set(font, { bytes, axes });
}

function shapeRecords(font: Font, text: string) {
  const source = sources.get(font);
  if (!engine || !source || !text || text.length > 16 * 1024) return undefined;
  const bytes = encoder.encode(text);
  if (bytes.length > 16 * 1024) return undefined;
  try {
    if (resident !== source) {
      new Uint8Array(engine.memory.buffer, engine.font_ptr(), source.bytes.length).set(source.bytes);
      resident = source;
    }
    const start = engine.shape_input();
    new Uint8Array(engine.memory.buffer, start, bytes.length).set(bytes);
    const axisData = new DataView(engine.memory.buffer, start + bytes.length, source.axes.length * 8);
    for (const [index, [tag, value]] of source.axes.entries()) {
      for (let byte = 0; byte < 4; byte++) axisData.setUint8(index * 8 + byte, tag.charCodeAt(byte));
      axisData.setFloat32(index * 8 + 4, value, true);
    }
    const count = engine.shape_run(source.bytes.length, bytes.length, source.axes.length);
    if (count <= 0 || count > 32 * 1024) return undefined;
    const records = new DataView(engine.memory.buffer, engine.shape_output(), count * 24);
    return { records, count, bytes };
  } catch {
    return undefined;
  }
}

export function measureRegisteredFont(font: Font, text: string) {
  const shaped = shapeRecords(font, text);
  if (!shaped) return undefined;
  let width = 0;
  for (let i = 0; i < shaped.count; i++) width += shaped.records.getInt32(i * 24 + 8, true);
  return width;
}

export function shapeRegisteredFont(font: Font, text: string): PositionedFontRun | undefined {
  const shaped = shapeRecords(font, text);
  if (!shaped) return undefined;
  const { records, count, bytes } = shaped;
  try {
    const clusters = new Set<number>();
    for (let i = 0; i < count; i++) clusters.add(records.getUint32(i * 24 + 4, true));
    const ordered = [...clusters].sort((a, b) => a - b);
    const ends = new Map(ordered.map((value, index) => [value, ordered[index + 1] ?? bytes.length]));
    const glyphs: GlyphRun['glyphs'] = [], positions: GlyphPosition[] = [], logical: string[] = [];
    let advanceWidth = 0;
    for (let i = 0; i < count; i++) {
      const offset = i * 24, cluster = records.getUint32(offset + 4, true);
      const end = ends.get(cluster);
      logical.push(end === undefined ? '' : decoder.decode(bytes.subarray(cluster, end)));
      ends.delete(cluster);
      const position = { xAdvance: records.getInt32(offset + 8, true), yAdvance: records.getInt32(offset + 12, true),
        xOffset: records.getInt32(offset + 16, true), yOffset: records.getInt32(offset + 20, true) };
      positions.push(position);
      advanceWidth += position.xAdvance;
      glyphs.push(font.getGlyph(records.getUint32(offset, true)));
    }
    return { glyphs, positions, advanceWidth, logical };
  } catch {
    return undefined;
  }
}
