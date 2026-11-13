import type { ProjectState, Spread } from '../types';
import { INITIAL_STATE } from '../state/defaults';
import { parseProject } from '../state/projectValidation';
import { preparePortableArtwork } from './reusableArtwork';

export const SAVED_LAYOUTS_KEY = 'recto-spread-layouts-v1';
const MAX_LAYOUTS = 24;
const MAX_STORAGE_CHARS = 3 * 1024 * 1024;
const FILE_FORMAT = 'recto-spread-layout';
export const SAVED_LAYOUT_FILE_LIMIT = MAX_STORAGE_CHARS;

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

export function exportSavedSpreadLayout(layout: SavedSpreadLayout): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, layout });
}

export function importSavedSpreadLayout(json: string): SavedSpreadLayout {
  if (json.length > MAX_STORAGE_CHARS) throw new Error('Choose a layout file smaller than 3 MB.');
  const file = JSON.parse(json);
  if (file?.format !== FILE_FORMAT || file.version !== 1 || !isSavedLayout(file.layout)) {
    throw new Error('Choose a supported Recto layout file.');
  }
  const layout: SavedSpreadLayout = file.layout;
  // Validate and detach document-specific links using the same checks as insertion.
  const spread = instantiateSpreadLayout(layout);
  return { ...layout, id: crypto.randomUUID(), name: layout.name.trim(), spread };
}

function isSavedLayout(item: unknown): item is SavedSpreadLayout {
  if (!item || typeof item !== 'object') return false;
  const layout = item as SavedSpreadLayout;
  return typeof layout.id === 'string' && typeof layout.name === 'string' && !!layout.name.trim() &&
    layout.name.trim().length <= 100 && Number.isFinite(layout.size?.width) && layout.size.width > 0 &&
    Number.isFinite(layout.size?.height) && layout.size.height > 0 && Array.isArray(layout.spread?.pages) &&
    layout.spread.pages.length > 0 && Array.isArray(layout.spread?.elements) && layout.spread.elements.length > 0;
}

export function readSavedSpreadLayouts(): SavedSpreadLayout[] {
  try {
    const raw = localStorage.getItem(SAVED_LAYOUTS_KEY);
    if (!raw || raw.length > MAX_STORAGE_CHARS) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.slice(0, MAX_LAYOUTS).filter(isSavedLayout);
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
