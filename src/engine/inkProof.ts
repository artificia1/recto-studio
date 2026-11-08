import type { ColorManagementSettings } from '../types';
import { convertIcc } from './colorService';
import { profileBytes } from './iccProfiles';

/** Separate the composed sRGB artwork. This cannot recover source CMYK or RIP overprints. */
export async function separateProof(rgba: Uint8ClampedArray, settings?: ColorManagementSettings): Promise<Uint8Array> {
  if (rgba.length % 4) throw new Error('Invalid proof pixel data.');
  const count = rgba.length / 4;
  if (count > 2_000_000) throw new Error('Proof sampling exceeds two million pixels.');
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(255 + (rgba[i * 4 + c] - 255) * rgba[i * 4 + 3] / 255);
  if (settings) return convertIcc({ profile: profileBytes(settings.outputProfile), pixels: rgb, direction: 'rgb-to-cmyk',
    intent: settings.intent, blackPointCompensation: settings.blackPointCompensation, preservePureBlack: settings.preservePureBlack });
  const result = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const max = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    for (let c = 0; c < 3; c++) result[i * 4 + c] = max ? Math.round((max - rgb[i * 3 + c]) / max * 255) : 0;
    result[i * 4 + 3] = 255 - max;
  }
  return result;
}

export function displayProof(cmyk: Uint8Array, plates: boolean[], limit: number, heatmap: boolean) {
  if (cmyk.length % 4 || plates.length !== 4 || !Number.isFinite(limit) || limit < 100 || limit > 400) throw new Error('Invalid ink proof settings.');
  const rgba = new Uint8ClampedArray(cmyk.length);
  let maximum = 0, exceeded = 0;
  for (let i = 0; i < cmyk.length; i += 4) {
    const tac = (cmyk[i] + cmyk[i + 1] + cmyk[i + 2] + cmyk[i + 3]) / 255 * 100;
    maximum = Math.max(maximum, tac); if (tac > limit) exceeded++;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(255 * (1 - (plates[c] ? cmyk[i + c] / 255 : 0)) * (1 - (plates[3] ? cmyk[i + 3] / 255 : 0)));
    if (heatmap && tac > limit) { rgba[i] = 255; rgba[i + 1] = Math.max(0, 90 - (tac - limit)); rgba[i + 2] = 100; }
    rgba[i + 3] = 255;
  }
  return { rgba, maximum, exceeded };
}
