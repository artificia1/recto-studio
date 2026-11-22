import type { ImageAdjustments } from '../types';

export const neutralAdjustments: ImageAdjustments = { black: 0, white: 255, gamma: 1, curve: [] };

export function applyImageAdjustments(data: Uint8Array | Uint8ClampedArray, settings: ImageAdjustments) {
  applyLookup(data, adjustmentLookup(settings), !!settings.grayscale);
}

export function adjustmentLookup(settings: ImageAdjustments) {
  const points = [{ input: 0, output: 0 }, ...settings.curve, { input: 255, output: 255 }];
  const values = new Uint8Array(256);
  let segment = 0;
  for (let input = 0; input < 256; input++) {
    const normalized = Math.max(0, Math.min(1, (input - settings.black) / (settings.white - settings.black)));
    const level = 255 * Math.pow(normalized, 1 / settings.gamma);
    while (segment < points.length - 2 && level > points[segment + 1].input) segment++;
    const from = points[segment], to = points[segment + 1];
    values[input] = Math.round(from.output + (to.output - from.output) * (level - from.input) / (to.input - from.input));
  }
  return values;
}

export function applyLookup(data: Uint8Array | Uint8ClampedArray, values: Uint8Array, grayscale: boolean) {
  for (let offset = 0; offset < data.length; offset += 4) {
    if (grayscale) {
      const gray = values[Math.round(0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2])];
      data[offset] = data[offset + 1] = data[offset + 2] = gray;
    } else {
      data[offset] = values[data[offset]];
      data[offset + 1] = values[data[offset + 1]];
      data[offset + 2] = values[data[offset + 2]];
    }
  }
}
