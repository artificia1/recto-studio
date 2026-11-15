import { afterEach, expect, it, vi } from 'vitest';
import { adjustDesktopRaster } from '../src/desktop';
import { adjustedRasterSource, applyImageAdjustments, neutralAdjustments } from '../src/engine/imageAdjustments';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../src/engine/rasterPixels', () => ({
  decodeSrgbRaster: async () => ({ width: 2, height: 1, data: new Uint8Array([20, 120, 240, 255, 11, 22, 33, 73]) }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

it('uses the same levels and curve for desktop and browser export', async () => {
  const settings = { ...neutralAdjustments, grayscale: true, black: 8, gamma: 1.2,
    curve: [{ input: 128, output: 146 }] };
  const fromBrowser = await adjustedRasterSource('test', settings);
  expect(invoke).not.toHaveBeenCalled();

  const expected = new Uint8Array([20, 120, 240, 255, 11, 22, 33, 73]);
  applyImageAdjustments(expected, settings);
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  invoke.mockResolvedValue(expected.buffer);

  await expect(adjustedRasterSource('test', settings)).resolves.toBe(fromBrowser);
  expect(invoke).toHaveBeenCalledOnce();
  const [command, packet] = invoke.mock.calls[0];
  expect(command).toBe('desktop_adjust_raster');
  expect(packet[0]).toBe(1);
  expect(packet.byteLength).toBe(265);
  expect(packet.subarray(257)).toEqual(new Uint8Array([20, 120, 240, 255, 11, 22, 33, 73]));
  expect(packet[1 + 107]).toBe(expected[0]);
});

it('keeps large rasters local and handles invalid replies without changing the pixels', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const table = new Uint8Array(256);
  await expect(adjustDesktopRaster(new Uint8Array(1024 * 1024 + 4), table, false)).resolves.toBe(false);
  expect(invoke).not.toHaveBeenCalled();

  const image = new Uint8Array([10, 20, 30, 73]);
  invoke.mockResolvedValueOnce(new ArrayBuffer(3));
  await expect(adjustDesktopRaster(image, table, false)).resolves.toBe(false);
  expect([...image]).toEqual([10, 20, 30, 73]);

  invoke.mockRejectedValue(new Error('Unknown command'));
  const fallback = await adjustedRasterSource('test', neutralAdjustments);
  vi.unstubAllGlobals();
  await expect(adjustedRasterSource('test', neutralAdjustments)).resolves.toBe(fallback);
});
