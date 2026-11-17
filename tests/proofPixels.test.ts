import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { markProofPixels, scanProofChanges } from '../src/engine/rasterWasm';

it('preserves proof marks and alpha across the fallback and Wasm tile boundaries', async () => {
  const smallBefore = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
  const smallAfter = new Uint8ClampedArray([16, 0, 0, 63, 0, 17, 0, 12]);
  expect(await markProofPixels(smallBefore, smallAfter)).toBe(1);
  expect([...smallAfter]).toEqual([16, 0, 0, 63, 225, 40, 80, 12]);

  const wasm = await readFile(new URL('../src/wasm/raster-kernels.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(new Uint8Array(wasm));
  expect(instance.exports.raster_mark_diff).toBeTypeOf('function');
  const boundary = 1024 * 1024;
  const before = new Uint8ClampedArray(boundary + 4);
  const after = before.slice();
  after.set([17, 0, 0, 41, 0, 0, 18, 129], boundary - 4);
  expect(await markProofPixels(before, after)).toBe(2);
  expect([...after.subarray(boundary - 4)]).toEqual([225, 40, 80, 41, 225, 40, 80, 129]);
  expect(before[boundary - 4]).toBe(0);
});

it('returns one exclusive bounding box for changed pixels on opposite sides of a Rust tile boundary', async () => {
  const width = 256;
  const boundary = 1024 * 1024;
  const before = new Uint8ClampedArray(boundary + width * 4);
  const after = before.slice();
  after[boundary - 4] = 17;
  after[boundary] = 18;
  expect(await scanProofChanges(before, after, width)).toEqual({
    changedPixels: 2, changedBounds: { left: 0, top: 1023, right: 256, bottom: 1025 },
  });
});
