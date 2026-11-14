import type { CanvasElement, CharacterStyle, ParagraphStyle, StoryContent, StoryParagraph, StoryRun, TextElement, TextFormatting } from '../types';
import { fontManager } from '../fontManager';
import { hyphenateLanguage } from './languageHyphenation';
import { cjkRunTokens, graphemes } from './globalTypography';
import { prepareWrapObstacles, availableTextInterval } from './wrapGeometry';

export interface RunStyle extends TextFormatting {
  fontFamily: string;
  fontSizePt: number;
  color: string;
  letterSpacingPt: number;
}
export interface StorySegment { text: string; x: number; width: number; style: RunStyle }
export interface StoryLine { segments: StorySegment[]; y: number; height: number; start: number; end: number; column?: number }
export type StoryMeasure = (text: string, style: RunStyle) => number;
export interface StoryLayoutOptions {
  obstacles?: CanvasElement[];
  baselineGrid?: { enabled: boolean; startMm: number; incrementPt: number };
}
const PT = 25.4 / 72;
let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

export function canvasRunFont(style: RunStyle, scale: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSizePt * PT * scale}px ${style.fontFamily}`;
}

/** Measurements and layout are in millimetres, independent of canvas zoom. */
export const measureStoryText: StoryMeasure = (text, style) => {
  const font = fontManager.getFont(style.fontFamily);
  if (font) return font.layout(text).advanceWidth / font.unitsPerEm * style.fontSizePt * PT;
  if (context === undefined) {
    context = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d')
      : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  }
  if (context) {
    context.font = canvasRunFont(style, 96 / 25.4);
    context.letterSpacing = '0px';
    return context.measureText(text).width * 25.4 / 96;
  }
  return Array.from(text).reduce((n, c) => n + (/\s/.test(c) ? 0.28 : /[ilI.,!]/.test(c) ? 0.27 : /[MW]/.test(c) ? 0.85 : 0.52), 0) * style.fontSizePt * PT;
};

export function resolveParagraphStyle(paragraph: StoryParagraph, styles: ParagraphStyle[]): Partial<ParagraphStyle> {
  const style = { ...styles.find(s => s.id === paragraph.styleId), ...paragraph.formatting };
  if (paragraph.language) {
    const language = paragraph.language.toLowerCase();
    const primary = language.split('-')[0];
    const supported = (['de', 'fr', 'ja', 'zh', 'ko'] as const).find(item => item === primary);
    style.language = supported || (language === 'en-us' ? 'en-US' : undefined);
  }
  return style;
}

export function resolveRunStyle(frame: TextElement, paragraph: Partial<ParagraphStyle> | undefined,
  run: StoryRun, characters: CharacterStyle[]): RunStyle {
  const named = characters.find(style => style.id === run.characterStyleId);
  return {
    fontFamily: paragraph?.fontFamily || frame.fontFamily,
    fontSizePt: paragraph?.fontSizePt || frame.fontSizePt,
    color: paragraph?.color || frame.color,
    letterSpacingPt: paragraph?.letterSpacingPt ?? frame.letterSpacingPt ?? 0,
    bold: (paragraph as TextFormatting)?.bold, italic: (paragraph as TextFormatting)?.italic,
    underline: (paragraph as TextFormatting)?.underline,
    ...named, ...Object.fromEntries(Object.entries(run).filter(([key, value]) => key !== 'text' && value !== undefined)),
  };
}

/** Compose a formatted slice, returning the exact source offset that fits. Never rewrites copy. */
type StoryParagraphs = Pick<StoryParagraph[], 'length' | 'at'>;

function composeStory(paragraphs: StoryParagraphs, frame: TextElement, styles: ParagraphStyle[],
  characters: CharacterStyle[] = [], measure: StoryMeasure = measureStoryText,
  reserveBottom = 0, options: StoryLayoutOptions = {}, breaks = new Set<number>()): { lines: StoryLine[]; consumed: number; overset: boolean } {
  const padding = frame.paddingMm ?? 2;
  const cols = frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns || 1);
  const gutter = frame.columnGutterMm ?? 4;
  const width = Math.max(0, (frame.width - padding * 2 - (cols - 1) * gutter) / cols);
  const bottom = frame.height - padding - reserveBottom;
  const lines: StoryLine[] = [];
  const wrapObstacles = prepareWrapObstacles(options.obstacles || [], frame);
  let column = 0, y = padding, offset = 0, consumed = 0;
  const appliedBreaks = new Set<number>();
  if (width <= 0 || bottom <= padding) {
    const overset = paragraphs.length > 1 || !!paragraphs.at(0)?.runs.some(run => run.text.length > 0);
    return { lines, consumed, overset };
  }

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const paragraph = paragraphs.at(pi)!;
    const style = resolveParagraphStyle(paragraph, styles);
    const base = resolveRunStyle(frame, style, { text: '' }, characters);
    const leading = style?.lineHeight || frame.lineHeight || 1.3;
    const paragraphHeight = paragraph.runs.reduce((maximum, r) => Math.max(maximum, resolveRunStyle(frame, style, r, characters).fontSizePt), base.fontSizePt) * PT * leading;
    let segments: StorySegment[] = [], lineWidth = 0, height = paragraphHeight;
    let lineStart = offset;
    let availableWidth = width, inset = 0;
    const prepare = (): boolean => {
      if (segments.length) return true;
      let probes = 0;
      if (breaks.has(lineStart) && !appliedBreaks.has(lineStart)) {
        appliedBreaks.add(lineStart);
        column++;
        y = padding;
      }
      for (;;) {
        if (++probes > 4096) return false;
        const grid = options.baselineGrid;
        if ((style?.snapToBaseline ?? frame.snapToBaseline) && grid?.enabled) {
          const pitch = grid.incrementPt * PT;
          if (pitch > 0) y = grid.startMm - frame.y + Math.max(0, Math.ceil((frame.y + y - grid.startMm) / pitch - 0.00001)) * pitch;
        }
        if (y + height > bottom + 0.0001) { column++; y = padding; }
        if (column >= cols || y + height > bottom + 0.0001) return false;
        const left = frame.x + padding + column * (width + gutter);
        const space = availableTextInterval(wrapObstacles, left, width, frame.y + y, height);
        inset = space.left - left; availableWidth = space.width;
        if (availableWidth > 1) return true;
        y += height;
      }
    };
    const flush = (last: boolean): boolean => {
      if (!prepare()) return false;
      const alignment = style?.alignment || frame.alignment;
      const lineText = segments.map(segment => segment.text).join('');
      const first = lineText.trimStart()[0], lastCharacter = lineText.trimEnd().at(-1);
      const leadingHang = frame.opticalMarginAlignment && first && '“‘"\'«‹(['.includes(first) ? measure(first, segments[0].style) / 2 : 0;
      const trailingHang = frame.opticalMarginAlignment && lastCharacter && '.,-–—:;”’"\'»›!?)]'.includes(lastCharacter) ? measure(lastCharacter, segments.at(-1)!.style) / 2 : 0;
      let shift = alignment === 'right' ? availableWidth - lineWidth + trailingHang : alignment === 'center' ? (availableWidth - lineWidth - leadingHang + trailingHang) / 2 : -leadingHang;
      const spaces = segments.reduce((n, s) => n + (s.text.match(/ /g)?.length || 0), 0);
      const extra = alignment === 'justify' && !last && spaces ? Math.max(0, availableWidth - lineWidth + leadingHang + trailingHang) / spaces : 0;
      const positioned: StorySegment[] = [];
      for (const segment of segments) {
        // Split at spaces for explicit justification, shared by canvas and PDF.
        const parts = extra ? segment.text.split(/( )/) : [segment.text];
        let local = 0;
        for (const part of parts) {
          if (!part) continue;
          const w = measure(part, segment.style) + Array.from(part).length * segment.style.letterSpacingPt * PT;
          positioned.push({ text: part, width: w, style: segment.style,
            x: padding + column * (width + gutter) + inset + segment.x + local + shift });
          local += w;
          if (part === ' ') shift += extra;
        }
      }
      lines.push({ segments: positioned, y, height, start: lineStart, end: offset, column });
      y += height;
      consumed = offset;
      segments = []; lineWidth = 0; lineStart = offset; height = paragraphHeight;
      return true;
    };
    const cjk = !!style.cjkLineBreak;
    const tokens = cjk ? cjkRunTokens(paragraph.runs, (text, run) => {
      const resolved = resolveRunStyle(frame, style, run, characters);
      if (run.noteId) resolved.fontSizePt *= 0.7;
      return measure(text, resolved) + Array.from(text).length * resolved.letterSpacingPt * PT;
    }) : paragraph.runs.map(run => ({ run, text: run.text, groupWidth: undefined }));
    for (const item of tokens) {
      const run = item.run;
      const runStyle = resolveRunStyle(frame, style, run, characters);
      if (run.noteId) runStyle.fontSizePt *= 0.7;
      const renderedText = run.noteId ? item.text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit))) : item.text;
      // Keep ordinary words together; split overlong tokens by Unicode code point.
      for (let token of cjk ? [renderedText] : renderedText.match(/[^\S\n]+|\n|[^\s]+/gu) || []) {
        if (!prepare()) return { lines, consumed, overset: true };
        if (cjk && item.groupWidth !== undefined && token !== '\n') {
          if (lineWidth && lineWidth + item.groupWidth > availableWidth + 0.0001) {
            if (!flush(false) || !prepare()) return { lines, consumed, overset: true };
          }
          if (item.groupWidth > availableWidth + 0.0001) return { lines, consumed, overset: true };
        }
        if (token === '\n') {
          offset++;
          if (!flush(true)) return { lines, consumed, overset: true };
          continue;
        }
        const measured = (text: string) => measure(text, runStyle) + Array.from(text).length * runStyle.letterSpacingPt * PT;
        if (!cjk && style.hyphenate && /^\p{L}+$/u.test(token)) {
          while (measured(token) > availableWidth - lineWidth + 0.0001) {
            const syllables = hyphenateLanguage(token, style.language);
            let prefix = '', fitting = '';
            for (const part of syllables.slice(0, -1)) {
              prefix += part;
              if (measured(prefix + '-') <= availableWidth - lineWidth) fitting = prefix;
            }
            if (!fitting) {
              if (!lineWidth) break;
              if (!flush(false) || !prepare()) return { lines, consumed, overset: true };
              continue;
            }
            segments.push({ text: fitting + '-', x: lineWidth, width: measured(fitting + '-'), style: runStyle });
            lineWidth += measured(fitting + '-');
            offset += fitting.length;
            token = token.slice(fitting.length);
            if (!flush(false) || !prepare()) return { lines, consumed, overset: true };
          }
        }
        const tokenWidth = measured(token);
        if (run.noteId && tokenWidth > availableWidth) return { lines, consumed, overset: true };
        if (!cjk && lineWidth && lineWidth + tokenWidth > availableWidth && !/^\s+$/.test(token)) {
          if (!flush(false)) return { lines, consumed, overset: true };
          if (!prepare()) return { lines, consumed, overset: true };
        }
        const parts = !cjk && tokenWidth > availableWidth ? graphemes(token) : [token];
        for (const part of parts) {
          if (!prepare()) return { lines, consumed, overset: true };
          const w = measure(part, runStyle) + Array.from(part).length * runStyle.letterSpacingPt * PT;
          if (!cjk && lineWidth && lineWidth + w > availableWidth + 0.0001) {
            if (!flush(false)) return { lines, consumed, overset: true };
            if (!prepare()) return { lines, consumed, overset: true };
          }
          if (w > availableWidth + 0.0001 && !cjk) return { lines, consumed, overset: true };
          segments.push({ text: part, x: lineWidth, width: w, style: runStyle });
          lineWidth += w; offset += part.length;
          height = Math.max(height, runStyle.fontSizePt * PT * leading);
        }
      }
    }
    if (pi < paragraphs.length - 1) offset++;
    if (!flush(true)) return { lines, consumed, overset: true };
  }
  return { lines, consumed, overset: false };
}

/** Move breakpoints rather than changing manuscript text or inserting blank paragraphs. */
export function layoutStory(content: StoryContent, frame: TextElement, styles: ParagraphStyle[],
  characters: CharacterStyle[] = [], measure: StoryMeasure = measureStoryText,
  reserveBottom = 0, options: StoryLayoutOptions = {}) {
  return layoutStoryParagraphs(content.paragraphs, frame, styles, characters, measure, reserveBottom, options);
}

export function layoutStoryParagraphs(source: StoryParagraphs, frame: TextElement, styles: ParagraphStyle[],
  characters: CharacterStyle[] = [], measure: StoryMeasure = measureStoryText,
  reserveBottom = 0, options: StoryLayoutOptions = {}): { lines: StoryLine[]; consumed: number; overset: boolean } {
  const breaks = new Set<number>();
  const padding = frame.paddingMm ?? 2;
  const capacity = frame.height - padding * 2 - reserveBottom;
  let result = composeStory(source, frame, styles, characters, measure, reserveBottom, options, breaks);
  const paragraphs: { start: number; end: number; style: Partial<ParagraphStyle> }[] = [];
  const paragraphAt = (index: number) => {
    const existing = paragraphs[index];
    if (existing) return existing;
    const paragraph = source.at(index)!;
    const start = index ? paragraphs[index - 1].end + 1 : 0;
    const end = start + paragraph.runs.reduce((length, run) => length + run.text.length, 0);
    const entry = { start, end, style: resolveParagraphStyle(paragraph, styles) };
    paragraphs[index] = entry;
    return entry;
  };
  const counts = new Map<number, StoryLine[]>();
  const allLines = (index: number) => {
    if (!counts.has(index)) {
      const copy = { ...frame, columns: 1, splitColumns: 1, spanColumns: true,
        width: (frame.width - padding * 2 - ((frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns)) - 1) * frame.columnGutterMm) / (frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns)) + padding * 2,
        height: Math.max(100000, frame.height) };
      counts.set(index, composeStory([source.at(index)!], copy, styles, characters, measure).lines);
    }
    return counts.get(index)!;
  };
  // Each pass moves at least one breakpoint; the cap also bounds pathological keep chains.
  for (let pass = 0; pass < Math.min(128, source.length * 4 + 4); pass++) {
    let move: number | undefined;
    let lineIndex = 0;
    for (let index = 0; index < source.length && lineIndex < result.lines.length && move === undefined; index++) {
      const { start, end, style } = paragraphAt(index);
      const first = lineIndex;
      while (lineIndex < result.lines.length && result.lines[lineIndex].start <= end) lineIndex++;
      if (!style.keepTogether && !style.keepWithNext && !style.orphanLines && !style.widowLines) continue;
      const visible = result.lines.slice(first, lineIndex);
      if (!visible.length) continue;
      const full = allLines(index);
      const fullHeight = full.reduce((n, line) => n + line.height, 0);
      const groups = new Map<number, StoryLine[]>();
      for (const line of visible) {
        const column = line.column || 0;
        const group = groups.get(column);
        if (group) group.push(line);
        else groups.set(column, [line]);
      }
      const split = groups.size > 1 || result.consumed < end;
      if (style.keepTogether && split && fullHeight <= capacity && visible[0].y > padding + 0.001) move = start;
      let shown = 0;
      for (const group of groups.values()) {
        shown += group.length;
        const remaining = Math.max(0, full.length - shown);
        if (!remaining) continue;
        const orphans = Math.min(full.length, Math.max(1, style.orphanLines || 1));
        const widows = Math.min(full.length, Math.max(1, style.widowLines || 1));
        if (group.length < orphans && group[0].y > padding + 0.001) { move = group[0].start; break; }
        if (remaining < widows && group.length > 1) {
          const retain = group.length - (widows - remaining);
          const candidate = retain >= orphans ? group[retain] : group[0];
          if (candidate && (candidate.y > padding + 0.001)) { move = candidate.start; break; }
        }
      }
      if (style.keepWithNext && index + 1 < source.length && result.consumed >= end) {
        const last = visible.at(-1)!;
        const minimum = Math.max(1, paragraphAt(index + 1).style.orphanLines || 1);
        let next = 0;
        for (let n = lineIndex; n < result.lines.length && next < minimum; n++) {
          if (result.lines[n].column === last.column) next++;
        }
        if (next >= minimum) continue;
        const nextLines = allLines(index + 1).slice(0, minimum);
        if (fullHeight + nextLines.reduce((n, line) => n + line.height, 0) <= capacity && visible[0].y > padding + 0.001) move = start;
      }
    }
    if (move === undefined || breaks.has(move)) break;
    breaks.add(move);
    result = composeStory(source, frame, styles, characters, measure, reserveBottom, options, breaks);
  }
  return result;
}
