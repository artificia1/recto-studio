import type { Footnote, ProjectState, StoryContent, StoryParagraph } from '../types';
import type { ImportedNote } from '../contentImport';
import { storyText } from './storyContent';

export interface ManuscriptChange {
  start: number;
  end: number;
  paragraphs: StoryParagraph[];
  conflict: boolean;
}

export function manuscriptEditRange(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (start === before.length && start === after.length) return null;
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  let suffix = 0;
  while (suffix < before.length - start && suffix < after.length - start &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(before[before.length - suffix])) suffix--;
  return { start, end: before.length - suffix, replacement: after.slice(start, after.length - suffix) };
}

/** Match unchanged paragraphs in order, comparing note bodies instead of import-local IDs. */
export function compareManuscripts(before: StoryContent, after: StoryContent, notes: Footnote[], incomingNotes: ImportedNote[], protectedParagraphs: Set<string> = new Set()): ManuscriptChange[] {
  const keys = (content: StoryContent, definitions: ImportedNote[]) => {
    const byId = new Map(definitions.map(note => [note.id, note]));
    return content.paragraphs.map(paragraph => {
      const parts: (string | ImportedNote | null)[] = [];
      let text = '';
      for (const run of paragraph.runs) {
        if (!run.noteId) { text += run.text; continue; }
        parts.push(text);
        const note = byId.get(run.noteId);
        parts.push(note ? { id: '', kind: note.kind, text: note.text } : null);
        text = '';
      }
      parts.push(text);
      return JSON.stringify(parts);
    });
  };
  const existing = keys(before, notes.map(note => ({ ...note, kind: note.kind || 'footnote' })));
  const revised = keys(after, incomingNotes);
  const positions = new Map<string, number[]>();
  revised.forEach((key, index) => {
    const matches = positions.get(key);
    if (matches) matches.push(index);
    else positions.set(key, [index]);
  });
  const anchors = manuscriptAnchors(existing, positions);
  const changes: ManuscriptChange[] = [];
  let start = 0, next = 0;
  const add = (end: number, until: number) => {
    if (start === end && next === until) return;
    changes.push({ start, end, paragraphs: after.paragraphs.slice(next, until),
      conflict: before.paragraphs.slice(start, end).some(paragraph =>
        (!!paragraph.id && protectedParagraphs.has(paragraph.id)) ||
        paragraph.runs.some(run => run.noteId || run.reference || run.indexId)) });
  };
  for (const anchor of anchors) {
    add(anchor.before, anchor.after);
    start = anchor.before + 1;
    next = anchor.after + 1;
  }
  add(existing.length, revised.length);
  return changes;
}

interface ParagraphAnchor { before: number; after: number; previous?: ParagraphAnchor }

function manuscriptAnchors(before: string[], positions: Map<string, number[]>): ParagraphAnchor[] {
  const firstAtOrAfter = <T,>(items: T[], index: number, position: (item: T) => number) => {
    let start = 0, end = items.length;
    while (start < end) {
      const middle = (start + end) >>> 1;
      if (position(items[middle]) < index) start = middle + 1;
      else end = middle;
    }
    return start;
  };
  const pairs = before.reduce((count, key) => count + (positions.get(key)?.length || 0), 0);
  if (pairs > 250000) {
    // Keep the comparison bounded for very large documents with repeated paragraphs.
    const anchors: ParagraphAnchor[] = [];
    let minimum = 0;
    before.forEach((key, index) => {
      const matches = positions.get(key) || [];
      const after = matches[firstAtOrAfter(matches, minimum, value => value)];
      if (after === undefined) return;
      anchors.push({ before: index, after });
      minimum = after + 1;
    });
    return anchors;
  }
  const tails: ParagraphAnchor[] = [];
  before.forEach((key, index) => {
    const matches = positions.get(key) || [];
    for (let candidate = matches.length - 1; candidate >= 0; candidate--) {
      const after = matches[candidate];
      const length = firstAtOrAfter(tails, after, anchor => anchor.after);
      if (tails[length]?.after !== after) tails[length] = { before: index, after, previous: tails[length - 1] };
    }
  });
  const anchors: ParagraphAnchor[] = [];
  for (let tail = tails.at(-1); tail; tail = tail.previous) anchors.push(tail);
  return anchors.reverse();
}

export function manuscriptParagraphText(paragraphs: StoryParagraph[]): string {
  return storyText({ version: 1, paragraphs });
}

export function assembleManuscriptUpdate(before: StoryContent, changes: ManuscriptChange[], selected: Set<number>, incomingNotes: ImportedNote[]) {
  const paragraphs: StoryParagraph[] = [];
  const notes: ImportedNote[] = [];
  const definitions = new Map(incomingNotes.map(note => [note.id, note]));
  let cursor = 0;
  changes.forEach((change, index) => {
    if (!selected.has(index)) return;
    paragraphs.push(...before.paragraphs.slice(cursor, change.start));
    const inserted = structuredClone(change.paragraphs);
    for (const paragraph of inserted) {
      delete paragraph.id;
      for (const run of paragraph.runs) if (run.noteId) {
        const note = definitions.get(run.noteId);
        if (!note) throw new Error('The revised manuscript has a note marker without a body.');
        run.noteId = `fn-${crypto.randomUUID()}`;
        notes.push({ ...note, id: run.noteId });
      }
    }
    paragraphs.push(...inserted);
    cursor = change.end;
  });
  paragraphs.push(...before.paragraphs.slice(cursor));
  return { content: { version: 1 as const, paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }] }, notes };
}

export function protectedHeadingIds(state: ProjectState): Set<string> {
  return new Set(state.spreads.flatMap(spread => spread.elements.flatMap(element =>
    element.type !== 'text' || element.generated ? [] : (element.storyContent?.paragraphs || []).flatMap(paragraph =>
      paragraph.runs.flatMap(run => run.reference?.targetParagraphId ? [run.reference.targetParagraphId] : [])))));
}
