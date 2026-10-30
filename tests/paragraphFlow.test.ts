import { describe, expect, it } from 'vitest';
import { layoutStory } from '../src/engine/storyLayout';
import { plainStory, storyText } from '../src/engine/storyContent';
import { hyphenateLanguage } from '../src/engine/languageHyphenation';
import type { ParagraphStyle, StoryContent, TextElement } from '../src/types';

const frame: TextElement = { id: 'f', type: 'text', pageId: 'p', x: 0, y: 0, width: 10, height: 9,
  text: '', rotation: 0, opacity: 1, zIndex: 1, locked: false, fontFamily: 'serif', fontSizePt: 10,
  lineHeight: 1, letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 2,
  paddingMm: 0, borderWidthMm: 0, borderColor: 'transparent', backgroundColor: 'transparent' };
const style = (changes: Partial<ParagraphStyle>): ParagraphStyle => ({ id: 'body', name: 'Body', fontFamily: 'serif',
  fontSizePt: 10, lineHeight: 1, letterSpacingPt: 0, color: '#111111', alignment: 'left', snapToBaseline: false, ...changes });
const measure = (text: string) => text.length;
const paragraph = (text: string, styleId = 'body') => ({ styleId, runs: [{ text }] });

describe('Paragraph composition rules', () => {
  it('keeps a paragraph together without rewriting source text', () => {
    const content: StoryContent = { version: 1, paragraphs: [paragraph('Intro', 'plain'), paragraph('aaaa bbbb cccc dddd')] };
    const result = layoutStory(content, frame, [style({ keepTogether: true })], [], measure);
    expect(result.lines.map(line => line.segments.map(segment => segment.text).join('')).join('')).toBe('Intro');
    expect(result.consumed).toBe(6);
    expect(storyText(content)).toBe('Intro\naaaa bbbb cccc dddd');
  });

  it('moves a heading with the first body line', () => {
    const content: StoryContent = { version: 1, paragraphs: [paragraph('Intro', 'plain'), paragraph('Heading', 'heading'), paragraph('aaaa bbbb cccc dddd', 'plain')] };
    const result = layoutStory(content, frame, [style({ id: 'heading', keepWithNext: true })], [], measure);
    expect(result.lines).toHaveLength(1);
    expect(result.consumed).toBe(6);
  });

  it('avoids a one-line paragraph fragment at the column bottom', () => {
    const content: StoryContent = { version: 1, paragraphs: [paragraph('Intro', 'plain'), paragraph('aaaa bbbb cccc dddd eeee ffff')] };
    const result = layoutStory(content, frame, [style({ orphanLines: 2 })], [], measure);
    expect(result.lines).toHaveLength(1);
    expect(result.consumed).toBe(6);
  });

  it('reserves two lines for the next column or frame', () => {
    const content = plainStory('aaaa bbbb cccc dddd eeee ffff gggg hhhh', 'body');
    const result = layoutStory(content, { ...frame, height: 12 }, [style({ widowLines: 2 })], [], measure);
    expect(result.lines).toHaveLength(2);
    expect(result.overset).toBe(true);
    const columns = layoutStory(content, { ...frame, height: 12, width: 22, columns: 2 }, [style({ widowLines: 2 })], [], measure);
    expect(columns.lines.filter(line => line.column === 0)).toHaveLength(2);
    expect(columns.lines.filter(line => line.column === 1)).toHaveLength(2);
    expect(columns.overset).toBe(false);
  });

  it('uses dictionary breaks while retaining exact source offsets', () => {
    const content = plainStory('hyphenation', 'body');
    const result = layoutStory(content, { ...frame, width: 7, height: 30 }, [style({ hyphenate: true, language: 'en-US' })], [], measure);
    const displayed = result.lines.map(line => line.segments.map(segment => segment.text).join('')).join('');
    expect(displayed).toContain('-');
    expect(displayed.replace(/-/g, '')).toBe('hyphenation');
    expect(result.consumed).toBe('hyphenation'.length);
    expect(storyText(content)).toBe('hyphenation');
    for (const [word, language] of [['Silbentrennung', 'de'], ['typographie', 'fr']]) {
      const parts = hyphenateLanguage(word, language);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.join('')).toBe(word);
    }
  });

  it('allows an oversized kept paragraph to continue instead of stalling forever', () => {
    const content = plainStory('aaaa bbbb cccc dddd eeee ffff gggg hhhh', 'body');
    const result = layoutStory(content, frame, [style({ keepTogether: true })], [], measure);
    expect(result.consumed).toBeGreaterThan(0);
    expect(result.overset).toBe(true);
  });
});
