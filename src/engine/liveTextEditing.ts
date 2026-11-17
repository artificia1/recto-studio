/**
 * Geometry for editing a text frame in place on the canvas.
 *
 * The inline editor keeps a hidden textarea for input (keyboard, IME, clipboard) and draws the frame
 * with the same `layoutStory` output the page and the PDF use. Everything here maps between offsets in
 * the textarea's text and positions in that layout: where the caret is, what a click hits, which
 * rectangles a selection covers. Pure functions in millimetres, so they can be tested without a DOM.
 */
import type { CharacterStyle, ParagraphStyle, StoryContent, TextElement } from '../types';
import { compactRuns, editStory, plainStory, sliceStory, storyText } from './storyContent';
import { measureStoryText, resolveParagraphStyle, resolveRunStyle,
  type RunStyle, type StoryLine, type StoryMeasure } from './storyLayout';

const PT = 25.4 / 72;

/**
 * A caret sitting exactly where a line wraps belongs to two lines. `end` keeps it at the end of the
 * upper line (after End, or a click past the line's last character); `start` puts it on the lower one.
 */
export type CaretAffinity = 'start' | 'end';

/** A run of same-styled text on a line, with the source range it covers. */
export interface LiveChunk {
  start: number;
  end: number;
  x: number;
  width: number;
  /** As drawn. May end in a hyphen the composer added, which has no source character. */
  text: string;
  style: RunStyle;
}

export interface LiveLine {
  y: number;
  height: number;
  column: number;
  /** First and last caret offset that sit on this line. */
  start: number;
  end: number;
  /** Source offset where the following line begins. */
  next: number;
  /** The line ends with a paragraph break rather than a wrap. */
  hard: boolean;
  /** Horizontal extent of the text; for an empty line both are the caret position. */
  left: number;
  right: number;
  /** Type size and colour at the start of the line, for a caret on an empty line. */
  fontSizePt: number;
  color: string;
  chunks: LiveChunk[];
}

export interface CaretPosition {
  line: number;
  x: number;
  y: number;
  lineHeight: number;
  fontSizePt: number;
  color: string;
}

export interface SelectionRect { x: number; y: number; width: number; height: number }

/**
 * Plain frames keep the legacy renderer for features the story composer does not draw. Editing those
 * in place would show different typography than the finished frame, so they use the textarea editor.
 */
export function supportsLiveEditing(frame: TextElement, styles: ParagraphStyle[]): boolean {
  if (frame.textContent) return true;
  const style = styles.find(item => item.id === frame.paragraphStyleId);
  const columns = frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns || 1);
  if ((frame.dropCapLines ?? 0) >= 2) return false;
  if (frame.openTypeFeatures && Object.values(frame.openTypeFeatures).some(Boolean)) return false;
  if ((style?.grepStyles || frame.grepStyles)?.length) return false;
  if (frame.verticalAlign === 'middle' || frame.verticalAlign === 'bottom') return false;
  if (frame.balanceColumns && columns > 1) return false;
  return !/\{(cond|xref|index):/.test(frame.text || '');
}

/**
 * The frame's content with the editor's uncommitted text applied. Formatted stories go through
 * `editStory`, so paragraph styles and character formatting survive every keystroke; plain frames
 * have a single style and are laid out from the frame's own attributes, as the finished frame is.
 */
export function liveStoryContent(frame: TextElement, value: string, wrapped = false): StoryContent {
  if (frame.textContent) {
    return storyText(frame.textContent) === value ? frame.textContent : editStory(frame.textContent, value);
  }
  return plainStory(value, wrapped ? frame.paragraphStyleId : undefined);
}

/**
 * Replace the range a frame shows with the content edited in that frame. Threaded frames each show a
 * slice of one story; the slice may begin or end inside a paragraph, so the boundary paragraphs are
 * joined back onto the text that lives in the neighbouring frames.
 */
export function spliceStory(content: StoryContent, start: number, end: number, replacement: StoryContent): StoryContent {
  const before = sliceStory(content, 0, start).paragraphs;
  const after = sliceStory(content, end, storyText(content).length).paragraphs;
  const middle = replacement.paragraphs.map(paragraph => ({ ...paragraph, runs: [...paragraph.runs] }));
  middle[0].runs.unshift(...before[before.length - 1].runs);
  middle[middle.length - 1].runs.push(...after[0].runs);
  for (const paragraph of middle) paragraph.runs = compactRuns(paragraph.runs);
  return { version: 1, paragraphs: [...before.slice(0, -1), ...middle, ...after.slice(1)] };
}

/** One contiguous replacement, as a single input event makes. */
export interface TextEdit { start: number; removed: number; inserted: string }

/**
 * The replacement that turns `before` into `after`. Text alone is ambiguous when the change repeats
 * its surroundings (a paragraph break typed next to another one, a doubled letter), so `caret`, the
 * caret offset after the change, says where such a change really ends. It only moves the change,
 * never widens it: a caret that would make the replacement larger is ignored.
 */
export function textEdit(before: string, after: string, caret?: number): TextEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < before.length - start && suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const removed = before.length - start - suffix;
  const inserted = after.length - start - suffix;
  const tail = caret === undefined ? -1 : after.length - caret;
  // The same change, slid back so that it ends at the caret.
  const moved = caret === undefined ? -1 : caret - inserted;
  if (tail > suffix && moved >= 0 && tail + removed <= before.length &&
    before.slice(0, moved) === after.slice(0, moved) && before.slice(before.length - tail) === after.slice(caret)) {
    start = moved;
    suffix = tail;
  }
  return { start, removed, inserted: after.slice(start, after.length - suffix) };
}

/**
 * `editStory` for a replacement whose position is known. Typed text continues the formatting before
 * it, and a paragraph break continues the paragraph it was typed in, so Return at the end of a
 * heading starts another heading instead of borrowing the style of the paragraph below.
 */
export function applyTextEdit(content: StoryContent, edit: TextEdit): StoryContent {
  if (!edit.removed && !edit.inserted) return content;
  const length = storyText(content).length;
  const left = sliceStory(content, 0, edit.start).paragraphs;
  const right = sliceStory(content, edit.start + edit.removed, length).paragraphs;
  const anchor = sliceStory(content, Math.max(0, edit.start - 1), edit.start).paragraphs.at(-1)!;
  const { noteId: _note, reference: _reference, indexId: _index, text: _text, ...format } = anchor.runs.at(-1) || { text: '' };
  const result = left.slice(0, -1);
  let current = { ...left.at(-1)!, runs: [...left.at(-1)!.runs] };
  edit.inserted.split('\n').forEach((part, index) => {
    if (index) {
      result.push({ ...current, runs: compactRuns(current.runs) });
      current = { ...anchor, runs: [] };
    }
    current.runs.push({ ...format, text: part });
  });
  current.runs.push(...right[0].runs);
  result.push({ ...current, runs: compactRuns(current.runs) }, ...right.slice(1));
  return { version: 1, paragraphs: result };
}

/**
 * Apply a session's edits to formatted content one at a time. Comparing only the first and last text
 * would treat everything between two separate edits as replaced and lose its formatting.
 */
export function replayEdits(content: StoryContent, edits: TextEdit[]): StoryContent {
  return edits.reduce(applyTextEdit, content);
}

function columnGeometry(frame: TextElement) {
  const padding = frame.paddingMm ?? 2;
  const count = frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns || 1);
  const gutter = frame.columnGutterMm ?? 4;
  const width = Math.max(0, (frame.width - padding * 2 - (count - 1) * gutter) / count);
  return { padding, count, gutter, width };
}

/** Attach source offsets to composed lines. `source` is the text the lines were composed from. */
export function indexLines(lines: StoryLine[], source: string, content: StoryContent, frame: TextElement,
  styles: ParagraphStyle[], characters: CharacterStyle[] = []): LiveLine[] {
  const columns = columnGeometry(frame);
  const paragraphs: { start: number; paragraph: StoryContent['paragraphs'][number] }[] = [];
  let paragraphStart = 0;
  for (const paragraph of content.paragraphs) {
    paragraphs.push({ start: paragraphStart, paragraph });
    paragraphStart += paragraph.runs.reduce((length, run) => length + run.text.length, 0) + 1;
  }
  let paragraphIndex = 0;

  return lines.map(line => {
    let offset = line.start;
    const chunks: LiveChunk[] = [];
    for (const segment of line.segments) {
      let length = segment.text.length;
      // A discretionary hyphen is drawn but consumes no source character.
      if (segment.text.endsWith('-') && source[offset + length - 1] !== '-') length--;
      length = Math.max(0, Math.min(length, line.end - offset));
      chunks.push({ start: offset, end: offset + length, x: segment.x, width: segment.width, text: segment.text, style: segment.style });
      offset += length;
    }
    const hard = offset < line.end && source[line.end - 1] === '\n';
    while (paragraphIndex + 1 < paragraphs.length && paragraphs[paragraphIndex + 1].start <= line.start) paragraphIndex++;
    const paragraph = paragraphs[paragraphIndex]?.paragraph;
    const style = paragraph ? resolveParagraphStyle(paragraph, styles) : undefined;
    const base = resolveRunStyle(frame, style, { text: '' }, characters);

    let left: number, right: number;
    if (chunks.length) {
      left = chunks[0].x;
      right = chunks[chunks.length - 1].x + chunks[chunks.length - 1].width;
    } else {
      const alignment = style?.alignment || frame.alignment;
      const columnLeft = columns.padding + (line.column || 0) * (columns.width + columns.gutter);
      left = right = alignment === 'right' ? columnLeft + columns.width
        : alignment === 'center' ? columnLeft + columns.width / 2 : columnLeft;
    }
    return {
      y: line.y, height: line.height, column: line.column || 0,
      start: line.start, end: hard ? line.end - 1 : line.end, next: line.end, hard,
      left, right, chunks,
      fontSizePt: chunks[0]?.style.fontSizePt ?? base.fontSizePt,
      color: chunks[0]?.style.color ?? base.color,
    };
  });
}

function advance(text: string, style: RunStyle, measure: StoryMeasure): number {
  return text ? measure(text, style) + Array.from(text).length * style.letterSpacingPt * PT : 0;
}

let segmenter: Intl.Segmenter | null | undefined;

/** Offsets inside `text` where a caret may sit: never inside a surrogate pair or combining sequence. */
function caretStops(text: string): number[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  const stops = [0];
  if (segmenter) {
    for (const part of segmenter.segment(text)) stops.push(part.index + part.segment.length);
  } else {
    let index = 0;
    for (const character of text) { index += character.length; stops.push(index); }
  }
  return stops;
}

/** Horizontal position of `offset` on a line it belongs to. */
export function lineX(line: LiveLine, offset: number, measure: StoryMeasure = measureStoryText): number {
  if (!line.chunks.length || offset <= line.start) return line.left;
  for (let index = 0; index < line.chunks.length; index++) {
    const chunk = line.chunks[index];
    if (offset > chunk.end) continue;
    // At a boundary the caret joins the following chunk, so it hugs the next word on justified lines.
    if (offset === chunk.end && index + 1 < line.chunks.length) return line.chunks[index + 1].x;
    if (offset === chunk.end) return chunk.x + chunk.width;
    return chunk.x + advance(chunk.text.slice(0, offset - chunk.start), chunk.style, measure);
  }
  return line.right;
}

/** Nearest caret offset to `x` on a line. */
export function lineOffsetAt(line: LiveLine, x: number,
  measure: StoryMeasure = measureStoryText): { offset: number; affinity: CaretAffinity } {
  const lineEnd = { offset: line.end, affinity: (line.hard ? 'start' : 'end') as CaretAffinity };
  if (!line.chunks.length || x <= line.left) return { offset: line.start, affinity: 'start' };
  if (x >= line.right) return lineEnd;
  for (const chunk of line.chunks) {
    if (x >= chunk.x + chunk.width) continue;
    if (x <= chunk.x) return { offset: chunk.start, affinity: 'start' };
    const source = chunk.text.slice(0, chunk.end - chunk.start);
    let best = chunk.start, distance = x - chunk.x;
    for (const stop of caretStops(source)) {
      if (!stop) continue;
      const candidate = Math.abs(chunk.x + advance(source.slice(0, stop), chunk.style, measure) - x);
      if (candidate > distance) break;
      distance = candidate; best = chunk.start + stop;
    }
    return best === line.end ? lineEnd : { offset: best, affinity: 'start' };
  }
  return lineEnd;
}

/** Index of the line that shows a caret at `offset`, or -1 when that text is overset. */
export function lineIndexAt(lines: LiveLine[], offset: number, affinity: CaretAffinity = 'start'): number {
  let found = -1;
  for (let index = 0; index < lines.length; index++) {
    if (offset < lines[index].start) break;
    if (offset > lines[index].end) continue;
    if (found === -1 || affinity !== 'end') found = index;
  }
  return found;
}

export function caretAt(lines: LiveLine[], offset: number, affinity: CaretAffinity = 'start',
  measure: StoryMeasure = measureStoryText): CaretPosition | null {
  const index = lineIndexAt(lines, offset, affinity);
  if (index === -1) return null;
  const line = lines[index];
  // The caret takes the size of the text before it, as typing there continues that formatting.
  const chunk = line.chunks.findLast(item => item.start < offset && item.end > item.start) || line.chunks[0];
  return {
    line: index, x: lineX(line, offset, measure), y: line.y, lineHeight: line.height,
    fontSizePt: chunk?.style.fontSizePt ?? line.fontSizePt, color: chunk?.style.color ?? line.color,
  };
}

/** The caret offset a click at frame-local millimetres lands on. */
export function offsetAtPoint(lines: LiveLine[], frame: TextElement, x: number, y: number,
  measure: StoryMeasure = measureStoryText): { offset: number; affinity: CaretAffinity } | null {
  if (!lines.length) return null;
  const columns = columnGeometry(frame);
  const pitch = columns.width + columns.gutter;
  const column = pitch > 0
    ? Math.max(0, Math.min(columns.count - 1, Math.floor((x - columns.padding + columns.gutter / 2) / pitch))) : 0;
  const inColumn = lines.filter(line => line.column === column);
  const candidates = inColumn.length ? inColumn : lines;
  let target = candidates[0], distance = Infinity;
  for (const line of candidates) {
    const gap = y < line.y ? line.y - y : y >= line.y + line.height ? y - (line.y + line.height) + 0.0001 : 0;
    if (gap < distance) { distance = gap; target = line; }
  }
  return lineOffsetAt(target, x, measure);
}

/** Where Up or Down from `lineIndex` lands, keeping the caret near `goalX`. */
export function verticalTarget(lines: LiveLine[], lineIndex: number, direction: -1 | 1, goalX: number,
  textLength: number, measure: StoryMeasure = measureStoryText): { offset: number; affinity: CaretAffinity } {
  const target = lines[lineIndex + direction];
  if (!target) return { offset: direction < 0 ? 0 : textLength, affinity: 'start' };
  return lineOffsetAt(target, goalX, measure);
}

/** Highlight rectangles for the selected range, one per line it touches. */
export function selectionRects(lines: LiveLine[], start: number, end: number,
  measure: StoryMeasure = measureStoryText): SelectionRect[] {
  const rects: SelectionRect[] = [];
  if (end <= start) return rects;
  for (const line of lines) {
    if (line.start >= end) break;
    // A line owns the source range up to where the next one starts, including its paragraph break.
    if (start >= line.next) continue;
    const from = start <= line.start ? line.left : lineX(line, start, measure);
    let to = end >= line.end ? line.right : lineX(line, end, measure);
    // Show a selected paragraph break as a short stub, so empty lines are visibly selected.
    if (line.hard && end > line.end) to += line.height * 0.3;
    if (to > from) rects.push({ x: from, y: line.y, width: to - from, height: line.height });
  }
  return rects;
}

const WORD = /[\p{L}\p{N}\p{M}_'’]/u;

/** The word (or run of spaces, or single symbol) around `offset`, as a double-click selects it. */
export function wordRangeAt(text: string, offset: number): { start: number; end: number } {
  if (!text.length) return { start: 0, end: 0 };
  let index = Math.max(0, Math.min(offset, text.length - 1));
  if (text[index] === '\n' && index > 0 && text[index - 1] !== '\n') index--;
  if (text[index] === '\n') return { start: index, end: index };
  const kind = (character: string) => WORD.test(character) || /[\uD800-\uDFFF]/.test(character) ? 'word'
    : character === '\n' ? 'break' : /\s/.test(character) ? 'space' : 'symbol';
  const target = kind(text[index]);
  if (target === 'symbol') return { start: index, end: index + 1 };
  let start = index, end = index + 1;
  while (start > 0 && kind(text[start - 1]) === target) start--;
  while (end < text.length && kind(text[end]) === target) end++;
  return { start, end };
}

/** The paragraph around `offset`, without its break, as a triple-click selects it. */
export function paragraphRangeAt(text: string, offset: number): { start: number; end: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  // lastIndexOf treats a negative position as 0, which would find a break at the very start.
  const start = at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1;
  const next = text.indexOf('\n', at);
  return { start, end: next === -1 ? text.length : next };
}
