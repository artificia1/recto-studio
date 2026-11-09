import type { CanvasElement } from '../types';
import type { Cmyk } from './inkColors';
import { elementInkPaths, offsetInkPaths, polygonBoolean, inkAreaMm2, type InkPaths } from './prepressGeometry';

export interface ProcessTrap { afterElementId: string; paths: InkPaths; cmyk: Cmyk; lighterId: string; darkerId: string }
export function calculateProcessTraps(elements: CanvasElement[], colour: (css: string) => Cmyk, widthPt: number, tacLimit = 320) {
  if (!Number.isFinite(widthPt) || widthPt <= 0 || widthPt > 2) throw new Error('Choose a trap width above 0 and no greater than 2 pt.');
  const candidates = elements.filter(element => (element.type === 'shape' || element.type === 'path') && element.fillColor && !['none', 'transparent'].includes(element.fillColor) &&
    !(element.strokeWidthMm > 0 && element.strokeColor && !['none', 'transparent'].includes(element.strokeColor)) &&
    !element.spotColor && element.opacity === 1 && (!element.blendMode || element.blendMode === 'normal') && !element.shadow);
  if (candidates.length > 500) throw new Error('Automatic trapping is limited to 500 opaque filled objects per page.');
  const records = candidates.map(element => ({ element, paths: elementInkPaths(element), cmyk: colour((element as { fillColor: string }).fillColor) })).filter(record => record.paths.length);
  const lightness = (cmyk: Cmyk) => (1 - cmyk[3] / 100) * (0.2126 * (1 - cmyk[0] / 100) + 0.7152 * (1 - cmyk[1] / 100) + 0.0722 * (1 - cmyk[2] / 100));
  const traps: ProcessTrap[] = [], warnings = new Set<string>();
  if (elements.some(element => !candidates.includes(element))) warnings.add('Automatic traps cover unstroked, opaque process-colour fills only. Review other artwork with your printer.');
  for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
    const a = records[i], b = records[j]; if (Math.abs(lightness(a.cmyk) - lightness(b.cmyk)) < 0.01) continue;
    const [lighter, darker] = lightness(a.cmyk) > lightness(b.cmyk) ? [a, b] : [b, a];
    const lightVisible = lighter === a ? polygonBoolean(a.paths, b.paths, 'difference') : b.paths;
    const darkVisible = darker === a ? polygonBoolean(a.paths, b.paths, 'difference') : b.paths;
    const ring = polygonBoolean(offsetInkPaths(lightVisible, widthPt * 25.4 / 72), lightVisible, 'difference');
    let paths = polygonBoolean(ring, darkVisible, 'intersection');
    // Intervening artwork can hide the contact edge. Exclude uncertain areas
    // rather than painting a false-colour trap on top of unrelated artwork.
    const low = elements.indexOf(a.element), high = elements.indexOf(b.element);
    for (const blocker of elements.slice(low + 1, high)) {
      if (blocker.opacity === 0) continue;
      const geometry = elementInkPaths(blocker);
      const bounds = geometry.length ? geometry : elementInkPaths({ ...blocker, type: 'shape', shapeKind: 'rectangle', fillColor: '#000', strokeColor: 'transparent', strokeWidthMm: 0, strokeDash: 'solid' });
      paths = polygonBoolean(paths, bounds, 'difference');
    }
    if (inkAreaMm2(paths) < 0.000001) continue;
    const cmyk = lighter.cmyk.map((value, channel) => Math.max(value, darker.cmyk[channel])) as Cmyk;
    if (cmyk.reduce((sum, channel) => sum + channel, 0) > tacLimit) { warnings.add('A trap exceeds the ink coverage limit and was omitted. Review ink limits with your printer.'); continue; }
    traps.push({ afterElementId: b.element.id, paths, cmyk, lighterId: lighter.element.id, darkerId: darker.element.id });
  }
  return { traps, warnings: [...warnings] };
}
