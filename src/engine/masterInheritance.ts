import type { CanvasElement, MasterSpread, StoryContent } from '../types';
import { masterTargetPage } from './pageLabels';

/** Resolve page tokens on a copy, preserving the master source and run formatting. */
export function instantiateMasterItem(element: CanvasElement, pageId: string, evaluate: (text: string) => string): CanvasElement {
  if (element.type !== 'text') return { ...element, pageId };
  const content = (value: StoryContent): StoryContent => ({ ...value, paragraphs: value.paragraphs.map(paragraph => ({
    ...paragraph, runs: paragraph.runs.map(run => ({ ...run, text: evaluate(run.text) })),
  })) });
  const story = element.storyContent || element.textContent;
  return { ...element, pageId, text: evaluate(element.text),
    ...(story ? { textContent: content(story) } : {}),
  };
}

export function resolveMaster(masters: MasterSpread[], id?: string | null): MasterSpread | undefined {
  if (!id) return;
  const visiting = new Set<string>();
  const resolve = (key: string): MasterSpread => {
    if (visiting.size >= 64) throw new Error('Master inheritance exceeds 64 levels.');
    if (visiting.has(key)) throw new Error('Master inheritance contains a cycle.');
    const own = masters.find(master => master.id === key);
    if (!own) throw new Error('A parent master is missing.');
    visiting.add(key);
    const parent = own.parentMasterId ? resolve(own.parentMasterId) : undefined;
    const inherited = (parent?.elements || []).filter(element => !own.elements.some(local => local.masterSourceId === element.id))
      .flatMap(element => { const page = masterTargetPage(parent!.pages, own.pages, element.pageId); return page ? [{ ...element, pageId: page.id }] : []; });
    visiting.delete(key);
    return { ...own, elements: [...inherited.sort((a, b) => a.zIndex - b.zIndex), ...[...own.elements].sort((a, b) => a.zIndex - b.zIndex)].map((element, index) => ({ ...element, zIndex: index })) };
  };
  return resolve(id);
}

export function masterDependencies(masters: MasterSpread[], ids: (string | null | undefined)[]) {
  const result = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    resolveMaster(masters, id);
    let current = masters.find(master => master.id === id);
    while (current && !result.has(current.id)) { result.add(current.id); current = masters.find(master => master.id === current!.parentMasterId); }
  }
  return result;
}
