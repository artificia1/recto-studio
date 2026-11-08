export type Cmyk = [number, number, number, number];

export function explicitCmyk(value: string): Cmyk | null {
  const match = /^cmyk\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)$/i.exec(value.trim());
  if (!match) return null;
  const channels = match.slice(1).map(Number);
  return channels.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 100) ? channels as Cmyk : null;
}

/** Restricted deterministic CSS parsing shared with headless production output. */
export function rgbColor(value: string): [number, number, number] | null {
  const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
    lime: '#00ff00', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
    gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080', teal: '#008080', purple: '#800080',
    maroon: '#800000', olive: '#808000', orange: '#ffa500' };
  const color = named[value.trim().toLowerCase()] || value.trim();
  if (/^#[a-f\d]{3}$/i.test(color)) return color.slice(1).split('').map(channel => parseInt(channel + channel, 16)) as [number, number, number];
  if (/^#[a-f\d]{6}$/i.test(color)) return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
  const match = /^rgb\(\s*([\d.]+)(%)?\s*[, ]\s*([\d.]+)(%)?\s*[, ]\s*([\d.]+)(%)?\s*\)$/i.exec(color);
  if (!match) return null;
  const values = [1, 3, 5].map(index => Number(match[index]) * (match[index + 1] ? 2.55 : 1));
  return values.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255.0001) ? values.map(channel => Math.round(channel)) as [number, number, number] : null;
}

export function cmykDisplayColor(channels: Cmyk): string {
  const k = 1 - channels[3] / 100;
  return `rgb(${channels.slice(0, 3).map(channel => Math.round(255 * (1 - channel / 100) * k)).join(',')})`;
}
