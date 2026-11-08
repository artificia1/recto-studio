import type { StoryRun } from '../types';

// A conservative horizontal subset of JLREQ's line-start/line-end restrictions.
const noStart = new Set(Array.from('、。，．・：；？！‼⁇⁈⁉）〕］｝〉》」』】〙〗〟’”｠»ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶー々〻ゝゞヽヾ'));
const noEnd = new Set(Array.from('（〔［｛〈《「『【〘〖〝‘“｟«'));
const asian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
type Segmenter = { segment(text: string): Iterable<{ segment: string }> };
const Constructor = (Intl as unknown as { Segmenter: new (locale?: string, options?: { granularity: string }) => Segmenter }).Segmenter;
const segmenter = Constructor ? new Constructor(undefined, { granularity: 'grapheme' }) : undefined;

export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), item => item.segment);
  // Older runtimes cannot safely promise grapheme-aware composition.
  throw new Error('This runtime needs Intl.Segmenter for Unicode text composition. Update the browser or desktop runtime.');
}

export function cjkGroups(text: string): string[] {
  const groups: string[] = [];
  let current = '', previous = '', previousNonSpace = '';
  for (const character of graphemes(text)) {
    const westernWord = previous && !asian.test(previous) && !asian.test(character) && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(character);
    const join = current && character !== '\n' && previous !== '\n' && (noStart.has(character) || noEnd.has(previous) || (noEnd.has(previousNonSpace) && /^\s+$/.test(previous)) || westernWord);
    if (noStart.has(character) && /^\s+$/.test(current) && !current.includes('\n') && groups.length && groups.at(-1) !== '\n') current = groups.pop()! + current;
    if (!join && current) { groups.push(current); current = ''; }
    current += character;
    previous = character;
    if (!/^\s+$/.test(character) || character === '\n') previousNonSpace = character;
  }
  if (current) groups.push(current);
  return groups;
}

/** Group widths include every styled run, so punctuation stays attached across style boundaries. */
export function cjkRunTokens(runs: StoryRun[], measure: (text: string, run: StoryRun) => number) {
  const groups = cjkGroups(runs.map(run => run.text).join(''));
  const tokens: { run: StoryRun; text: string; groupWidth?: number }[] = [];
  let runIndex = 0, runOffset = 0;
  for (const group of groups) {
    const parts: { run: StoryRun; text: string; groupWidth?: number }[] = [];
    let remaining = group.length;
    while (remaining && runIndex < runs.length) {
      const run = runs[runIndex], count = Math.min(remaining, run.text.length - runOffset);
      if (count) parts.push({ run, text: run.text.slice(runOffset, runOffset + count) });
      remaining -= count; runOffset += count;
      if (runOffset === run.text.length) { runIndex++; runOffset = 0; }
    }
    if (parts.length) parts[0].groupWidth = parts.reduce((width, part) => width + measure(part.text, part.run), 0);
    tokens.push(...parts);
  }
  return tokens;
}
