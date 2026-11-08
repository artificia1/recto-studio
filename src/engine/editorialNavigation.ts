import type { ProjectState, TextElement } from '../types';
import { pageLabel } from './pageLabels';
import { contentOf, publicationHeadings, storyHeads } from './publicationReferences';
import { storyText } from './storyContent';

export function editorialOutline(state: ProjectState, query = '') {
  const term = query.trim().toLocaleLowerCase();
  return publicationHeadings(state).filter(heading => !term || `${heading.title} ${heading.label}`.toLocaleLowerCase().includes(term));
}

export function editorialStories(state: ProjectState, query = '') {
  const pages = state.spreads.flatMap(spread => spread.pages);
  const frames = state.spreads.flatMap(spread => spread.elements).filter((element): element is TextElement => element.type === 'text');
  const byId = new Map(frames.map(frame => [frame.id, frame]));
  const term = query.trim().toLocaleLowerCase();
  return storyHeads(state).map(head => {
    const text = storyText(contentOf(head));
    const title = head.name?.trim() || text.trim().split('\n')[0]?.slice(0, 100) || 'Untitled story';
    let count = 1, frame = head;
    const seen = new Set([head.id]);
    while (frame.nextFrameId && !seen.has(frame.nextFrameId)) {
      const next = byId.get(frame.nextFrameId);
      if (!next) break;
      frame = next; seen.add(frame.id); count++;
    }
    const label = pageLabel(pages, head.pageId).label;
    return { id: head.id, title, label, frames: count,
      words: text.trim() ? text.trim().split(/\s+/u).length : 0,
      generated: head.generated?.kind, text };
  }).filter(story => !term || `${story.title} ${story.text} ${story.label}`.toLocaleLowerCase().includes(term));
}

/** Exact physical number or printed label. Duplicate section labels remain selectable. */
export function findPublicationPages(state: ProjectState, query: string) {
  const pages = state.spreads.flatMap(spread => spread.pages);
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return state.spreads.flatMap((spread, spreadIndex) => spread.pages.map(page => ({
    ...page, spreadIndex, label: pageLabel(pages, page.id).label,
  }))).filter(page => String(page.pageNumber) === term || page.label.toLocaleLowerCase() === term);
}
