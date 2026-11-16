import { afterEach, expect, it, vi } from 'vitest';
import { ICC_TILE_PIXELS, prepareRasterTile } from '../src/engine/rasterPrepress';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

it('preserves straight color and emits an alpha plane only when needed', async () => {
  await expect(prepareRasterTile(Uint8Array.of(1, 2, 3, 255), 'split')).resolves.toMatchObject({ rgb: Uint8Array.of(1, 2, 3) });
  const mixed = await prepareRasterTile(Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 0), 'split');
  expect(mixed).toEqual({ rgb: Uint8Array.of(1, 2, 3, 4, 5, 6), alpha: Uint8Array.of(255, 0) });
  const opaque = await prepareRasterTile(Uint8Array.of(1, 2, 3, 255), 'split');
  expect(opaque.alpha).toBeUndefined();
  expect(invoke).not.toHaveBeenCalled();
});

it('routes only a compact tile over IPC and decodes both returned planes', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  invoke.mockResolvedValue(Uint8Array.of(13, 23, 33, 44).buffer);
  const source = Uint8Array.of(0, 0, 0, 0, 10, 20, 30, 40).subarray(4);
  await expect(prepareRasterTile(source, 'split')).resolves.toEqual({ rgb: Uint8Array.of(13, 23, 33), alpha: Uint8Array.of(44) });
  const [command, bytes, options] = invoke.mock.calls[0];
  expect(command).toBe('desktop_prepare_raster_tile');
  expect(bytes.buffer.byteLength).toBe(4);
  expect(bytes).toEqual(source);
  expect(options.headers['x-recto-raster-mode']).toBe('split');
});

it('composites paper tiles locally when IPC is missing, malformed, or too large', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const rgba = Uint8ClampedArray.of(0, 80, 255, 128);
  invoke.mockRejectedValueOnce(new Error('Missing command')).mockResolvedValueOnce(new ArrayBuffer(4));
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(prepareRasterTile(rgba, 'paper')).resolves.toMatchObject({ rgb: Uint8Array.of(127, 167, 255) });
  }
  const oversized = await prepareRasterTile(new Uint8Array((ICC_TILE_PIXELS + 1) * 4), 'paper');
  expect(oversized.rgb).toHaveLength((ICC_TILE_PIXELS + 1) * 3);
  expect(oversized.rgb.at(-1)).toBe(255);
  expect(invoke).toHaveBeenCalledTimes(2);
  await expect(prepareRasterTile(Uint8Array.of(1, 2, 3), 'split')).rejects.toThrow('Invalid RGBA raster tile.');
});
