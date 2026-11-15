import { afterEach, expect, it, vi } from 'vitest';
import { probeDesktopRaster } from '../src/desktop';
import { decodeSrgbRaster, rasterDimensions } from '../src/engine/rasterPixels';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

it('sends a bounded header and handles a native CMYK result before decoding', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  invoke.mockResolvedValue({ width: 3, height: 2, cmyk: true });
  const bytes = new Uint8Array(100_000);
  bytes.set([0xff, 0xd8]);
  await expect(probeDesktopRaster(bytes, 'image/jpeg')).resolves.toEqual({ width: 3, height: 2, cmyk: true });
  const [command, header, options] = invoke.mock.calls[0];
  expect(command).toBe('desktop_probe_raster');
  expect(header.buffer.byteLength).toBe(16 * 1024);
  expect(options.headers['x-recto-raster-type']).toBe('image/jpeg');
  await expect(decodeSrgbRaster(`data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`)).rejects.toThrow(/known source profile/);
});

it('keeps the same pixel limit when the command is unavailable or outside the desktop', async () => {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(10_000, 16);
  bytes.writeUInt32BE(5_000, 20);
  const source = `data:image/png;base64,${bytes.toString('base64')}`;
  await expect(decodeSrgbRaster(source)).rejects.toThrow(/40 megapixels/);
  expect(invoke).not.toHaveBeenCalled();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  invoke.mockRejectedValue(new Error('Unknown command'));
  await expect(decodeSrgbRaster(source)).rejects.toThrow(/40 megapixels/);
  expect(invoke).toHaveBeenCalledOnce();
});

it('reports a truncated JPEG before the decoder runs', () => {
  expect(() => rasterDimensions(new Uint8Array([255, 216, 255, 255, 255, 255, 255]), 'image/jpeg')).toThrow('Truncated JPEG segment.');
});
