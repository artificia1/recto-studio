import type { ProjectState, StoryRun } from '../types';
import { publicationCaptions } from './publicationCaptions';
import { contentOf, publicationHeadings, publicationSnapshot, storyHeads } from './publicationReferences';
import { applyEditionVisibility } from './publicationEditions';
import { sliceStory, storyText } from './storyContent';

export interface BookReference {
  key: string;
  chapterId: string;
  elementId: string;
  paragraphId?: string;
  format: 'page' | 'title' | 'caption';
}

export const bookReferenceKey = /^[a-z0-9][a-z0-9-]{0,63}$/;
const bookMarker = /\[\[book:([a-z0-9][a-z0-9-]{0,63})\]\]/g;

export function bookReferenceTargets(state: ProjectState) {
  const heads = new Map(storyHeads(state).map(head => [head.id, head]));
  const seenLegacyFrames = new Set<string>();
  return [
    ...publicationHeadings(state).filter(item => {
      if (item.paragraphId) return true;
      const head = heads.get(item.elementId);
      const firstLine = head && contentOf(head).paragraphs[0]?.runs.map(run => run.text).join('').trim();
      // Legacy references can only address the first paragraph of a frame.
      if (head?.pageId !== item.pageId || firstLine !== item.title || seenLegacyFrames.has(item.elementId)) return false;
      seenLegacyFrames.add(item.elementId);
      return true;
    }).map(item => ({
      elementId: item.elementId, paragraphId: item.paragraphId, title: item.title, caption: false,
    })),
    ...publicationCaptions(state).map(item => ({
      elementId: item.id, paragraphId: undefined, title: `${item.label} — ${item.title}`, caption: true,
    })),
  ];
}

export function hasBookReferenceTarget(targets: ReturnType<typeof bookReferenceTargets>,
  elementId: string, paragraphId: string | undefined, format: BookReference['format']): boolean {
  return targets.some(target => {
    if ((format === 'caption' && !target.caption) || (format === 'title' && target.caption)) return false;
    return paragraphId ? paragraphId === target.paragraphId : elementId === target.elementId && !target.paragraphId;
  });
}

export function resolveBookMarkers(state: ProjectState, references: Map<string, StoryRun['reference']>): ProjectState {
  const hasMarker = storyHeads(state).some(head => !head.generated && !head.pasteboard &&
    storyText(contentOf(head)).search(bookMarker) !== -1);
  if (!hasMarker) return state;
  applyEditionVisibility(state);
  const used = new Map<string, NonNullable<StoryRun['reference']>>();
  for (const head of storyHeads(state)) {
    if (head.generated || head.pasteboard) continue;
    const content = contentOf(head);
    let changed = false;
    const paragraphs = content.paragraphs.map(paragraph => {
      const text = paragraph.runs.map(run => run.text).join('');
      const markers = [...text.matchAll(bookMarker)];
      if (!markers.length) return paragraph;
      const original = { version: 1 as const, paragraphs: [paragraph] };
      const runs: StoryRun[] = [];
      let offset = 0;
      const annotations = paragraph.runs.flatMap(run => {
        const start = offset;
        offset += run.text.length;
        return run.noteId || run.reference || run.indexId ? [{ start, end: offset }] : [];
      });
      let cursor = 0;
      for (const marker of markers) {
        const key = marker[1];
        const reference = references.get(key);
        if (!reference) throw new Error(`Book reference “${key}” needs a target. Assign one before exporting.`);
        const start = marker.index!;
        const end = start + marker[0].length;
        if (annotations.some(range => range.start < end && start < range.end)) throw new Error(`Book marker “${key}” overlaps another manuscript annotation.`);
        const replaced = sliceStory(original, start, end).paragraphs[0].runs;
        runs.push(...sliceStory(original, cursor, start).paragraphs[0].runs.filter(run => run.text));
        runs.push({ ...replaced[0], text: '1', reference: { ...reference } });
        used.set(key, reference);
        cursor = end;
      }
      runs.push(...sliceStory(original, cursor, text.length).paragraphs[0].runs.filter(run => run.text));
      changed = true;
      return { ...paragraph, runs };
    });
    if (changed) {
      head.storyContent = { version: 1, paragraphs };
      head.rawStoryText = storyText(head.storyContent);
    }
  }
  if (!used.size) return state;
  const snapshot = publicationSnapshot(state);
  const targets = bookReferenceTargets(snapshot);
  for (const [key, ref] of used) {
    if (!hasBookReferenceTarget(targets, ref.targetElementId, ref.targetParagraphId, ref.format)) {
      throw new Error(`Book reference “${key}” points to a heading or caption missing from this edition. Update its target before exporting.`);
    }
  }
  return snapshot;
}
