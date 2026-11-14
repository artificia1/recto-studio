import type { CanvasElement, FontAsset, ProjectState, StoryContent, TextElement } from '../types';
import { fontManager } from '../fontManager';
import { reflowStoryState, storyHeads, type StoryLayoutState } from './publicationReferences';
import { publicationWrapObjects } from './publicationWrap';
import { measureStoryText, resolveParagraphStyle, resolveRunStyle, type RunStyle } from './storyLayout';
import { editStory } from './storyContent';

interface FontProbe {
  style: RunStyle;
  widths: number[];
}

export type ComposedFrame = Pick<TextElement, 'id' | 'text' | 'textContent' | 'storyStart' | 'storyEnd'>;
export interface StoryComposition {
  content: StoryContent;
  rawText: string;
  frames: ComposedFrame[];
}

export interface StoryCompositionRequest {
  headId: string;
  before: StoryContent;
  nextText: string;
  layout: StoryLayoutState;
  wrap: Record<string, CanvasElement[]>;
  fonts: FontAsset[];
  probes: FontProbe[];
  paragraphIds: string[];
}

const measurementSamples = ['Hamburgefonts 0123456789 ffi AV', 'éЯای漢字かな한글 ภาษาไทย 😀', '.,-: “ ”'];

export function prepareStoryComposition(state: ProjectState, head: TextElement, nextText: string): StoryCompositionRequest | null {
  if (!head.nextFrameId || !head.storyContent || head.generated || head.autoExtendStory ||
    state.settings.footnotes?.length || Math.max(nextText.length, head.rawStoryText?.length || 0) < 8000) return null;

  const byId = new Map<string, TextElement>();
  for (const spread of state.spreads) for (const frame of spread.elements) if (frame.type === 'text') byId.set(frame.id, frame);
  const ids = new Set<string>();
  const frames: TextElement[] = [];
  for (let frame: TextElement | undefined = head; frame && !ids.has(frame.id); frame = byId.get(frame.nextFrameId || '')) {
    ids.add(frame.id);
    frames.push(frame);
  }
  if (frames.length < 2) return null;

  const { baselineGrid } = state.settings;
  const { paragraphStyles, characterStyles } = state;
  const wrap = Object.create(null) as StoryCompositionRequest['wrap'];
  const spreads = state.spreads.flatMap(spread => {
    const elements = spread.elements.filter((frame): frame is TextElement => ids.has(frame.id) && frame.type === 'text');
    if (!elements.length) return [];
    wrap[spread.id] = publicationWrapObjects(state, spread).map(element =>
      element.type === 'image' ? { ...element, src: '', proxySrc: undefined } : element);
    return [{ id: spread.id, spreadIndex: spread.spreadIndex, pages: [], elements: elements.map(frame => ({
      ...frame, text: '', storyContent: undefined, textContent: undefined, rawStoryText: undefined,
    })) }];
  });

  // Probe each effective face. Fonts available only in the document's CSS may have
  // different metrics in the worker, in which case the editor uses its regular composer.
  const fonts = new Map<string, FontAsset>();
  const probes = new Map<string, FontProbe>();
  const defaults = new Map(frames.map(frame => [frame.fontFamily, frame]));
  const addProbe = (style: RunStyle) => {
    const asset = fontManager.getFontAsset(style.fontFamily);
    if (asset) { fonts.set(asset.family, asset); return; }
    const key = JSON.stringify([style.fontFamily, !!style.bold, !!style.italic]);
    if (probes.has(key)) return;
    const probeStyle = { ...style, fontSizePt: 12 };
    probes.set(key, { style: probeStyle, widths: measurementSamples.map(text => measureStoryText(text, probeStyle)) });
  };
  for (const paragraph of head.storyContent.paragraphs) {
    const style = resolveParagraphStyle(paragraph, paragraphStyles);
    for (const run of paragraph.runs) {
      const first = resolveRunStyle(head, style, run, characterStyles || []);
      addProbe(first);
      if (!style.fontFamily && !run.fontFamily && !characterStyles?.find(item => item.id === run.characterStyleId)?.fontFamily) {
        for (const frame of defaults.values()) addProbe({ ...first, fontFamily: frame.fontFamily });
      }
    }
  }
  if (probes.size > 64) return null;

  const paragraphIds = storyHeads(state).filter(frame => frame.id !== head.id).flatMap(frame =>
    frame.storyContent?.paragraphs.flatMap(paragraph => paragraph.id ? [paragraph.id] : []) || []);
  return { headId: head.id, before: head.storyContent, nextText,
    layout: { settings: { baselineGrid }, spreads, paragraphStyles, characterStyles, masterSpreads: [], layers: [] },
    wrap, fonts: Array.from(fonts.values()), probes: Array.from(probes.values()), paragraphIds };
}

export function fontMeasurementsMatch(probes: FontProbe[]): boolean {
  return probes.every(({ style, widths }) => measurementSamples.every((text, index) =>
    Math.abs(measureStoryText(text, style) - widths[index]) <= 0.0001));
}

export async function composeStoryInBackground(request: StoryCompositionRequest): Promise<StoryComposition | null> {
  await fontManager.restoreFonts(request.fonts);
  if (!fontMeasurementsMatch(request.probes)) return null;
  const head = request.layout.spreads.flatMap(spread => spread.elements).find(frame => frame.id === request.headId);
  if (head?.type !== 'text') return null;
  const edited = editStory(request.before, request.nextText);
  const occupied = new Set(request.paragraphIds);
  head.storyContent = { ...edited, paragraphs: edited.paragraphs.map(paragraph => {
    const id = !paragraph.id || occupied.has(paragraph.id) ? `paragraph-${crypto.randomUUID()}` : paragraph.id;
    occupied.add(id);
    return { ...paragraph, id };
  }) };
  const chain = reflowStoryState(request.layout, head.id, (_state, spread) => request.wrap[spread.id] || []);
  if (!chain || head.rawStoryText === undefined) return null;
  return { content: head.storyContent, rawText: head.rawStoryText,
    frames: chain.map(({ id, text, textContent, storyStart, storyEnd }) => ({ id, text, textContent, storyStart, storyEnd })) };
}
