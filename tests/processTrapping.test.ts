import { describe, expect, it } from 'vitest';
import { calculateProcessTraps } from '../src/engine/processTrapping';
import { elementInkPaths, offsetInkPaths, inkAreaMm2, inkCoordinates } from '../src/engine/prepressGeometry';
import { colorToCmyk } from '../src/export/pdfColors';
import type { ShapeElement } from '../src/types';
const rect = (id: string, x: number, fillColor: string, width = 10): ShapeElement => ({ id, pageId: 'page', type: 'shape', shapeKind: 'rectangle', x, y: 0, width, height: 10,
  rotation: 0, opacity: 1, locked: false, zIndex: 0, fillColor, strokeColor: 'transparent', strokeWidthMm: 0, strokeDash: 'solid' });
describe('process-colour trap geometry', () => {
  it('spreads exactly the physical trap width across a contact edge and combines ink channels', () => {
    const { traps } = calculateProcessTraps([rect('yellow', 0, 'cmyk(0,0,100,0)'), rect('cyan', 10, 'cmyk(100,0,0,0)')], colorToCmyk, 0.144);
    expect(traps).toHaveLength(1); expect(traps[0].cmyk).toEqual([100, 0, 100, 0]);
    expect(inkAreaMm2(traps[0].paths)).toBeCloseTo(10 * 0.144 * 25.4 / 72, 3);
    expect(traps[0].afterElementId).toBe('cyan');
  });
  it('traps the visible overlap boundary rather than the hidden outer edge', () => {
    const { traps } = calculateProcessTraps([rect('yellow', 0, '#ffff00', 20), rect('cyan', 10, '#00ffff')], colorToCmyk, 0.144);
    expect(traps).toHaveLength(1); const points = inkCoordinates(traps[0].paths).flat();
    expect(Math.min(...points.map(p => p.x))).toBeCloseTo(10);
    expect(Math.max(...points.map(p => p.x))).toBeLessThan(10.06);
  });
  it('supports negative choke offsets and rotated closed geometry', () => {
    const original = elementInkPaths(rect('square', 0, '#fff'));
    expect(inkAreaMm2(offsetInkPaths(original, -0.5))).toBeCloseTo(81, 4);
    expect(inkAreaMm2(elementInkPaths({ ...rect('rotated', 0, '#fff'), rotation: 45 }))).toBeCloseTo(100, 2);
    expect(() => offsetInkPaths(original, Number.NaN)).toThrow('offsets');
  });
  it('does not trap through intervening artwork or exceed ink limits', () => {
    const a = rect('yellow', 0, '#ffff00'), b = rect('cyan', 10, '#00ffff');
    const blocker = { ...rect('blocker', 9, '#000'), width: 2 };
    expect(calculateProcessTraps([a, blocker, b], colorToCmyk, 0.144).traps.some(trap => trap.lighterId === a.id && trap.darkerId === b.id)).toBe(false);
    const result = calculateProcessTraps([rect('light', 0, 'cmyk(90,90,90,0)'), rect('black', 10, '#000')], colorToCmyk, 0.144, 320);
    expect(result.traps).toEqual([]); expect(result.warnings[0]).toContain('ink coverage');
  });
});
