import type { OpenTypeFeatures, GrepStyleRule } from '../types';

export function formatOpenTypeText(str: string, features?: OpenTypeFeatures): string {
  if (!features || !str) return str;
  let res = str;
  if (features.fractions) {
    res = res
      .replace(/\b1\/2\b/g, '½')
      .replace(/\b1\/4\b/g, '¼')
      .replace(/\b3\/4\b/g, '¾')
      .replace(/\b1\/3\b/g, '⅓')
      .replace(/\b2\/3\b/g, '⅔')
      .replace(/\b1\/8\b/g, '⅛')
      .replace(/\b3\/8\b/g, '⅜')
      .replace(/\b5\/8\b/g, '⅝')
      .replace(/\b7\/8\b/g, '⅞');
  }
  if (features.ligatures) {
    res = res
      .replace(/ffi/g, 'ﬃ')
      .replace(/ffl/g, 'ﬄ')
      .replace(/fi/g, 'ﬁ')
      .replace(/fl/g, 'ﬂ')
      .replace(/ff/g, 'ﬀ');
  }
  return res;
}

export interface TextRunSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

/**
 * Splits a text line into styled runs according to active GREP rules.
 */
export function segmentTextWithGrep(
  lineText: string,
  grepRules?: GrepStyleRule[],
  defaultColor?: string
): TextRunSegment[] {
  if (!grepRules || grepRules.length === 0 || !lineText) {
    return [{ text: lineText, color: defaultColor }];
  }

  const matches: { start: number; end: number; rule: GrepStyleRule }[] = [];
  for (const rule of grepRules) {
    if (!rule.pattern) continue;
    try {
      const rx = new RegExp(rule.pattern, 'g');
      let m: RegExpExecArray | null;
      while ((m = rx.exec(lineText)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, rule });
        if (m.index === rx.lastIndex) rx.lastIndex++;
      }
    } catch {
      // Ignore malformed regex
    }
  }

  if (matches.length === 0) {
    return [{ text: lineText, color: defaultColor }];
  }

  matches.sort((a, b) => a.start - b.start);

  const segments: TextRunSegment[] = [];
  let curr = 0;
  for (const m of matches) {
    if (m.start > curr) {
      segments.push({ text: lineText.slice(curr, m.start), color: defaultColor });
    }
    if (m.end > curr) {
      const start = Math.max(curr, m.start);
      segments.push({
        text: lineText.slice(start, m.end),
        bold: m.rule.bold,
        italic: m.rule.italic,
        color: m.rule.color || defaultColor,
      });
      curr = m.end;
    }
  }
  if (curr < lineText.length) {
    segments.push({ text: lineText.slice(curr), color: defaultColor });
  }

  return segments;
}
