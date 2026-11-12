import type { ProjectState, Spread } from '../types';
import { INITIAL_STATE } from '../state/defaults';
import { parseProject } from '../state/projectValidation';
import { preparePortableArtwork } from './reusableArtwork';

export const SAVED_LAYOUTS_KEY = 'recto-spread-layouts-v1';
const MAX_LAYOUTS = 24;
const MAX_STORAGE_CHARS = 3 * 1024 * 1024;

export interface SavedSpreadLayout {
  id: string;
  name: string;
  size: { width: number; height: number };
  spread: Spread;
}

export function captureSpreadLayout(state: ProjectState, name: string): SavedSpreadLayout {
  name = name.trim();
  if (!name || name.length > 100) throw new Error('Enter a layout name of 1–100 characters.');
  const source = state.spreads[state.activeSpreadIndex];
  const spread = structuredClone(source);
  const layers = new Map(state.layers.map(layer => [layer.id, layer]));
  const layerOrder = (id?: string) => (id ? layers.get(id)?.order : undefined) ?? 0;
  spread.elements = spread.elements.filter(element => !element.pasteboard && (!element.layerId || layers.get(element.layerId)?.visible !== false))
    .sort((a, b) => layerOrder(a.layerId) - layerOrder(b.layerId) || a.zIndex - b.zIndex);
  if (!spread.elements.length) throw new Error('Place an object on a visible layer before saving the spread.');
  const ids = new Set(spread.elements.map(element => element.id));
  if (state.settings.footnotes?.some(note => note.elementId && ids.has(note.elementId))) {
    throw new Error('Remove document footnotes from the spread before saving it as a layout.');
  }
  spread.elements = spread.elements.map((element, index) => {
    if (element.type === 'text' && element.captionForId) throw new Error('Detach linked captions before saving the spread.');
    return preparePortableArtwork({ ...element, zIndex: index });
  });
  delete spread.masterSpreadId;
  delete spread.detachedMasterElementIds;
  spread.pages.forEach(page => { delete page.section; });
  return { id: crypto.randomUUID(), name, size: { width: state.settings.widthMm, height: state.settings.heightMm }, spread };
}

/** The normal template insertion remaps pages and frames. Remap groups too. */
export function instantiateSpreadLayout(layout: SavedSpreadLayout): Spread {
  const { width, height } = layout.size;
  const source = parseProject(JSON.stringify({
    settings: { ...INITIAL_STATE.settings, widthMm: width, heightMm: height },
    spreads: [layout.spread], masterSpreads: [],
  }), INITIAL_STATE).spreads[0];
  const groups = new Map<string, string>();
  for (const element of source.elements) {
    preparePortableArtwork(element);
    if (element.groupId) {
      if (!groups.has(element.groupId)) groups.set(element.groupId, crypto.randomUUID());
      element.groupId = groups.get(element.groupId)!;
    }
  }
  return source;
}

export function readSavedSpreadLayouts(): SavedSpreadLayout[] {
  try {
    const raw = localStorage.getItem(SAVED_LAYOUTS_KEY);
    if (!raw || raw.length > MAX_STORAGE_CHARS) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.slice(0, MAX_LAYOUTS).filter((item): item is SavedSpreadLayout =>
      item && typeof item.id === 'string' && typeof item.name === 'string' &&
      Number.isFinite(item.size?.width) && item.size.width > 0 &&
      Number.isFinite(item.size?.height) && item.size.height > 0 && Array.isArray(item.spread?.pages) &&
      Array.isArray(item.spread?.elements));
  } catch { return []; }
}

export function writeSavedSpreadLayouts(layouts: SavedSpreadLayout[]) {
  const json = JSON.stringify(layouts);
  if (layouts.length > MAX_LAYOUTS || json.length > MAX_STORAGE_CHARS) {
    throw new Error('The saved-layout library is full. Remove a layout or reduce the size of its images.');
  }
  try { localStorage.setItem(SAVED_LAYOUTS_KEY, json); }
  catch { throw new Error('This device could not store the layout. Make room in the local library and try again.'); }
}
