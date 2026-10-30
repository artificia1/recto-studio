import type { StoryContent, StoryParagraph, StoryRun, TextFormatting } from '../types';

export const storyText = (content: StoryContent): string =>
  content.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');

export function plainStory(text: string, styleId?: string): StoryContent {
  return { version: 1, paragraphs: text.split('\n').map(text => ({ styleId, runs: [{ text }] })) };
}

export function compactRuns(runs: StoryRun[]): StoryRun[] {
  const result: StoryRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const previous = result[result.length - 1];
    const { text: _a, ...a } = run;
    const { text: _b, ...b } = previous || { text: '' };
    if (previous && JSON.stringify(a) === JSON.stringify(b)) previous.text += run.text;
    else result.push({ ...run });
  }
  return result.length ? result : [{ text: '' }];
}

/** Offsets use UTF-16, matching textarea selectionStart/selectionEnd. */
export function sliceStory(content: StoryContent, start: number, end: number): StoryContent {
  const paragraphs: StoryParagraph[] = [];
  let offset = 0;
  for (const paragraph of content.paragraphs) {
    const length = paragraph.runs.reduce((n, r) => n + r.text.length, 0);
    if (offset <= end && offset + length >= start) {
      let runOffset = offset;
      const runs = paragraph.runs.flatMap(run => {
        const a = Math.max(0, start - runOffset);
        const b = Math.min(run.text.length, end - runOffset);
        runOffset += run.text.length;
        return b > a ? [{ ...run, text: run.text.slice(a, b) }] : [];
      });
      paragraphs.push({ ...paragraph, runs: compactRuns(runs) });
    }
    offset += length + 1;
  }
  return { version: 1, paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }] };
}

/** Replace one edit while retaining formatting outside the edit and at the insertion point. */
export function editStory(content: StoryContent, text: string): StoryContent {
  const before = storyText(content);
  let start = 0;
  while (start < before.length && start < text.length && before[start] === text[start]) start++;
  if (start === before.length && start === text.length) return content;
  // Never split a surrogate pair when calculating the edit boundary.
  if (start && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  let suffix = 0;
  while (suffix < before.length - start && suffix < text.length - start &&
    before[before.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(before[before.length - suffix])) suffix--;
  const left = sliceStory(content, 0, start).paragraphs;
  const right = sliceStory(content, before.length - suffix, before.length).paragraphs;
  const anchor = sliceStory(content, Math.max(0, start - 1), start).paragraphs.at(-1)!;
  const format = anchor.runs.at(-1) || { text: '' };
  const inserted = text.slice(start, text.length - suffix).split('\n');
  const result = left.slice(0, -1);
  let current = { ...left.at(-1)!, runs: [...left.at(-1)!.runs] };
  inserted.forEach((part, index) => {
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

export function formatStory(content: StoryContent, start: number, end: number,
  formatting: TextFormatting & { characterStyleId?: string }): StoryContent {
  let offset = 0;
  return { version: 1, paragraphs: content.paragraphs.map(paragraph => {
    const runs = compactRuns(paragraph.runs.flatMap(run => {
      const a = Math.max(0, start - offset);
      const b = Math.min(run.text.length, end - offset);
      offset += run.text.length;
      if (b <= a) return [{ ...run }];
      return [
        { ...run, text: run.text.slice(0, a) },
        { ...run, ...formatting, text: run.text.slice(a, b) },
        { ...run, text: run.text.slice(b) },
      ];
    }));
    offset++;
    return { ...paragraph, runs };
  }) };
}

export function styleStoryParagraphs(content: StoryContent, start: number, end: number, styleId: string): StoryContent {
  let offset = 0;
  return { version: 1, paragraphs: content.paragraphs.map(paragraph => {
    const length = paragraph.runs.reduce((n, r) => n + r.text.length, 0);
    const selected = start <= offset + length && (end === start ? end >= offset : end > offset);
    offset += length + 1;
    return selected ? { ...paragraph, styleId } : paragraph;
  }) };
}
