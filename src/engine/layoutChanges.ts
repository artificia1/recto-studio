import type { ProjectState } from '../types';
import { contentOf, layoutFrameNotes, publicationSnapshot, storyHeads } from './publicationReferences';
import { layoutStory } from './storyLayout';
import { plainStory } from './storyContent';
import { publicationWrapObjects } from './publicationWrap';

interface Location {
  frameId: string;
  pageId: string;
  page: number;
}

interface Placement {
  label: string;
  locations: Location[];
}

export interface LayoutCapture {
  pageCount: number;
  trim: string;
  paragraphs: Map<string, Placement>;
  notes: Map<string, Placement>;
  overset: Map<string, Location>;
}

export function captureLayout(source: ProjectState): LayoutCapture {
  return captureComposedLayout(publicationSnapshot(source));
}

export function captureComposedLayout(state: ProjectState): LayoutCapture {
  const result: LayoutCapture = {
    pageCount: 0,
    trim: `${state.settings.widthMm} × ${state.settings.heightMm} mm`,
    paragraphs: new Map(),
    notes: new Map(),
    overset: new Map(),
  };
  const frames = new Map<string, { location: Location; start: number; end: number; next?: string }>();
  const noteLocations = new Map<string, Map<string, Location>>();
  const notes = new Map((state.settings.footnotes || []).map(note => [note.id, note]));
  for (const spread of state.spreads) {
    result.pageCount += spread.pages.length;
    const pages = new Map(spread.pages.map(page => [page.id, page]));
    const obstacles = publicationWrapObjects(state, spread);
    for (const frame of spread.elements) {
      if (frame.type !== 'text' || frame.pasteboard || !pages.has(frame.pageId)) continue;
      const location = { frameId: frame.id, pageId: frame.pageId, page: pages.get(frame.pageId)!.pageNumber };
      const start = frame.storyStart ?? 0;
      const footnotes = layoutFrameNotes(state, frame);
      let end = frame.storyEnd ?? (start + frame.text.length);
      if (!frame.nextFrameId) {
        const layout = layoutStory(frame.textContent || plainStory(frame.text, frame.paragraphStyleId), frame,
          state.paragraphStyles, state.characterStyles, undefined, footnotes.height,
          { obstacles, baselineGrid: state.settings.baselineGrid });
        if (layout.overset) {
          result.overset.set(frame.id, location);
          end = start + layout.consumed;
        }
      }
      frames.set(frame.id, { location, start, end, next: frame.nextFrameId });
      for (const { noteId } of footnotes.lines) {
        let placements = noteLocations.get(noteId);
        if (!placements) noteLocations.set(noteId, placements = new Map());
        placements.set(frame.id, location);
      }
    }
  }
  for (const [id, placements] of noteLocations) {
    const note = notes.get(id);
    if (note) result.notes.set(id, {
      label: `Footnote ${note.number} · ${note.text.slice(0, 90)}`,
      locations: [...placements.values()],
    });
  }

  for (const head of storyHeads(state)) {
    const chain: NonNullable<ReturnType<typeof frames.get>>[] = [];
    const visited = new Set<string>();
    let frame = frames.get(head.id);
    while (frame && !visited.has(frame.location.frameId)) {
      chain.push(frame);
      visited.add(frame.location.frameId);
      frame = frame.next ? frames.get(frame.next) : undefined;
    }
    if (!chain.length) continue;
    const paragraphs = contentOf(head).paragraphs;
    const texts = paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join(''));
    const frequencies = new Map<string, number>();
    for (const value of texts) frequencies.set(value, (frequencies.get(value) || 0) + 1);
    let offset = 0;
    let firstFrame = 0;
    for (const [index, paragraph] of paragraphs.entries()) {
      const text = texts[index];
      const end = offset + text.length;
      const identity = paragraph.id ? ['id', paragraph.id] : frequencies.get(text) === 1 ? ['text', text] : undefined;
      if (identity && text.trim()) {
        while (firstFrame < chain.length && chain[firstFrame].end <= offset) firstFrame++;
        const locations = [];
        for (let i = firstFrame; i < chain.length && chain[i].start < end; i++) {
          if (chain[i].end > offset && chain[i].end > chain[i].start) locations.push(chain[i].location);
        }
        result.paragraphs.set(JSON.stringify([head.id, ...identity]), { label: text.trim().slice(0, 100), locations });
      }
      offset = end + 1;
    }
  }
  return result;
}

function placementChanges(before: Map<string, Placement>, after: Map<string, Placement>, includeMissing: boolean) {
  const changes = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id), current = after.get(id);
    if (!includeMissing && (!old || !current)) continue;
    const from = old?.locations || [], to = current?.locations || [];
    if (from.length === to.length && from.every((location, index) =>
      location.frameId === to[index].frameId && location.pageId === to[index].pageId && location.page === to[index].page)) continue;
    changes.push({ id, label: (current || old)!.label, from, to });
  }
  return changes;
}

export function compareLayouts(before: LayoutCapture, after: LayoutCapture) {
  return {
    pagesBefore: before.pageCount,
    pagesAfter: after.pageCount,
    trimBefore: before.trim,
    trimAfter: after.trim,
    paragraphs: placementChanges(before.paragraphs, after.paragraphs, false),
    notes: placementChanges(before.notes, after.notes, true),
    newOverset: [...after.overset.values()].filter(item => !before.overset.has(item.frameId)),
    clearedOverset: [...before.overset.values()].filter(item => !after.overset.has(item.frameId)),
  };
}
