import { describe, expect, it } from 'vitest';
import { findLocalFont, groupLocalFonts, normalizeFontName, type LocalFontFace } from '../src/engine/localFonts';

const face = (family: string, style: string, fullName = `${family} ${style}`, postscriptName = `${family.replace(/ /g, '')}-${style.replace(/ /g, '')}`): LocalFontFace =>
  ({ family, style, fullName, postscriptName, blob: async () => new Blob() });

const installed = groupLocalFonts([
  face('Minion Pro', 'Bold'),
  face('Minion Pro', 'Italic'),
  face('Minion Pro', 'Regular'),
  face('Minion Pro', 'Bold Italic'),
  face('Arial', 'Regular', 'Arial', 'ArialMT'),
  face('Arial', 'Narrow'),
  face('PT Sans', 'Caption'),
  face('', 'Regular'),
]);

describe('fonts on this computer', () => {
  it('groups faces by family, alphabetically, regular style first', () => {
    expect(installed.map(family => family.family)).toEqual(['Arial', 'Minion Pro', 'PT Sans']);
    expect(installed[1].faces.map(item => item.style)).toEqual(['Regular', 'Italic', 'Bold', 'Bold Italic']);
    expect(installed[0].faces.map(item => item.style)).toEqual(['Regular', 'Narrow']);
  });

  it('compares font names the way documents spell them', () => {
    expect(normalizeFontName('"Minion Pro", serif')).toBe('minionpro');
    expect(normalizeFontName('Minion-Pro')).toBe(normalizeFontName('minion pro'));
    expect(normalizeFontName('PT_Sans')).toBe('ptsans');
  });

  it('finds the regular face of a family a document refers to', () => {
    expect(findLocalFont(installed, 'Minion Pro')?.fullName).toBe('Minion Pro Regular');
    expect(findLocalFont(installed, "'minion pro', Georgia, serif")?.fullName).toBe('Minion Pro Regular');
    expect(findLocalFont(installed, 'Arial, sans-serif')?.postscriptName).toBe('ArialMT');
  });

  it('finds a face by its full or PostScript name, as InDesign documents may use them', () => {
    expect(findLocalFont(installed, 'Minion Pro Bold Italic')?.style).toBe('Bold Italic');
    expect(findLocalFont(installed, 'MinionPro-Bold')?.style).toBe('Bold');
    expect(findLocalFont(installed, 'ArialMT')?.fullName).toBe('Arial');
  });

  it('reports a font that is not installed', () => {
    expect(findLocalFont(installed, 'Myriad Pro')).toBeNull();
    expect(findLocalFont(installed, '')).toBeNull();
    // A family that only shares the beginning of its name is a different font.
    expect(findLocalFont(installed, 'PT Serif')).toBeNull();
  });
});
