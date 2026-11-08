import { describe, expect, it } from 'vitest';
import { planSheet, type SheetPlanInput } from '../src/engine/sheetPlanning';
const input: SheetPlanInput = { sheetWidth: 1016, sheetHeight: 711.2, pieceWidth: 200, pieceHeight: 150, margin: 10, gap: 3, quantity: 24, allowRotation: false };
describe('bounded rectangular sheet planning', () => {
  it('keeps all placed pieces inside margins and separate by the requested gap', () => {
    const result = planSheet(input);
    expect(result.capacity).toBe(16); expect(result.sheetsRequired).toBe(2);
    for (const [i, a] of result.placements.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(input.margin); expect(a.y).toBeGreaterThanOrEqual(input.margin);
      expect(a.x + a.width).toBeLessThanOrEqual(input.sheetWidth - input.margin);
      expect(a.y + a.height).toBeLessThanOrEqual(input.sheetHeight - input.margin);
      for (const b of result.placements.slice(i + 1)) expect(a.x + a.width + input.gap <= b.x || b.x + b.width + input.gap <= a.x || a.y + a.height + input.gap <= b.y || b.y + b.height + input.gap <= a.y).toBe(true);
    }
  });
  it('rotates only when permitted and when it improves grid capacity', () => {
    const source = { ...input, sheetWidth: 100, sheetHeight: 70, pieceWidth: 60, pieceHeight: 40, margin: 0, gap: 0 };
    expect(planSheet(source).capacity).toBe(1);
    expect(planSheet({ ...source, allowRotation: true }).capacity).toBe(2);
  });
  it('handles no-fit cases and rejects invalid or unbounded requests', () => {
    expect(planSheet({ ...input, margin: 1000 }).placements).toEqual([]);
    expect(planSheet({ ...input, margin: 1000 }).sheetsRequired).toBeNull();
    expect(() => planSheet({ ...input, gap: -1 })).toThrow();
    expect(() => planSheet({ ...input, pieceWidth: NaN })).toThrow();
    expect(() => planSheet({ ...input, quantity: 1e9 })).toThrow();
  });
});
