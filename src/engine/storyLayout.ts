import type { CanvasElement, CharacterStyle, ParagraphStyle, StoryContent, StoryParagraph, StoryRun, TextElement, TextFormatting } from '../types';
import { fontManager } from '../fontManager';

export interface RunStyle extends TextFormatting {
  fontFamily: string;
  fontSizePt: number;
  color: string;
  letterSpacingPt: number;
}
export interface StorySegment { text: string; x: number; width: number; style: RunStyle }
export interface StoryLine { segments: StorySegment[]; y: number; height: number; start: number; end: number }
export type StoryMeasure = (text: string, style: RunStyle) => number;
export interface StoryLayoutOptions {
  obstacles?: CanvasElement[];
  baselineGrid?: { enabled: boolean; startMm: number; incrementPt: number };
}
const PT = 25.4 / 72;
let context: CanvasRenderingContext2D | null | undefined;

export function canvasRunFont(style: RunStyle, scale: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSizePt * PT * scale}px ${style.fontFamily}`;
}

/** Measurements and layout are in millimetres, independent of canvas zoom. */
export const measureStoryText: StoryMeasure = (text, style) => {
  const font = fontManager.getFont(style.fontFamily);
  if (font) return font.layout(text).advanceWidth / font.unitsPerEm * style.fontSizePt * PT;
  if (context === undefined && typeof document !== 'undefined') {
    context = document.createElement('canvas').getContext('2d');
  }
  if (context) {
    context.font = canvasRunFont(style, 96 / 25.4);
    context.letterSpacing = '0px';
    return context.measureText(text).width * 25.4 / 96;
  }
  return Array.from(text).reduce((n, c) => n + (/\s/.test(c) ? 0.28 : /[ilI.,!]/.test(c) ? 0.27 : /[MW]/.test(c) ? 0.85 : 0.52), 0) * style.fontSizePt * PT;
};

export function resolveParagraphStyle(paragraph: StoryParagraph, styles: ParagraphStyle[]): Partial<ParagraphStyle> {
  return { ...styles.find(s => s.id === paragraph.styleId), ...paragraph.formatting };
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
export function layoutStory(content: StoryContent, frame: TextElement, styles: ParagraphStyle[],
  characters: CharacterStyle[] = [], measure: StoryMeasure = measureStoryText,
  reserveBottom = 0, options: StoryLayoutOptions = {}): { lines: StoryLine[]; consumed: number; overset: boolean } {
  const padding = frame.paddingMm ?? 2;
  const cols = frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns || 1);
  const gutter = frame.columnGutterMm ?? 4;
  const width = Math.max(0, (frame.width - padding * 2 - (cols - 1) * gutter) / cols);
  const bottom = frame.height - padding - reserveBottom;
  const lines: StoryLine[] = [];
  let column = 0, y = padding, offset = 0, consumed = 0;
  const total = content.paragraphs.reduce((n, p) => n + p.runs.reduce((m, r) => m + r.text.length, 0) + 1, -1);
  if (width <= 0 || bottom <= padding) return { lines, consumed, overset: total > 0 };

  for (let pi = 0; pi < content.paragraphs.length; pi++) {
    const paragraph = content.paragraphs[pi];
    const style = resolveParagraphStyle(paragraph, styles);
    const base = resolveRunStyle(frame, style, { text: '' }, characters);
    const leading = style?.lineHeight || frame.lineHeight || 1.3;
    const paragraphHeight = paragraph.runs.reduce((maximum, r) => Math.max(maximum, resolveRunStyle(frame, style, r, characters).fontSizePt), base.fontSizePt) * PT * leading;
    let segments: StorySegment[] = [], lineWidth = 0, height = paragraphHeight;
    let lineStart = offset;
    let availableWidth = width, inset = 0;
    const prepare = (): boolean => {
      if (segments.length) return true;
      for (;;) {
        const grid = options.baselineGrid;
        if ((style?.snapToBaseline ?? frame.snapToBaseline) && grid?.enabled) {
          const pitch = grid.incrementPt * PT;
          if (pitch > 0) y = grid.startMm - frame.y + Math.max(0, Math.ceil((frame.y + y - grid.startMm) / pitch - 0.00001)) * pitch;
        }
        if (y + height > bottom + 0.0001) { column++; y = padding; }
        if (column >= cols || y + height > bottom + 0.0001) return false;
        const left = frame.x + padding + column * (width + gutter);
        let a = 0, b = width;
        for (const obstacle of options.obstacles || []) {
          if (obstacle.id === frame.id || obstacle.pageId !== frame.pageId || !obstacle.textWrap || obstacle.textWrap.mode === 'none') continue;
          const gap = obstacle.textWrap.standoffMm;
          if (frame.y + y + height <= obstacle.y - gap || frame.y + y >= obstacle.y + obstacle.height + gap) continue;
          let min = obstacle.x - gap, max = obstacle.x + obstacle.width + gap;
          if (obstacle.textWrap.mode === 'contour' && obstacle.type === 'shape' && obstacle.shapeKind === 'ellipse') {
            const ry = (obstacle.height + gap * 2) / 2;
            const normalized = (frame.y + y + height / 2 - obstacle.y - obstacle.height / 2) / ry;
            const radius = (obstacle.width + gap * 2) / 2 * Math.sqrt(Math.max(0, 1 - normalized * normalized));
            min = obstacle.x + obstacle.width / 2 - radius; max = obstacle.x + obstacle.width / 2 + radius;
          }
          if (max <= left + a || min >= left + b) continue;
          if (min - (left + a) > left + b - max) b = Math.max(a, min - left);
          else a = Math.min(b, max - left);
        }
        inset = a; availableWidth = b - a;
        if (availableWidth > 1) return true;
        y += height;
      }
    };
    const flush = (last: boolean): boolean => {
      if (!prepare()) return false;
      const alignment = style?.alignment || frame.alignment;
      let shift = alignment === 'right' ? availableWidth - lineWidth : alignment === 'center' ? (availableWidth - lineWidth) / 2 : 0;
      const spaces = segments.reduce((n, s) => n + (s.text.match(/ /g)?.length || 0), 0);
      const extra = alignment === 'justify' && !last && spaces ? Math.max(0, availableWidth - lineWidth) / spaces : 0;
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
      lines.push({ segments: positioned, y, height, start: lineStart, end: offset });
      y += height;
      consumed = offset;
      segments = []; lineWidth = 0; lineStart = offset; height = paragraphHeight;
      return true;
    };
    for (const run of paragraph.runs) {
      const runStyle = resolveRunStyle(frame, style, run, characters);
      // Keep ordinary words together; split overlong tokens by Unicode code point.
      for (const token of run.text.match(/[^\S\n]+|\n|[^\s]+/gu) || []) {
        if (!prepare()) return { lines, consumed, overset: true };
        if (token === '\n') {
          offset++;
          if (!flush(true)) return { lines, consumed, overset: true };
          continue;
        }
        const tokenWidth = measure(token, runStyle) + Array.from(token).length * runStyle.letterSpacingPt * PT;
        if (lineWidth && lineWidth + tokenWidth > availableWidth && !/^\s+$/.test(token)) {
          if (!flush(false)) return { lines, consumed, overset: true };
          if (!prepare()) return { lines, consumed, overset: true };
        }
        const parts = tokenWidth > availableWidth ? Array.from(token) : [token];
        for (const part of parts) {
          if (!prepare()) return { lines, consumed, overset: true };
          const w = measure(part, runStyle) + Array.from(part).length * runStyle.letterSpacingPt * PT;
          if (lineWidth && lineWidth + w > availableWidth + 0.0001) {
            if (!flush(false)) return { lines, consumed, overset: true };
            if (!prepare()) return { lines, consumed, overset: true };
          }
          segments.push({ text: part, x: lineWidth, width: w, style: runStyle });
          lineWidth += w; offset += part.length;
          height = Math.max(height, runStyle.fontSizePt * PT * leading);
        }
      }
    }
    if (pi < content.paragraphs.length - 1) offset++;
    if (!flush(true)) return { lines, consumed, overset: true };
  }
  return { lines, consumed: Math.max(0, total), overset: false };
}
