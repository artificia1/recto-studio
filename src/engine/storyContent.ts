import type { StoryContent, StoryParagraph, StoryRun, TextFormatting } from '../types';

export const storyText = (content: StoryContent): string =>
  content.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');

/** Partial edits detach atomic references instead of duplicating their identity. */
function cutRun(run: StoryRun, start: number, end: number): StoryRun {
  const result = { ...run, text: run.text.slice(start, end) };
  if (start !== 0 || end !== run.text.length) { delete result.noteId; delete result.reference; delete result.indexId; }
  return result;
}

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

function sliceParagraph(paragraph: StoryParagraph, start: number, end: number): StoryParagraph {
  let offset = 0;
  const runs = paragraph.runs.flatMap(run => {
    const a = Math.max(0, start - offset);
    const b = Math.min(run.text.length, end - offset);
    offset += run.text.length;
    return b > a ? [cutRun(run, a, b)] : [];
  });
  return { ...paragraph, runs: compactRuns(runs) };
}

/** Offsets use UTF-16, matching textarea selectionStart/selectionEnd. */
export function sliceStory(content: StoryContent, start: number, end: number): StoryContent {
  const paragraphs: StoryParagraph[] = [];
  let offset = 0;
  for (const paragraph of content.paragraphs) {
    const length = paragraph.runs.reduce((n, r) => n + r.text.length, 0);
    if (offset <= end && offset + length >= start) {
      paragraphs.push(sliceParagraph(paragraph, start - offset, end - offset));
    }
    offset += length + 1;
    if (offset > end) break;
  }
  return { version: 1, paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }] };
}

/** Index paragraph positions once for a threaded layout pass. */
export function indexStory(content: StoryContent) {
  let offset = 0;
  const positions = content.paragraphs.map(paragraph => {
    const start = offset;
    const end = start + paragraph.runs.reduce((length, run) => length + run.text.length, 0);
    offset = end + 1;
    return { start, end };
  });
  const full = content.paragraphs.map(paragraph => sliceParagraph(paragraph, 0, Infinity));

  const firstParagraphAt = (start: number) => {
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (positions[mid].end < start) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const slice = (start: number, end: number): StoryContent => {
    const paragraphs: StoryParagraph[] = [];
    for (let index = firstParagraphAt(start); index < positions.length && positions[index].start <= end; index++) {
      const bounds = positions[index];
      // Full slices share immutable copies. Slice boundary paragraphs from the
      // original runs to preserve marker identity and offsets.
      paragraphs.push(start <= bounds.start && end >= bounds.end ? full[index]
        : sliceParagraph(content.paragraphs[index], start - bounds.start, end - bounds.start));
    }
    return { version: 1, paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }] };
  };

  const from = (start: number): Pick<StoryParagraph[], 'length' | 'at'> => {
    const index = firstParagraphAt(start);
    if (index === full.length) return [{ runs: [{ text: '' }] }];
    const first = start <= positions[index].start ? full[index]
      : sliceParagraph(content.paragraphs[index], start - positions[index].start, Infinity);
    return { length: full.length - index, at: offset => offset === 0 ? first : full[index + offset] };
  };

  return { slice, from };
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
  const { noteId: _note, reference: _reference, indexId: _index, ...format } = anchor.runs.at(-1) || { text: '' };
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
      if (run.noteId || run.reference) return [{ ...run, ...formatting }];
      const left = cutRun(run, 0, a), middle = { ...cutRun(run, a, b), ...formatting }, right = cutRun(run, b, run.text.length);
      if (run.indexId) (a > 0 ? left : middle).indexId = run.indexId;
      return [
        left, middle, right,
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
