import { describe, expect, it } from 'vitest';
import { displayProof, separateProof } from '../src/engine/inkProof';
describe('ink preview sampling', () => {
  it('samples transparency against paper and separates each pixel', async () => {
    const result = await separateProof(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]));
    expect(Array.from(result)).toEqual([0, 255, 255, 0, 0, 0, 0, 0]);
  });
  it('toggles independent plates without changing the total coverage meter', () => {
    const inks = new Uint8Array([255, 255, 255, 255, 255, 0, 0, 0]);
    const all = displayProof(inks, [true, true, true, true], 320, false);
    const none = displayProof(inks, [false, false, false, false], 320, false);
    expect(all.maximum).toBe(400); expect(none.maximum).toBe(400); expect(all.exceeded).toBe(1);
    expect(Array.from(none.rgba)).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
    const heat = displayProof(inks, [true, true, true, true], 300, true);
    expect(Array.from(heat.rgba.slice(0, 4))).toEqual([255, 0, 100, 255]);
    expect(Array.from(all.rgba.slice(4))).toEqual([0, 255, 255, 255]);
  });
});
