import { contentOf } from './publicationReferences';
import { selectionUnits } from './selectionGeometry';
import { storyText } from './storyContent';
import { INITIAL_STATE } from '../state/defaults';
import { parseProject } from '../state/projectValidation';
import type { CanvasElement, ProjectState } from '../types';

const FORMAT = 'recto-artwork-v1';
export const ARTWORK_FILE_LIMIT = 2 * 1024 * 1024;
export interface ReusableArtwork { format: typeof FORMAT; id: string; name: string; elements: CanvasElement[] }

export function preparePortableArtwork(element: CanvasElement) {
  if (element.anchor || element.conditionId || element.interactiveField || element.spotColor ||
    ((element.type === 'text' || element.type === 'table') && (element.nextFrameId || element.prevFrameId))) {
    throw new Error('Use independent artwork. Detach links, conditions, special inks, and form fields before saving.');
  }
  if (element.type === 'text') {
    if (element.generated || element.dataBinding || element.grepStyles?.length || element.paragraphStyleId ||
      contentOf(element).paragraphs.some(p => p.conditionId || p.styleId ||
        p.runs.some(run => run.noteId || run.indexId || run.reference || run.characterStyleId))) {
      throw new Error('Use standalone text with direct formatting. Resolve document styles, references and bindings first.');
    }
    delete element.storyId;
    delete element.autoExtendStory;
    delete element.autoPaginationError;
    delete element.textContent;
    delete element.storyStart;
    delete element.storyEnd;
    for (const paragraph of element.storyContent?.paragraphs || []) delete paragraph.id;
    if (element.storyContent) {
      element.textContent = structuredClone(element.storyContent);
      element.text = element.rawStoryText = storyText(element.storyContent);
    }
  }
  if (element.type === 'table') delete element.tableStoryId;
  if (element.type === 'image') {
    if (element.src && !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(element.src)) {
      throw new Error('Embed linked artwork as PNG, JPEG or WebP before saving it.');
    }
    delete element.assetId;
    delete element.proxySrc;
  }
  delete element.layerId;
  delete element.objectStyleId;
  delete element.masterSourceId;
  delete element.isOverridden;
  delete element.pasteboard;
  delete element.readingOrder;
  element.locked = false;
  return element;
}

export function parseReusableArtwork(json: string): ReusableArtwork {
  if (json.length > ARTWORK_FILE_LIMIT) throw new Error('Artwork files support up to 2 MiB.');
  const record = JSON.parse(json) as Partial<ReusableArtwork> | null;
  if (!record || record.format !== FORMAT || typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(record.id) ||
    typeof record.name !== 'string' || !record.name.trim() || record.name.length > 100 ||
    !Array.isArray(record.elements) || !record.elements.length || record.elements.length > 100) {
    throw new Error('Choose a Recto artwork file with 1–100 objects.');
  }
  const spread = { id: 'artwork-spread', spreadIndex: 0, pages: [{ id: 'artwork-page', pageNumber: 1, side: 'single' }], elements: record.elements };
  const state = parseProject(JSON.stringify({ settings: INITIAL_STATE.settings, spreads: [spread], masterSpreads: [] }), INITIAL_STATE);
  return { format: FORMAT, id: record.id, name: record.name.trim(), elements: state.spreads[0].elements.map(preparePortableArtwork) };
}

export function captureArtwork(state: ProjectState, name: string) {
  const units = selectionUnits(state);
  const spread = state.spreads[state.activeSpreadIndex];
  const selected = units.flatMap(unit => unit.members);
  if (!selected.length || selected.length > 100) throw new Error('Select 1–100 independent objects.');
  const left = Math.min(...units.map(unit => unit.left)), top = Math.min(...units.map(unit => unit.top));
  const layers = new Map(state.layers.map(layer => [layer.id, layer.order]));
  const elements = selected.sort((a, b) => (layers.get(a.layerId || '') || 0) - (layers.get(b.layerId || '') || 0) || a.zIndex - b.zIndex)
    .map(source => ({
      ...structuredClone(source), pageId: 'artwork-page',
      x: source.x + spread.pages.findIndex(page => page.id === source.pageId) * state.settings.widthMm - left,
      y: source.y - top,
    }));
  return parseReusableArtwork(JSON.stringify({ format: FORMAT, id: crypto.randomUUID(), name, elements }));
}

export function instantiateArtwork(record: ReusableArtwork, x: number, y: number): CanvasElement[] {
  const groups = new Map<string, string>();
  return record.elements.map(source => {
    const element = structuredClone(source);
    element.id = 'artwork-' + crypto.randomUUID();
    element.x += x;
    element.y += y;
    if (element.groupId) {
      const id = groups.get(element.groupId) || 'group-' + crypto.randomUUID();
      groups.set(element.groupId, id);
      element.groupId = id;
    }
    return element;
  });
}
