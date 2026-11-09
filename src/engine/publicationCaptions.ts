import type { CanvasElement, ProjectState, TextElement } from '../types';
import { pageLabel } from './pageLabels';

export const canCaption = (element?: CanvasElement | null) => !!element && (element.type === 'image' || (element.type === 'table' && !element.prevFrameId));

export interface PublicationCaption {
  id: string;
  kind: 'Figure' | 'Table';
  number: string;
  label: string;
  title: string;
  page: string;
  pageNumber: number;
}

export function publicationCaptions(state: ProjectState): PublicationCaption[] {
  const pages = state.spreads.flatMap(spread => spread.pages);
  const chapters = new Map<string, number>();
  let chapter = 1;
  pages.forEach((page, index) => { if (index && page.section) chapter++; chapters.set(page.id, chapter); });
  const hidden = new Set(state.layers.filter(layer => !layer.visible).map(layer => layer.id));
  const editions = new Set(state.conditions?.filter(condition => !condition.visible).map(condition => condition.id));
  const elements = state.spreads.flatMap(spread => spread.elements).filter(element =>
    !element.pasteboard && !element.editorialOnly && !hidden.has(element.layerId || '') && !editions.has(element.conditionId || ''));
  const byId = new Map(elements.map(element => [element.id, element]));
  const pageIndex = new Map(pages.map((page, index) => [page.id, index]));
  const captions = elements.flatMap(element => {
    if (element.type !== 'text' || element.generated?.kind !== 'caption') return [];
    const target = byId.get(element.captionForId || '');
    if (!target || !canCaption(target) || !pageIndex.has(target.pageId)) return [];
    return [{ frame: element, target, index: pageIndex.get(target.pageId)! }];
  }).sort((a, b) => a.index - b.index || a.target.y - b.target.y || a.target.x - b.target.x || a.target.zIndex - b.target.zIndex);
  const counters = new Map<string, number>();
  return captions.map(({ frame, target, index }) => {
    const kind = target.type === 'table' ? 'Table' : 'Figure';
    const chapter = chapters.get(target.pageId)!;
    const key = `${chapter}:${kind}`;
    const count = (counters.get(key) || 0) + 1; counters.set(key, count);
    const number = `${chapter}.${count}`;
    return { id: frame.id, kind, number, label: `${kind} ${number}`, title: (frame as TextElement).generated!.title,
      page: pageLabel(pages, frame.pageId).label, pageNumber: pages[index].pageNumber };
  });
}
