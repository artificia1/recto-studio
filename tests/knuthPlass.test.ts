import { describe, it, expect } from 'vitest';
import { hyphenateWord } from '../src/engine/hyphenation';
import { KnuthPlassComposer } from '../src/engine/knuthPlass';
import { layoutKernels, warmLayout } from '../src/engine/layoutRuntime';
import { nativeOptimalBreaks } from '../src/engine/layoutWasm';

describe('Knuth-Plass Global Paragraph Composer & Liang Hyphenation', () => {
  it('correctly hyphenates multi-syllabic words using Liang algorithm patterns', () => {
    const syllables = hyphenateWord('hyphenation');
    expect(syllables.length).toBeGreaterThan(1);
    expect(syllables.join('')).toBe('hyphenation');

    const pubSyllables = hyphenateWord('publishing');
    expect(pubSyllables.length).toBeGreaterThan(1);
    expect(pubSyllables.join('')).toBe('publishing');
  });

  it('tokenizes text into Boxes, Glue, and Penalties', () => {
    const composer = new KnuthPlassComposer();
    const measure = (s: string) => s.length * 6;
    const items = composer.tokenize('Desktop publishing engines format text.', measure);

    expect(items.some((item) => item.type === 'box')).toBe(true);
    expect(items.some((item) => item.type === 'glue')).toBe(true);
    expect(items.some((item) => item.type === 'penalty')).toBe(true);
  });

  it('balances multi-line paragraphs minimizing global demerits', () => {
    const composer = new KnuthPlassComposer({ tolerance: 3 });
    const measure = (s: string) => s.length * 7;
    const text = 'The Adobe Paragraph Composer examines the entire paragraph as a whole to distribute spacing evenly.';
    const items = composer.tokenize(text, measure);
    const lines = composer.breakLines(items, 180);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.text.length > 0)).toBe(true);
    // Verified that all lines combined contain the original words
    const joinedText = lines.map((l) => l.text).join(' ');
    expect(joinedText.replace(/-/g, '')).toContain('Adobe Paragraph Composer');
  });

  it('matches the original solver with varying widths, hyphenation and emergency recovery', async () => {
    const composer = new KnuthPlassComposer({ tolerance: 3 });
    const source = 'Desktop composition uses widths, punctuation, and hyphenation to keep a line of justified copy balanced.';
    const measure = (word: string) => Array.from(word).reduce((width, letter) => width + 3 + letter.charCodeAt(0) % 5, 0);
    const fixtures = [76, 105, 130, [87, 114, 92], [99, 0, 102], 1].map(widths => {
      const items = composer.tokenize(source, measure);
      return { items, widths, expected: composer.breakLines(items, widths) };
    });
    await warmLayout();
    expect(layoutKernels?.optimalBreaks).toBeTypeOf('function');
    expect(nativeOptimalBreaks(fixtures[1].items, 105, 3, 3000)).not.toBeNull();
    expect(nativeOptimalBreaks(fixtures[5].items, 1, 3, 3000)).toBeNull();
    fixtures.forEach(({ items, widths, expected }) => expect(composer.breakLines(items, widths)).toEqual(expected));
  });
});
