interface RasterExports {
  memory: WebAssembly.Memory;
  raster_capacity(): number;
  raster_input(): number;
  raster_output(): number;
  raster_table(): number;
  raster_run(mode: number, length: number, grayscale: number): number;
  raster_mark_diff?(length: number): number;
  layout_optimal_breaks?(count: number, widths: number, tolerance: number, hyphenCost: number): number;
  layout_place_line?(length: number): number;
  layout_story_lines?(count: number, columns: number, y: number, padding: number, bottom: number, height: number): number;
  pdf_classic_xref?(count: number): number;
  pdf_classic_rows?(count: number, rangeLength: number): number;
  pdf_classic_footer?(offset: bigint): number;
  pdf_stream_xref?(count: number): number;
}

/** Mark corresponding RGBA tiles in place. Older packaged modules use the JS path. */
export async function markProofPixels(before: Uint8ClampedArray, after: Uint8ClampedArray) {
  if (before.length !== after.length || before.length % 4) throw new Error('Proof pixels must have matching RGBA dimensions.');
  const engine = before.length >= 64 * 1024 ? await loadRasterWasm() : undefined;
  let changed = 0;
  let offset = 0;
  if (engine?.raster_mark_diff) {
    const capacity = engine.raster_capacity();
    const memory = engine.memory.buffer;
    const input = new Uint8Array(memory, engine.raster_input(), capacity);
    const output = new Uint8Array(memory, engine.raster_output(), capacity);
    for (; offset < after.length;) {
      const end = Math.min(after.length, offset + capacity);
      input.set(before.subarray(offset, end));
      output.set(after.subarray(offset, end));
      let result;
      try { result = engine.raster_mark_diff(end - offset); } catch { break; }
      if (result < 0 || result > (end - offset) / 4) break;
      after.set(output.subarray(0, end - offset), offset);
      changed += result;
      offset = end;
    }
  }
  for (; offset < after.length; offset += 4) {
    if (Math.abs(before[offset] - after[offset]) <= 16 &&
        Math.abs(before[offset + 1] - after[offset + 1]) <= 16 &&
        Math.abs(before[offset + 2] - after[offset + 2]) <= 16) continue;
    after[offset] = 225;
    after[offset + 1] = 40;
    after[offset + 2] = 80;
    changed++;
  }
  return changed;
}

let initialized: Promise<RasterExports | undefined> | undefined;
let loaded: RasterExports | undefined;

export function getRasterWasm() { return loaded; }

export function loadRasterWasm() {
  initialized ??= (async () => {
    const url = new URL('../wasm/raster-kernels.wasm?no-inline', import.meta.url);
    let bytes: ArrayBuffer;
    if (url.protocol === 'file:') {
      const { readFile } = await import('node:fs/promises');
      bytes = new Uint8Array(await readFile(url)).buffer;
    } else {
      const response = await fetch(url);
      if (!response.ok) return undefined;
      bytes = await response.arrayBuffer();
    }
    const { instance } = await WebAssembly.instantiate(bytes);
    const engine = instance.exports as unknown as RasterExports;
    if (engine.raster_capacity() !== 1024 * 1024 || engine.memory.buffer.byteLength > 3 * 1024 * 1024) return undefined;
    return loaded = engine;
  })().catch(() => undefined);
  return initialized;
}

export async function prepareWasmRaster(rgba: Uint8Array | Uint8ClampedArray, paper: boolean) {
  const engine = await loadRasterWasm();
  if (!engine || !rgba.length || rgba.length % 4) return undefined;
  const capacity = engine.raster_capacity();
  const memory = engine.memory.buffer;
  const input = new Uint8Array(memory, engine.raster_input(), capacity);
  const output = new Uint8Array(memory, engine.raster_output(), capacity);
  const rgb = new Uint8Array(rgba.length / 4 * 3);
  let alpha: Uint8Array | undefined;
  // No awaits while a tile is in scratch memory. Other callers can safely reuse it.
  for (let start = 0; start < rgba.length; start += capacity) {
    const tile = rgba.subarray(start, start + capacity);
    const rgbLength = tile.length / 4 * 3;
    input.set(tile);
    const written = engine.raster_run(paper ? 1 : 0, tile.length, 0);
    if (written !== rgbLength && (paper || written !== tile.length)) return undefined;
    rgb.set(output.subarray(0, rgbLength), start / 4 * 3);
    if (written === tile.length) {
      alpha ??= new Uint8Array(rgba.length / 4).fill(255);
      alpha.set(output.subarray(rgbLength, written), start / 4);
    }
  }
  return { rgb, alpha };
}

/** Return how many bytes were written, so fallback code can continue at that offset. */
export async function mutateWasmRaster(rgba: Uint8Array, table?: Uint8Array, grayscale = false): Promise<number> {
  const engine = await loadRasterWasm();
  if (!engine || rgba.length % 4 || (table && table.length !== 256)) return 0;
  const capacity = engine.raster_capacity();
  const memory = engine.memory.buffer;
  const input = new Uint8Array(memory, engine.raster_input(), capacity);
  if (table) new Uint8Array(memory, engine.raster_table(), 256).set(table);
  let written = 0;
  for (; written < rgba.length;) {
    const tile = rgba.subarray(written, written + capacity);
    input.set(tile);
    try {
      if (engine.raster_run(table ? 2 : 3, tile.length, Number(grayscale)) !== tile.length) break;
    } catch { break; }
    tile.set(input.subarray(0, tile.length));
    written += tile.length;
  }
  return written;
}
