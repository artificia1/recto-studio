import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { fontManager } from '../src/fontManager';
import { layoutKernels } from '../src/engine/layoutRuntime';
import { fontTextWidth } from '../src/export/fontOutlines';

it.each([
  ['OpenSans-Regular.ttf', undefined],
  ['SourceSansPro-Regular.otf', undefined],
  ['Roboto-Variable.ttf', { wght: 700 }],
] as const)('shares Rust advances and source clusters between canvas and PDF for %s', async (name, variations) => {
  const bytes = await readFile(new URL(`./fixtures/fonts/${name}`, import.meta.url));
  const family = await fontManager.registerFontBuffer(name, bytes, variations);
  const font = fontManager.getFont(family)!;
  const text = 'An office café';
  const run = layoutKernels?.shapeFont(font, text);
  expect(run?.logical?.join('')).toEqual(text);
  expect(run?.glyphs.every(glyph => glyph.id > 0)).toBe(true);
  expect(run!.advanceWidth).toBeGreaterThan(0);
  expect(layoutKernels?.measureFont(font, text)).toBe(run?.advanceWidth);
  expect(fontTextWidth(font, text, 12)).toBeCloseTo(run!.advanceWidth / font.unitsPerEm * 12 * 25.4 / 72);
});
