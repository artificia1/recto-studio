import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { harfbuzzEngine } from '../src/engine/shaper';

describe('Complex Script & Non-Latin World Typography (HarfBuzz WASM)', () => {
  it('loads HarfBuzz WebAssembly and shapes Latin text into vector glyphs', async () => {
    const fontPath = 'C:/Windows/Fonts/arial.ttf';
    if (!fs.existsSync(fontPath)) return;

    const fontBuffer = fs.readFileSync(fontPath);
    const result = await harfbuzzEngine.shape(fontBuffer, 'Typography');

    expect(result.glyphs.length).toBeGreaterThan(0);
    expect(result.direction).toBe('ltr');
    expect(result.glyphs[0].glyphId).toBeGreaterThan(0);
    expect(result.glyphs[0].svgPath).toContain('M');
  });

  it('correctly handles Arabic complex cursive text with RTL direction', async () => {
    const fontPath = 'C:/Windows/Fonts/arial.ttf';
    if (!fs.existsSync(fontPath)) return;

    const fontBuffer = fs.readFileSync(fontPath);
    const result = await harfbuzzEngine.shape(fontBuffer, 'كتاب');

    expect(result.glyphs.length).toBeGreaterThan(0);
    expect(result.direction).toBe('rtl');
    expect(result.glyphs[0].glyphId).toBeGreaterThan(0);
  });
});
