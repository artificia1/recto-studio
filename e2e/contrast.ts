function relativeLuminance(color: string): number {
  const rgb = /^rgba?\(([^)]+)\)$/.exec(color);
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(color);
  const values = rgb?.[1] ?? srgb?.[1];
  if (!values) throw new Error(`Expected computed RGB color, received ${color}`);

  const channels = values.trim().split(/[,\s]+/, 3).map(channel => {
    const value = Number(channel) / (rgb ? 255 : 1);
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
