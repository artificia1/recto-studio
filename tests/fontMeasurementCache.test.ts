import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { fontManager } from '../src/fontManager';
import { measureStoryText } from '../src/engine/storyLayout';

it('restores the correct text metrics when a headless publication changes its font scope', async () => {
  const bytes = await readFile(new URL('./fixtures/fonts/SourceSansPro-Regular.woff2', import.meta.url));
  const family = await fontManager.registerFontBuffer('SourceSansPro-Regular.woff2', bytes);
  const asset = fontManager.getFontAsset(family)!;
  const style = { fontFamily: family, fontSizePt: 12, color: '#000000', letterSpacingPt: 0 };
  const text = 'Minimum widths for an editorial manuscript.';
  const embedded = measureStoryText(text, style);
  await fontManager.withProjectFonts(undefined, async () => {
    expect(fontManager.getFont(family)).toBeUndefined();
    const fallback = measureStoryText(text, style);
    expect(fallback).not.toBe(embedded);
    await fontManager.withProjectFonts([asset], async () => {
      expect(measureStoryText(text, style)).toBeCloseTo(embedded, 8);
    });
    expect(measureStoryText(text, style)).toBeCloseTo(fallback, 8);
  });
  expect(measureStoryText(text, style)).toBeCloseTo(embedded, 8);
});
