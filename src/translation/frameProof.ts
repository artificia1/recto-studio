import type { ProjectState, Spread, TextElement } from '../types';
import { layoutFrameNotes } from '../engine/publicationReferences';
import { layoutStory } from '../engine/storyLayout';
import { plainStory } from '../engine/storyContent';
import { publicationWrapObjects } from '../engine/publicationWrap';

interface FrameSource { frame: TextElement; spread: Spread; page: number }

export interface FrameProof {
  width: number;
  height: number;
  lines: ReturnType<typeof layoutStory>['lines'];
  notes: ReturnType<typeof layoutFrameNotes>;
  page: number;
  placed: number;
  remaining: number;
  overset: boolean;
  text: string;
  fontFamily: string;
  color: string;
  padding: number;
}

function textIndex(state: ProjectState) {
  const frames = new Map<string, FrameSource>();
  for (const spread of state.spreads) {
    const pages = new Map(spread.pages.map(page => [page.id, page.pageNumber]));
    for (const frame of spread.elements) if (frame.type === 'text' && !frame.pasteboard) {
      frames.set(frame.id, { frame, spread, page: pages.get(frame.pageId) || 1 });
    }
  }
  return frames;
}

function makeProof(state: ProjectState, { frame, spread, page }: FrameSource): FrameProof {
  const notes = layoutFrameNotes(state, frame);
  const content = frame.textContent || plainStory(frame.text, frame.paragraphStyleId);
  const layout = layoutStory(content, frame, state.paragraphStyles, state.characterStyles, undefined, notes.height,
    { obstacles: publicationWrapObjects(state, spread), baselineGrid: state.settings.baselineGrid });
  return {
    width: frame.width,
    height: frame.height,
    lines: layout.lines,
    notes,
    page,
    placed: layout.consumed,
    remaining: layout.overset ? Math.max(0, frame.text.length - layout.consumed) : 0,
    overset: layout.overset,
    text: frame.text,
    fontFamily: frame.fontFamily,
    color: frame.color,
    padding: frame.paddingMm ?? 2,
  };
}

export function createTranslationFrameProof(before: ProjectState, after: ProjectState, affected: ReadonlySet<string>) {
  const old = textIndex(before), current = textIndex(after);
  const included = new Set<string>();
  const follow = (frames: Map<string, FrameSource>, id: string) => {
    let source = frames.get(id);
    if (!source) return;
    const visited = new Set<string>();
    while (source?.frame.prevFrameId && !visited.has(source.frame.id)) {
      visited.add(source.frame.id);
      const previous = frames.get(source.frame.prevFrameId);
      if (!previous) break;
      source = previous;
    }
    visited.clear();
    while (source && !visited.has(source.frame.id)) {
      const frame: TextElement = source.frame;
      included.add(frame.id);
      visited.add(frame.id);
      source = frame.nextFrameId ? frames.get(frame.nextFrameId) : undefined;
    }
  };
  for (const id of affected) {
    follow(old, id);
    follow(current, id);
  }
  const list = [...included].map(id => {
    const entry = (current.get(id) || old.get(id))!;
    return { id, page: entry.page, label: entry.frame.name || entry.frame.text.trim().slice(0, 70) || 'Text continuation' };
  }).sort((a, b) => a.page - b.page);
  return {
    frames: list,
    compare(id: string) {
      if (!included.has(id)) return;
      const prior = old.get(id), revised = current.get(id);
      return { before: prior && makeProof(before, prior), after: revised && makeProof(after, revised) };
    },
  };
}
