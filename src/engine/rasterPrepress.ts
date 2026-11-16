import { isDesktop } from '../desktop';

type RasterMode = 'split' | 'paper';
type RasterTile = { rgb: Uint8Array; alpha?: Uint8Array };

export const ICC_TILE_PIXELS = 262144;

export async function prepareRasterTile(rgba: Uint8Array | Uint8ClampedArray, mode: RasterMode): Promise<RasterTile> {
  if (rgba.length % 4) throw new Error('Invalid RGBA raster tile.');
  const count = rgba.length / 4;
  const rgbLength = count * 3;
  if (isDesktop() && count > 0 && count <= ICC_TILE_PIXELS) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // A compact copy keeps a tile backed by a larger image from crossing IPC in full.
      const result = await invoke<ArrayBuffer>('desktop_prepare_raster_tile', new Uint8Array(rgba), {
        headers: { 'x-recto-raster-mode': mode },
      });
      if (result instanceof ArrayBuffer) {
        if (result.byteLength === rgbLength) return { rgb: new Uint8Array(result) };
        if (mode === 'split' && result.byteLength === rgba.length) {
          return { rgb: new Uint8Array(result, 0, rgbLength), alpha: new Uint8Array(result, rgbLength) };
        }
      }
    } catch {
      // Older desktop builds continue through the local implementation.
    }
  }

  const rgb = new Uint8Array(rgbLength);
  let alpha: Uint8Array | undefined;
  for (let pixel = 0, from = 0, to = 0; pixel < count; pixel++, from += 4, to += 3) {
    const opacity = rgba[from + 3];
    if (mode === 'paper') {
      for (let channel = 0; channel < 3; channel++) {
        rgb[to + channel] = Math.round(255 + (rgba[from + channel] - 255) * opacity / 255);
      }
    } else {
      rgb[to] = rgba[from]; rgb[to + 1] = rgba[from + 1]; rgb[to + 2] = rgba[from + 2];
      if (opacity !== 255) {
        alpha ??= new Uint8Array(count).fill(255);
        alpha[pixel] = opacity;
      }
    }
  }
  return { rgb, alpha };
}
