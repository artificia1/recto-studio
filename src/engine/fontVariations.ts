export interface FontAxis { name: string; min: number; default: number; max: number }
export type FontVariations = Record<string, number>;

export function normalizeVariations(axes: Partial<Record<string, FontAxis>>, requested: FontVariations): FontVariations {
  const result: FontVariations = {};
  for (const tag of Object.keys(requested).sort()) {
    const axis = axes[tag], value = requested[tag];
    if (!/^[A-Za-z0-9]{4}$/.test(tag) || !Object.hasOwn(axes, tag) || !axis || !Number.isFinite(value) || value < axis.min || value > axis.max) throw new Error(`Invalid value for variable-font axis ${tag}.`);
    result[tag] = value;
  }
  return result;
}

export function variationCss(variations?: FontVariations): string {
  return Object.entries(variations || {}).sort(([a], [b]) => a.localeCompare(b)).map(([tag, value]) => {
    if (!/^[A-Za-z0-9]{4}$/.test(tag) || !Number.isFinite(value)) throw new Error('Invalid font variation settings.');
    return `"${tag}" ${value}`;
  }).join(', ') || 'normal';
}
