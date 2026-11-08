import type { CanvasElement, ProjectState } from '../types';
export const primaryFont = (family: string) => family.split(',')[0].trim().replace(/['"]/g, '').toLocaleLowerCase();

export function elementUsesFont(state: ProjectState, element: CanvasElement, family: string) {
  const matches = (value?: string) => !!value && primaryFont(value) === primaryFont(family);
  if (element.type === 'path') return matches(element.textOnPath?.fontFamily);
  if (element.type !== 'text' && element.type !== 'table') return false;
  if (matches(element.fontFamily)) return true;
  if (element.type === 'table') return false;
  const paragraphFont = (id?: string) => state.paragraphStyles.find(style => style.id === id)?.fontFamily;
  if (matches(paragraphFont(element.paragraphStyleId))) return true;
  for (const content of [element.storyContent, element.textContent]) for (const paragraph of content?.paragraphs || []) {
    if (matches(paragraph.formatting?.fontFamily) || matches(paragraphFont(paragraph.styleId))) return true;
    for (const run of paragraph.runs) if (matches(run.fontFamily) || matches(state.characterStyles?.find(style => style.id === run.characterStyleId)?.fontFamily)) return true;
  }
  return matches(state.settings.footnoteSettings?.fontFamily) && !!state.settings.footnotes?.some(note => note.elementId === element.id);
}

/** Visits authoring font choices, not embedded binary identities. */
export function visitDocumentFonts(state: ProjectState, visit: (owner: { fontFamily?: string }) => void) {
  state.paragraphStyles.forEach(visit); state.characterStyles?.forEach(visit);
  if (state.settings.footnoteSettings) visit(state.settings.footnoteSettings);
  for (const element of [...state.spreads.flatMap(spread => spread.elements), ...state.masterSpreads.flatMap(master => master.elements)]) {
    if (element.type === 'text' || element.type === 'table') visit(element);
    if (element.type === 'path' && element.textOnPath) visit(element.textOnPath);
    if (element.type === 'text') for (const content of [element.storyContent, element.textContent]) {
      for (const paragraph of content?.paragraphs || []) { if (paragraph.formatting) visit(paragraph.formatting); paragraph.runs.forEach(visit); }
    }
  }
}
export function documentFontUsage(state: ProjectState) {
  const usages = new Map<string, { family: string; count: number }>();
  visitDocumentFonts(state, owner => {
    if (!owner.fontFamily) return;
    const key = primaryFont(owner.fontFamily), entry = usages.get(key) || { family: owner.fontFamily, count: 0 };
    entry.count++; usages.set(key, entry);
  });
  return [...usages.values()].sort((a, b) => a.family.localeCompare(b.family));
}
