import { describe, expect, it } from 'vitest';
import { layoutStory } from '../src/engine/storyLayout';
import { editStory, sliceStory, storyText } from '../src/engine/storyContent';
import { applyTextEdit, caretAt, indexLines, lineIndexAt, liveStoryContent, offsetAtPoint, paragraphRangeAt, replayEdits,
  selectionRects, spliceStory, supportsLiveEditing, textEdit, verticalTarget, wordRangeAt } from '../src/engine/liveTextEditing';
import type { ParagraphStyle, StoryContent, TextElement } from '../src/types';

// One millimetre per character and 10pt lines keep every expected position easy to read.
const LINE = 10 * 25.4 / 72;
const measure = (text: string) => text.length;
const frame: TextElement = { id: 'f', type: 'text', pageId: 'p', x: 0, y: 0, width: 10, height: 60,
  text: '', rotation: 0, opacity: 1, zIndex: 1, locked: false, fontFamily: 'serif', fontSizePt: 10,
  lineHeight: 1, letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 2,
  paddingMm: 0, borderWidthMm: 0, borderColor: 'transparent', backgroundColor: 'transparent' };
const style = (id: string, changes: Partial<ParagraphStyle> = {}): ParagraphStyle => ({ id, name: id, fontFamily: 'serif',
  fontSizePt: 10, lineHeight: 1, letterSpacingPt: 0, color: '#111111', alignment: 'left', snapToBaseline: false, ...changes });
const styles = [style('body'), style('head', { fontSizePt: 20, alignment: 'center', color: '#aa0000' }), style('right', { alignment: 'right' })];
const story = (...paragraphs: [string, string?][]): StoryContent =>
  ({ version: 1, paragraphs: paragraphs.map(([text, styleId = 'body']) => ({ styleId, runs: [{ text }] })) });

function compose(content: StoryContent, changes: Partial<TextElement> = {}, paragraphStyles = styles) {
  const target = { ...frame, ...changes };
  const source = storyText(content);
  const layout = layoutStory(content, target, paragraphStyles, [], measure);
  return { frame: target, source, lines: indexLines(layout.lines, source, content, target, paragraphStyles) };
}

describe('lines of an edited frame', () => {
  // "aaaa bbbb " wraps before "cccc"; the paragraph break after "cccc" is offset 14.
  const { lines, source } = compose(story(['aaaa bbbb cccc'], ['dd']));

  it('gives every line the caret offsets that sit on it', () => {
    expect(lines.map(line => [line.start, line.end, line.next, line.hard])).toEqual([
      [0, 10, 10, false],
      [10, 14, 15, true],
      [15, 17, 17, false],
    ]);
    expect(source.length).toBe(17);
  });

  it('places the caret by measuring the text before it', () => {
    expect(caretAt(lines, 0, 'start', measure)).toMatchObject({ line: 0, x: 0, y: 0 });
    expect(caretAt(lines, 7, 'start', measure)).toMatchObject({ line: 0, x: 7 });
    expect(caretAt(lines, 12, 'start', measure)).toMatchObject({ line: 1, x: 2, y: LINE });
    expect(caretAt(lines, 17, 'start', measure)).toMatchObject({ line: 2, x: 2 });
  });

  it('keeps a caret at a wrap on the line its affinity names', () => {
    expect(caretAt(lines, 10, 'start', measure)).toMatchObject({ line: 1, x: 0 });
    expect(caretAt(lines, 10, 'end', measure)).toMatchObject({ line: 0, x: 10 });
  });

  it('keeps the caret before a paragraph break on that paragraph', () => {
    expect(lineIndexAt(lines, 14)).toBe(1);
    expect(lineIndexAt(lines, 14, 'end')).toBe(1);
    expect(lineIndexAt(lines, 15)).toBe(2);
  });

  it('reports no caret for text that does not fit the frame', () => {
    const overset = compose(story(['aaaa bbbb cccc'], ['dd']), { height: LINE * 1.5 });
    expect(overset.lines).toHaveLength(1);
    expect(caretAt(overset.lines, 3, 'start', measure)).not.toBeNull();
    expect(caretAt(overset.lines, 12, 'start', measure)).toBeNull();
  });
});

describe('paragraph styles while editing', () => {
  it('puts the caret of an empty paragraph where its alignment starts', () => {
    const { lines } = compose(story(['ab'], ['', 'head'], ['', 'right'], ['']));
    expect(caretAt(lines, 3, 'start', measure)).toMatchObject({ line: 1, x: 5, fontSizePt: 20, color: '#aa0000' });
    expect(caretAt(lines, 4, 'start', measure)).toMatchObject({ line: 2, x: 10, fontSizePt: 10 });
    expect(caretAt(lines, 5, 'start', measure)).toMatchObject({ line: 3, x: 0 });
  });

  it('sizes the caret by the paragraph it is in', () => {
    const { lines } = compose(story(['Hi', 'head'], ['text']));
    expect(caretAt(lines, 1, 'start', measure)).toMatchObject({ fontSizePt: 20, lineHeight: LINE * 2, x: 5 });
    expect(caretAt(lines, 4, 'start', measure)).toMatchObject({ fontSizePt: 10, lineHeight: LINE, y: LINE * 2 });
  });

  it('follows the words of a justified line', () => {
    const justified = [style('body', { alignment: 'justify' })];
    const { lines } = compose(story(['aa bb cccccc']), {}, justified);
    // "aa bb " leaves four millimetres, shared by the two spaces of the first line.
    expect(lines[0].chunks.map(chunk => [chunk.text, chunk.start, chunk.x])).toEqual([
      ['aa', 0, 0], [' ', 2, 2], ['bb', 3, 5], [' ', 5, 7],
    ]);
    expect(caretAt(lines, 3, 'start', measure)!.x).toBe(5);
    expect(offsetAtPoint(lines, frame, 5.2, 1, measure)).toEqual({ offset: 3, affinity: 'start' });
  });

  it('does not count a hyphen the composer added as a character', () => {
    const hyphenated = [style('body', { hyphenate: true, language: 'en-US' })];
    const { lines, source } = compose(story(['aa information']), {}, hyphenated);
    const drawn = lines.map(line => line.chunks.map(chunk => chunk.text).join(''));
    expect(drawn.some(text => text.endsWith('-'))).toBe(true);
    // Offsets stay continuous across the hyphenated break and cover the source exactly.
    for (let index = 1; index < lines.length; index++) expect(lines[index].start).toBe(lines[index - 1].next);
    expect(lines.at(-1)!.end).toBe(source.length);
    const broken = lines.findIndex(line => line.chunks.at(-1)?.text.endsWith('-'));
    const last = lines[broken].chunks.at(-1)!;
    expect(last.end - last.start).toBe(last.text.length - 1);
    expect(source.slice(last.start, last.end)).toBe(last.text.slice(0, -1));
  });
});

describe('pointing and moving', () => {
  const { lines, source, frame: target } = compose(story(['aaaa bbbb cccc'], ['dd']));

  it('finds the character boundary nearest a click', () => {
    expect(offsetAtPoint(lines, target, 2.4, 1, measure)).toEqual({ offset: 2, affinity: 'start' });
    expect(offsetAtPoint(lines, target, 2.6, 1, measure)).toEqual({ offset: 3, affinity: 'start' });
    expect(offsetAtPoint(lines, target, 1.2, LINE + 1, measure)).toEqual({ offset: 11, affinity: 'start' });
  });

  it('puts a click past the end of a line at that line end', () => {
    expect(offsetAtPoint(lines, target, 50, 1, measure)).toEqual({ offset: 10, affinity: 'end' });
    expect(offsetAtPoint(lines, target, 50, LINE + 1, measure)).toEqual({ offset: 14, affinity: 'start' });
    expect(offsetAtPoint(lines, target, -5, LINE + 1, measure)).toEqual({ offset: 10, affinity: 'start' });
  });

  it('uses the nearest line for a click above or below the text', () => {
    expect(offsetAtPoint(lines, target, 1, -20, measure)!.offset).toBe(1);
    expect(offsetAtPoint(lines, target, 1, 500, measure)!.offset).toBe(16);
  });

  it('moves up and down keeping the horizontal position', () => {
    expect(verticalTarget(lines, 0, 1, 3, source.length, measure)).toEqual({ offset: 13, affinity: 'start' });
    expect(verticalTarget(lines, 1, 1, 3, source.length, measure)).toEqual({ offset: 17, affinity: 'end' });
    expect(verticalTarget(lines, 1, -1, 3, source.length, measure)).toEqual({ offset: 3, affinity: 'start' });
  });

  it('goes to the start or end of the text from the first or last line', () => {
    expect(verticalTarget(lines, 0, -1, 3, source.length, measure).offset).toBe(0);
    expect(verticalTarget(lines, 2, 1, 1, source.length, measure).offset).toBe(source.length);
  });

  it('maps a click to the column it falls in', () => {
    const columns = compose(story(['aaaa bbbb cccc dddd eeee ffff']), { width: 22, columns: 2, height: LINE * 2.5 });
    expect(columns.lines.map(line => line.column)).toEqual([0, 0, 1]);
    const second = columns.lines[2];
    expect(second.left).toBe(12);
    expect(offsetAtPoint(columns.lines, columns.frame, 14, 1, measure)).toEqual({ offset: second.start + 2, affinity: 'start' });
    expect(offsetAtPoint(columns.lines, columns.frame, 3, 1, measure)!.offset).toBe(3);
  });
});

describe('selection highlight', () => {
  const { lines } = compose(story(['aaaa bbbb cccc'], [''], ['dd']));

  it('covers the selected part of each line', () => {
    expect(selectionRects(lines, 2, 12, measure)).toEqual([
      { x: 2, y: 0, width: 8, height: LINE },
      { x: 0, y: LINE, width: 2, height: LINE },
    ]);
    expect(selectionRects(lines, 3, 3, measure)).toEqual([]);
  });

  it('shows a selected paragraph break, also on an empty line', () => {
    const rects = selectionRects(lines, 12, 16, measure);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: 2, y: LINE });
    expect(rects[0].width).toBeGreaterThan(2);
    expect(rects[1]).toMatchObject({ x: 0, y: LINE * 2 });
    expect(rects[1].width).toBeGreaterThan(0);
  });

  it('does not reach into the line after the selection', () => {
    expect(selectionRects(lines, 0, 10, measure)).toEqual([{ x: 0, y: 0, width: 10, height: LINE }]);
  });
});

describe('word and paragraph selection', () => {
  const text = 'Привет, мир!\nSecond line';

  it('selects the word under a double click, in any script', () => {
    expect(wordRangeAt(text, 3)).toEqual({ start: 0, end: 6 });
    expect(wordRangeAt(text, 9)).toEqual({ start: 8, end: 11 });
    expect(wordRangeAt(text, 15)).toEqual({ start: 13, end: 19 });
  });

  it('selects punctuation and spaces on their own', () => {
    expect(wordRangeAt(text, 6)).toEqual({ start: 6, end: 7 });
    expect(wordRangeAt(text, 7)).toEqual({ start: 7, end: 8 });
  });

  it('stays inside the paragraph at a line end', () => {
    expect(wordRangeAt(text, 12)).toEqual({ start: 11, end: 12 });
    expect(wordRangeAt('', 0)).toEqual({ start: 0, end: 0 });
  });

  it('selects the paragraph under a triple click without its break', () => {
    expect(paragraphRangeAt(text, 4)).toEqual({ start: 0, end: 12 });
    expect(paragraphRangeAt(text, 12)).toEqual({ start: 0, end: 12 });
    expect(paragraphRangeAt(text, 13)).toEqual({ start: 13, end: 24 });
  });

  it('handles empty paragraphs at either end of the text', () => {
    expect(paragraphRangeAt('\nabc\n', 0)).toEqual({ start: 0, end: 0 });
    expect(paragraphRangeAt('\nabc\n', 2)).toEqual({ start: 1, end: 4 });
    expect(paragraphRangeAt('\nabc\n', 5)).toEqual({ start: 5, end: 5 });
    expect(wordRangeAt('\nabc', 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('content of an edited frame', () => {
  const content = story(['Title', 'head'], ['Body text'], ['Quote', 'right']);

  it('keeps every paragraph style while text is typed', () => {
    const formatted = { ...frame, text: storyText(content), textContent: content };
    const edited = liveStoryContent(formatted, 'Title\nBody more text\nQuote');
    expect(edited.paragraphs.map(paragraph => paragraph.styleId)).toEqual(['head', 'body', 'right']);
    expect(storyText(edited)).toBe('Title\nBody more text\nQuote');
    expect(liveStoryContent(formatted, storyText(content))).toBe(content);
  });

  it('lays a plain frame out from its own attributes', () => {
    const plain = { ...frame, text: 'One\nTwo', paragraphStyleId: 'head' };
    expect(liveStoryContent(plain, 'One\nTwo!').paragraphs).toEqual([{ styleId: undefined, runs: [{ text: 'One' }] }, { styleId: undefined, runs: [{ text: 'Two!' }] }]);
    // Around a wrap object the finished frame is composed with its paragraph style, so editing is too.
    expect(liveStoryContent(plain, 'One', true).paragraphs[0].styleId).toBe('head');
  });

  it('applies edits made in two places without restyling what lies between them', () => {
    const typed = ['Title!\nBody text\nQuote', 'Title!\nBody text\nQuote?'];
    const edits = [textEdit(storyText(content), typed[0]), textEdit(typed[0], typed[1])];
    const replayed = replayEdits(content, edits);
    expect(storyText(replayed)).toBe(typed[1]);
    expect(replayed.paragraphs.map(paragraph => paragraph.styleId)).toEqual(['head', 'body', 'right']);
    // Handing both edits over as one change is what loses the styles in between.
    expect(editStory(content, typed[1]).paragraphs.map(paragraph => paragraph.styleId)).toEqual(['head', 'head', 'head']);
  });

  it('starts a new paragraph in the style of the one Return was pressed in', () => {
    const before = storyText(content);
    const atHeadingEnd = 'Title\n\nBody text\nQuote';
    // The same text results from Return at the end of the heading and at the start of the body;
    // only the caret tells them apart.
    const afterHeading = applyTextEdit(content, textEdit(before, atHeadingEnd, 6));
    expect(afterHeading.paragraphs.map(paragraph => paragraph.styleId)).toEqual(['head', 'head', 'body', 'right']);
    const beforeBody = applyTextEdit(content, textEdit(before, atHeadingEnd, 7));
    expect(beforeBody.paragraphs.map(paragraph => paragraph.styleId)).toEqual(['head', 'body', 'body', 'right']);
    expect(storyText(afterHeading)).toBe(atHeadingEnd);
    expect(storyText(beforeBody)).toBe(atHeadingEnd);
  });

  it('continues the formatting before the caret and keeps the rest', () => {
    const bold: StoryContent = { version: 1, paragraphs: [{ styleId: 'body', runs: [{ text: 'aa', bold: true }, { text: 'aa' }] }] };
    expect(applyTextEdit(bold, textEdit('aaaa', 'aaaaa', 2)).paragraphs[0].runs).toEqual([{ text: 'aaa', bold: true }, { text: 'aa' }]);
    expect(applyTextEdit(bold, textEdit('aaaa', 'aaaaa', 4)).paragraphs[0].runs).toEqual([{ text: 'aa', bold: true }, { text: 'aaa' }]);
    expect(applyTextEdit(bold, textEdit('aaaa', 'aaa', 3)).paragraphs[0].runs).toEqual([{ text: 'aa', bold: true }, { text: 'a' }]);
    expect(applyTextEdit(bold, textEdit('aaaa', 'aaaa'))).toBe(bold);
  });

  it('matches editStory where the change is unambiguous', () => {
    const typed = 'Title\nBody new\nlines text\nQuote';
    expect(applyTextEdit(content, textEdit(storyText(content), typed, 19))).toEqual(editStory(content, typed));
    const joined = 'TitleBody text\nQuote';
    expect(applyTextEdit(content, textEdit(storyText(content), joined, 5))).toEqual(editStory(content, joined));
  });

  it('uses the caret to place an ambiguous change, when it fits the text', () => {
    expect(textEdit('H\nB', 'H\n\nB', 2)).toEqual({ start: 1, removed: 0, inserted: '\n' });
    expect(textEdit('H\nB', 'H\n\nB', 3)).toEqual({ start: 2, removed: 0, inserted: '\n' });
    expect(textEdit('aaa', 'aaaa', 1)).toEqual({ start: 0, removed: 0, inserted: 'a' });
    // Forward delete leaves the caret where it was, in front of what went away.
    expect(textEdit('abcabc', 'abc', 0)).toEqual({ start: 0, removed: 3, inserted: '' });
    // A caret that cannot be the end of the change is ignored.
    expect(textEdit('abcdef', 'abXYef', 0)).toEqual({ start: 2, removed: 2, inserted: 'XY' });
    // So is one past the change: it must never widen the replacement over untouched text.
    expect(textEdit('ab\ncd', 'abX\ncd', 5)).toEqual({ start: 2, removed: 0, inserted: 'X' });
    expect(textEdit('ab\ncd', 'abX\ncd', 3)).toEqual({ start: 2, removed: 0, inserted: 'X' });
  });

  it('describes an input event as one replacement', () => {
    expect(textEdit('abcdef', 'abXYef')).toEqual({ start: 2, removed: 2, inserted: 'XY' });
    expect(textEdit('abc', 'abc')).toEqual({ start: 3, removed: 0, inserted: '' });
    expect(textEdit('', 'new')).toEqual({ start: 0, removed: 0, inserted: 'new' });
    expect(textEdit('aaa', 'aa')).toEqual({ start: 2, removed: 1, inserted: '' });
  });
});

describe('committing a frame of a threaded story', () => {
  const whole: StoryContent = { version: 1, paragraphs: [
    { styleId: 'head', runs: [{ text: 'Title' }] },
    { styleId: 'body', runs: [{ text: 'First ' }, { text: 'bold', bold: true }, { text: ' part and second part' }] },
    { styleId: 'right', runs: [{ text: 'Tail' }] },
  ] };
  const text = storyText(whole);

  it('puts an edited slice back between the text of the other frames', () => {
    // The first frame ends inside the body paragraph, after "First bold part".
    const end = text.indexOf(' and second');
    const slice = sliceStory(whole, 0, end);
    const edited = editStory(slice, storyText(slice).replace('Title', 'New title'));
    const result = spliceStory(whole, 0, end, edited);
    expect(storyText(result)).toBe(text.replace('Title', 'New title'));
    expect(result.paragraphs.map(paragraph => paragraph.styleId)).toEqual(['head', 'body', 'right']);
    expect(result.paragraphs[1].runs).toEqual(whole.paragraphs[1].runs);
  });

  it('joins a slice that starts inside a paragraph onto the frame before it', () => {
    const start = text.indexOf('second');
    const slice = sliceStory(whole, start, text.length);
    const renamed = storyText(slice).replace('second', '2nd');
    const edited = replayEdits(slice, [textEdit(storyText(slice), renamed), textEdit(renamed, renamed + '\nMore')]);
    const result = spliceStory(whole, start, text.length, edited);
    expect(storyText(result)).toBe(text.replace('second', '2nd') + '\nMore');
    expect(result.paragraphs.map(paragraph => paragraph.styleId)).toEqual(['head', 'body', 'right', 'right']);
    expect(result.paragraphs[1].runs[1]).toEqual({ text: 'bold', bold: true });
  });

  it('returns the same story when the frame shows all of it unchanged', () => {
    expect(spliceStory(whole, 0, text.length, whole)).toEqual(whole);
  });
});

describe('frames that keep the textarea editor', () => {
  it('edits formatted and ordinary plain frames in place', () => {
    expect(supportsLiveEditing({ ...frame, text: 'Plain' }, styles)).toBe(true);
    expect(supportsLiveEditing({ ...frame, text: 'x', dropCapLines: 3, textContent: story(['x']) }, styles)).toBe(true);
  });

  it('leaves plain frames with legacy-only typography to the textarea', () => {
    expect(supportsLiveEditing({ ...frame, text: 'Drop', dropCapLines: 3 }, styles)).toBe(false);
    expect(supportsLiveEditing({ ...frame, text: 'Caps', openTypeFeatures: { smallCaps: true } }, styles)).toBe(false);
    expect(supportsLiveEditing({ ...frame, text: 'Caps', openTypeFeatures: { smallCaps: false } }, styles)).toBe(true);
    expect(supportsLiveEditing({ ...frame, text: 'Middle', verticalAlign: 'middle' }, styles)).toBe(false);
    expect(supportsLiveEditing({ ...frame, text: 'See {xref:intro}' }, styles)).toBe(false);
    expect(supportsLiveEditing({ ...frame, text: 'Grep', grepStyles: [{ pattern: '\\d+', color: '#ff0000' }] }, styles)).toBe(false);
    expect(supportsLiveEditing({ ...frame, text: 'Two', columns: 2, balanceColumns: true }, styles)).toBe(false);
  });
});
