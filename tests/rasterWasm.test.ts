import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { applyImageAdjustments } from '../src/engine/imageAdjustments';
import { mutateWasmRaster, prepareWasmRaster } from '../src/engine/rasterWasm';

const tileSize = 1024 * 1024;

it('packs opaque and transparent tiles, including the last partial tile', async () => {
  const pixels = new Uint8Array(tileSize + 8).fill(255);
  pixels.set([0, 80, 255, 128, 30, 40, 50, 0], tileSize);
  const split = (await prepareWasmRaster(pixels, false))!;
  expect(split.rgb).toHaveLength(pixels.length / 4 * 3);
  expect(split.rgb.slice(-6)).toEqual(Uint8Array.of(0, 80, 255, 30, 40, 50));
  expect(split.alpha).toHaveLength(pixels.length / 4);
  expect(split.alpha?.slice(-4)).toEqual(Uint8Array.of(255, 255, 128, 0));
  const paper = (await prepareWasmRaster(pixels, true))!;
  expect(paper.alpha).toBeUndefined();
  expect(paper.rgb.slice(-6)).toEqual(Uint8Array.of(127, 167, 255, 255, 255, 255));
  expect((await prepareWasmRaster(pixels.subarray(0, 4), false))?.alpha).toBeUndefined();
});

it('matches the TypeScript grayscale curve across multiple tiles and preserves alpha', async () => {
  const pixels = Uint8Array.from({ length: tileSize + 32 }, (_, index) => (index * 223 + (index >>> 8)) & 255);
  const settings = { black: 11, white: 239, gamma: 1.45, curve: [{ input: 91, output: 100 }] };
  const ramp = Uint8Array.from({ length: 1024 }, (_, index) => index >>> 2);
  applyImageAdjustments(ramp, settings);
  const table = Uint8Array.from({ length: 256 }, (_, index) => ramp[index * 4]);
  const expected = pixels.slice();
  applyImageAdjustments(expected, { ...settings, grayscale: true });
  expect(await mutateWasmRaster(pixels, table, true)).toBe(pixels.length);
  expect(Buffer.compare(Buffer.from(pixels), Buffer.from(expected))).toBe(0);
});

it('restores straight alpha and caps the module memory at 3 MiB', async () => {
  const pixels = Uint8Array.of(16, 32, 64, 128, 0, 0, 0, 0, 10, 20, 40, 255);
  expect(await mutateWasmRaster(pixels)).toBe(pixels.length);
  expect(pixels).toEqual(Uint8Array.of(32, 64, 128, 128, 0, 0, 0, 0, 10, 20, 40, 255));
  const path = new URL('../src/wasm/raster-kernels.wasm', import.meta.url);
  const { instance } = await WebAssembly.instantiate(new Uint8Array(await readFile(path)));
  const memory = instance.exports.memory as WebAssembly.Memory;
  expect(memory.buffer.byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
  expect(() => memory.grow(49)).toThrow(RangeError);
});
