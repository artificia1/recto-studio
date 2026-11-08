import type { StoryContent, StoryRevision, StoryRun } from '../types';
import { compactRuns, sliceStory, storyText } from './storyContent';

/** Apply an explicit UTF-16 range, retaining formatting and identity outside it. */
export function revisedStory(before: StoryContent, start: number, end: number, replacement: string): StoryContent {
  const text = storyText(before);
  if (text.length > 200000 || replacement.length > 200000) throw new Error('Revision review supports stories and replacements up to 200,000 characters.');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) throw new Error('Select a valid manuscript range.');
  if (text.length - (end - start) + replacement.length > 200000) throw new Error('The revised manuscript exceeds 200,000 characters.');
  for (const position of [start, end]) if (position && /[\uD800-\uDBFF]/.test(text[position - 1]) && /[\uDC00-\uDFFF]/.test(text[position] || '')) throw new Error('Select whole characters.');
  let offset = 0;
  for (const paragraph of before.paragraphs) {
    for (const run of paragraph.runs) {
      const limit = offset + run.text.length;
      if ((run.noteId || run.reference || run.indexId) && ((start < limit && end > offset) || (start === end && start > offset && start < limit))) throw new Error('Keep note, reference and index markers outside a proposed edit.');
      offset = limit;
    }
    offset++;
  }
  const left = sliceStory(before, 0, start).paragraphs;
  const right = sliceStory(before, end, text.length).paragraphs;
  const insertion = sliceStory(before, start, Math.min(start + 1, text.length)).paragraphs[0];
  const { text: _text, noteId: _note, reference: _ref, indexId: _index, ...format } = insertion.runs[0] || {} as StoryRun;
  const parts = replacement.split('\n');
  const middle = parts.map((part, index) => ({ ...insertion, ...(index ? { id: undefined } : {}), runs: [{ ...format, text: part }] }));
  middle[0] = { ...left.at(-1)!, runs: [...left.at(-1)!.runs, ...middle[0].runs] };
  middle[middle.length - 1].runs.push(...right[0].runs);
  return { version: 1, paragraphs: [...left.slice(0, -1), ...middle, ...right.slice(1)].map(paragraph => ({ ...paragraph, runs: compactRuns(paragraph.runs) })) };
}

export function revisionIsStale(revision: StoryRevision, current: StoryContent): boolean {
  return JSON.stringify(revision.before) !== JSON.stringify(current);
}
