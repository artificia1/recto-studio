interface RasterExports {
  memory: WebAssembly.Memory;
  raster_capacity(): number;
  raster_input(): number;
  raster_output(): number;
  raster_table(): number;
  raster_run(mode: number, length: number, grayscale: number): number;
}

let initialized: Promise<RasterExports | undefined> | undefined;

function loadRasterWasm() {
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
    return engine;
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
