import type { CanvasElement, ProjectState, StoryContent } from '../types';
import { contentOf, reflowStoryState } from './publicationReferences';
import { storyText } from './storyContent';

export interface LayoutSnapshot { id: string; name: string; state: ProjectState }
export interface LayoutLink {
  id: string;
  sourceLayoutId: string;
  sourceElementId: string;
  targetLayoutId: string;
  targetElementId: string;
  lastTarget: string;
}
export interface LayoutBundle { version: 1; layouts: LayoutSnapshot[]; links: LayoutLink[] }
export const newLayoutBundle = (): LayoutBundle => ({ version: 1, layouts: [], links: [] });

export function linkableElements(layout?: LayoutSnapshot) {
  return layout?.state.spreads.flatMap(spread => spread.elements).filter(element =>
    !element.pasteboard && (element.type === 'image' || element.type === 'shape' ||
      (element.type === 'text' && !element.prevFrameId && !element.generated))) || [];
}

function linkedPayload(element: CanvasElement) {
  if (element.type === 'text') return contentOf(element);
  if (element.type === 'image') return { src: element.src, equation: element.equation, name: element.name, format: element.format,
    fileSize: element.fileSize, originalWidth: element.originalWidth, originalHeight: element.originalHeight };
  if (element.type === 'shape') return { shapeKind: element.shapeKind, fillColor: element.fillColor,
    strokeColor: element.strokeColor, strokeWidthMm: element.strokeWidthMm, fillGradient: element.fillGradient,
    decoration: element.decoration, strokePattern: element.strokePattern };
  throw new Error('This object type cannot be linked between layouts.');
}

async function contentDigest(element: CanvasElement) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(linkedPayload(element))));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function locate(bundle: LayoutBundle, layoutId: string, elementId: string) {
  const layout = bundle.layouts.find(item => item.id === layoutId);
  const element = linkableElements(layout).find(item => item.id === elementId);
  if (!layout || !element) throw new Error('A linked frame or layout is missing. Refresh its layout or detach the link.');
  return { layout, element };
}

export function readLayoutBundle(text: string, parse: (value: string) => ProjectState): LayoutBundle {
  const value = JSON.parse(text);
  if (!value || value.version !== 1 || !Array.isArray(value.layouts) || value.layouts.length > 24 ||
    !Array.isArray(value.links) || value.links.length > 500) throw new Error('Unsupported publication bundle.');
  const layouts: LayoutSnapshot[] = value.layouts.map((layout: LayoutSnapshot) => {
    if (!layout || typeof layout.id !== 'string' || !layout.id || typeof layout.name !== 'string' || !layout.name.trim()) {
      throw new Error('Invalid layout entry.');
    }
    return { id: layout.id, name: layout.name, state: parse(JSON.stringify(layout.state)) };
  });
  const links: LayoutLink[] = value.links;
  if (new Set(layouts.map(layout => layout.id)).size !== layouts.length ||
    links.some(link => !link || ![link.id, link.sourceLayoutId, link.sourceElementId, link.targetLayoutId, link.targetElementId].every(id => typeof id === 'string' && id.length) ||
      link.sourceLayoutId === link.targetLayoutId || typeof link.lastTarget !== 'string' || !/^[a-f0-9]{64}$/.test(link.lastTarget)) ||
    new Set(links.map(link => link.id)).size !== links.length ||
    new Set(links.map(link => JSON.stringify([link.targetLayoutId, link.targetElementId]))).size !== links.length ||
    links.some(link => links.some(other => link.sourceLayoutId === other.targetLayoutId && link.sourceElementId === other.targetElementId))) {
    throw new Error('Invalid publication links.');
  }
  return { version: 1, layouts, links };
}

export async function createLayoutLink(bundle: LayoutBundle, endpoints: Omit<LayoutLink, 'id' | 'lastTarget'>): Promise<LayoutLink> {
  const { sourceLayoutId, sourceElementId, targetLayoutId, targetElementId } = endpoints;
  if (bundle.links.length >= 500 || sourceLayoutId === targetLayoutId ||
    bundle.links.some(link => (link.targetLayoutId === targetLayoutId && link.targetElementId === targetElementId) ||
      (link.targetLayoutId === sourceLayoutId && link.targetElementId === sourceElementId) ||
      (link.sourceLayoutId === targetLayoutId && link.sourceElementId === targetElementId))) {
    throw new Error('Choose an independent source and an unlinked destination in another layout.');
  }
  const from = locate(bundle, sourceLayoutId, sourceElementId), to = locate(bundle, targetLayoutId, targetElementId);
  if (from.element.type !== to.element.type) throw new Error('Source and destination must have the same object type.');
  return { ...endpoints, id: crypto.randomUUID(), lastTarget: await contentDigest(to.element) };
}

export async function previewLayoutLink(bundle: LayoutBundle, link: LayoutLink) {
  const source = locate(bundle, link.sourceLayoutId, link.sourceElementId);
  const original = locate(bundle, link.targetLayoutId, link.targetElementId);
  const conflict = await contentDigest(original.element) !== link.lastTarget;
  const next = structuredClone(bundle);
  const destination = locate(next, link.targetLayoutId, link.targetElementId);
  const { element: from } = source, { element: to, layout } = destination;
  if (to.locked || layout.state.layers.find(layer => layer.id === to.layerId)?.locked) {
    throw new Error('Unlock the destination object and its layer first.');
  }
  if (from.type === 'text' && to.type === 'text') {
    const frames = new Map(layout.state.spreads.flatMap(spread => spread.elements.map(element => [element.id, element] as const)));
    const seen = new Set<string>();
    let frame: CanvasElement | undefined = to;
    while (frame?.type === 'text' && !seen.has(frame.id)) {
      if (frame.locked || layout.state.layers.find(layer => layer.id === frame!.layerId)?.locked) {
        throw new Error('Unlock all destination story frames before applying a linked update.');
      }
      seen.add(frame.id);
      frame = frame.nextFrameId ? frames.get(frame.nextFrameId) : undefined;
    }
    const content: StoryContent = structuredClone(contentOf(from));
    if (content.paragraphs.some(paragraph => paragraph.runs.some(run => run.noteId || run.reference || run.indexId) || paragraph.conditionId) ||
      contentOf(to).paragraphs.some(paragraph => paragraph.runs.some(run => run.noteId || run.reference || run.indexId))) {
      throw new Error('Resolve document-specific notes, references, index markers and editions before sharing this story.');
    }
    const paragraphNames = new Map(source.layout.state.paragraphStyles.map(style => [style.id, style.name]));
    const characterNames = new Map(source.layout.state.characterStyles?.map(style => [style.id, style.name]));
    for (const paragraph of content.paragraphs) {
      delete paragraph.id;
      paragraph.styleId = layout.state.paragraphStyles.find(style => style.name === paragraphNames.get(paragraph.styleId || from.paragraphStyleId || ''))?.id || to.paragraphStyleId;
      for (const run of paragraph.runs) if (run.characterStyleId) {
        run.characterStyleId = layout.state.characterStyles?.find(style => style.name === characterNames.get(run.characterStyleId!))?.id;
      }
    }
    to.storyContent = content;
    to.rawStoryText = storyText(content);
    reflowStoryState(layout.state, to.id);
  } else if (from.type === 'image' && to.type === 'image') {
    if (from.src && !from.src.startsWith('data:')) throw new Error('Embed the source artwork before sharing it.');
    Object.assign(to, structuredClone(linkedPayload(from)), { assetId: undefined, proxySrc: undefined, actualDpi: undefined,
      alphaContour: undefined, isPsd: undefined, psdLayers: undefined, activePsdLayerIds: undefined });
  } else if (from.type === 'shape' && to.type === 'shape') Object.assign(to, structuredClone(linkedPayload(from)));
  else throw new Error('Source and destination must have the same object type.');
  const updated = next.links.find(item => item.id === link.id);
  if (!updated) throw new Error('The link no longer exists.');
  updated.lastTarget = await contentDigest(to);
  const summarize = (element: CanvasElement) => element.type === 'text' ? storyText(contentOf(element)) :
    element.type === 'image' ? element.name || 'Embedded image' :
    element.type === 'shape' ? `${element.shapeKind} · ${element.fillColor} · ${element.strokeColor}` : element.id;
  return { next, conflict, changed: await contentDigest(original.element) !== updated.lastTarget,
    sourceName: source.layout.name, targetName: layout.name, before: summarize(original.element), after: summarize(to) };
}
