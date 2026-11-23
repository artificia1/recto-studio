import type { CanvasElement, FontAsset, ProjectState, StoryContent, TextElement } from '../types';
import { fontManager } from '../fontManager';
import { warmLayout } from './layoutRuntime';
import { reflowStoryState, storyHeads, type StoryLayoutState } from './publicationReferences';
import { publicationWrapObjects } from './publicationWrap';
import { measureStoryText, resolveParagraphStyle, resolveRunStyle, type RunStyle } from './storyLayout';
import { editStory, formatFrameParagraphs, storyText, type FrameLayoutEdit } from './storyContent';

interface FontProbe {
  style: RunStyle;
  widths: number[];
}

type FrameEdit = { frameId: string; updates: FrameLayoutEdit };

export type ComposedFrame = Pick<TextElement, 'id' | 'text' | 'textContent' | 'storyStart' | 'storyEnd'>;
export interface StoryComposition {
  content: StoryContent;
  rawText: string;
  frames: ComposedFrame[];
}

export interface StoryCompositionRequest {
  headId: string;
  before: StoryContent;
  edit: string | FrameEdit | { prepared: true };
  layout: StoryLayoutState;
  wrap: Record<string, CanvasElement[]>;
  fonts: FontAsset[];
  probes: FontProbe[];
  samples: string[];
  paragraphIds: string[];
}

const latinProbe = 'Hamburgefonts 0123456789 ffi AV .,-:';

/** Measure the fallback glyphs the job can use, without initializing unrelated system fonts. */
export function compositionFontSamples(...sources: string[]): string[] {
  const blocks = new Map<number, string>();
  const nonAscii = /[^\x00-\x7f]/gu;
  for (const source of sources) {
    nonAscii.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = nonAscii.exec(source))) {
      const character = match[0];
      const block = character.codePointAt(0)! >>> 8;
      const found = blocks.get(block) || '';
      if (found.length < 4 && !found.includes(character)) blocks.set(block, found + character);
    }
  }
  return [latinProbe, ...blocks.values()];
}

export async function prepareStoryComposition(state: ProjectState, head: TextElement, edit: string | FrameEdit | { content: StoryContent },
  signal?: AbortSignal): Promise<StoryCompositionRequest | null> {
  const raw = head.rawStoryText || '';
  if (signal?.aborted || !head.nextFrameId || !head.storyContent || head.generated || head.autoExtendStory ||
    state.settings.footnotes?.length || Math.max(typeof edit === 'string' ? edit.length : 0, raw.length) < 8000) return null;

  const byId = new Map<string, TextElement>();
  for (const spread of state.spreads) for (const frame of spread.elements) if (frame.type === 'text') byId.set(frame.id, frame);
  const ids = new Set<string>();
  const frames: TextElement[] = [];
  for (let frame: TextElement | undefined = head; frame && !ids.has(frame.id); frame = byId.get(frame.nextFrameId || '')) {
    ids.add(frame.id);
    frames.push(frame);
  }
  if (frames.length < 2) return null;
  const frameEdit = typeof edit === 'object' && 'frameId' in edit ? edit : undefined;
  const preparedContent = typeof edit === 'object' && 'content' in edit ? edit.content : undefined;
  if (frameEdit && !frames.some(frame => frame.id === frameEdit.frameId && frame.textContent)) return null;

  const { baselineGrid } = state.settings;
  const { paragraphStyles, characterStyles } = state;
  const wrap = Object.create(null) as StoryCompositionRequest['wrap'];
  const spreads = state.spreads.flatMap(spread => {
    const elements = spread.elements.filter((frame): frame is TextElement => ids.has(frame.id) && frame.type === 'text');
    if (!elements.length) return [];
    wrap[spread.id] = publicationWrapObjects(state, spread).map(element =>
      element.type === 'image' ? { ...element, src: '', proxySrc: undefined } : element);
    return [{ id: spread.id, spreadIndex: spread.spreadIndex, pages: [], elements: elements.map(frame => {
      const cached = frameEdit && frame.textContent && frame.storyStart !== undefined && frame.storyEnd !== undefined &&
        frame.text === raw.slice(frame.storyStart, frame.storyEnd);
      return { ...frame, ...((frameEdit?.frameId === frame.id) ? frameEdit.updates : {}),
        text: cached ? frame.text : '', storyContent: undefined,
        textContent: cached ? { version: 1 as const, paragraphs: [] } : undefined, rawStoryText: undefined };
    }) }];
  });

  // Probe each effective face. Fonts available only in the document's CSS may have
  // different metrics in the worker, in which case the editor uses its regular composer.
  const fonts = new Map<string, FontAsset>();
  const probes = new Map<string, FontProbe>();
  const faces = new Map<string, RunStyle>();
  const defaults = new Map(frames.map(frame => [frame.fontFamily, frame]));
  let deadline = performance.now() + 8;
  const yieldToEditor = async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    deadline = performance.now() + 8;
    return !signal?.aborted;
  };
  const addProbe = (style: RunStyle) => {
    const key = JSON.stringify([style.fontFamily, !!style.bold, !!style.italic]);
    if (!faces.has(key)) faces.set(key, style);
  };
  const content = preparedContent ?? head.storyContent;
  for (const [index, paragraph] of content.paragraphs.entries()) {
    if ((index & 63) === 0 && performance.now() > deadline && !await yieldToEditor()) return null;
    const style = resolveParagraphStyle(paragraph, paragraphStyles);
    for (const run of paragraph.runs) {
      const first = resolveRunStyle(head, style, run, characterStyles || []);
      addProbe(first);
      if (!style.fontFamily && !run.fontFamily && !characterStyles?.find(item => item.id === run.characterStyleId)?.fontFamily) {
        for (const frame of defaults.values()) addProbe({ ...first, fontFamily: frame.fontFamily });
      }
    }
  }
  const samples = compositionFontSamples(preparedContent ? storyText(preparedContent) : raw || storyText(content), typeof edit === 'string' ? edit : '');
  for (const [key, style] of faces) {
    const asset = fontManager.getFontAsset(style.fontFamily);
    if (asset) {
      fonts.set(asset.family, asset);
    } else {
      if (probes.size >= 64) return null;
      const probeStyle = { ...style, fontSizePt: 12 };
      const widths: number[] = [];
      for (const text of samples) {
        if (performance.now() > deadline && !await yieldToEditor()) return null;
        widths.push(measureStoryText(text, probeStyle));
      }
      probes.set(key, { style: probeStyle, widths });
    }
  }

  const paragraphIds = typeof edit !== 'string' ? [] : storyHeads(state).filter(frame => frame.id !== head.id).flatMap(frame =>
    frame.storyContent?.paragraphs.flatMap(paragraph => paragraph.id ? [paragraph.id] : []) || []);
  if (signal?.aborted) return null;
  return { headId: head.id, before: content, edit: typeof edit === 'string' ? edit : frameEdit ?? { prepared: true },
    layout: { settings: { baselineGrid }, spreads, paragraphStyles, characterStyles, masterSpreads: [], layers: [] },
    wrap, fonts: Array.from(fonts.values()), probes: Array.from(probes.values()), samples, paragraphIds };
}

export function fontMeasurementsMatch({ probes, samples }: Pick<StoryCompositionRequest, 'probes' | 'samples'>): boolean {
  return probes.every(({ style, widths }) => samples.every((text, index) =>
    Math.abs(measureStoryText(text, style) - widths[index]) <= 0.0001));
}

export async function composeStoryInBackground(request: StoryCompositionRequest): Promise<StoryComposition | null> {
  await Promise.all([warmLayout(), fontManager.restoreFonts(request.fonts)]);
  if (!fontMeasurementsMatch(request)) return null;
  const frames = request.layout.spreads.flatMap(spread => spread.elements);
  const head = frames.find(frame => frame.id === request.headId);
  if (head?.type !== 'text') return null;
  const { edit } = request;
  let resume;
  if (typeof edit === 'string') {
    const edited = editStory(request.before, edit);
    const occupied = new Set(request.paragraphIds);
    head.storyContent = { ...edited, paragraphs: edited.paragraphs.map(paragraph => {
      const id = !paragraph.id || occupied.has(paragraph.id) ? `paragraph-${crypto.randomUUID()}` : paragraph.id;
      occupied.add(id);
      return { ...paragraph, id };
    }) };
  } else if ('frameId' in edit) {
    const frame = frames.find(item => item.id === edit.frameId);
    if (frame?.type !== 'text') return null;
    const formatted = formatFrameParagraphs(request.before, frame, edit.updates);
    head.storyContent = formatted?.content ?? request.before;
    resume = { frameId: frame.id, ...formatted?.range };
  } else {
    head.storyContent = request.before;
  }
  // Unchanged prefix and tail frames hold placeholder slices in the worker.
  // Return recomposed slices even if empty, so pushed text is removed on the UI thread.
  const previousSlices = new Map(frames.map(frame => [frame.id, frame.type === 'text' ? frame.textContent : undefined]));
  const chain = reflowStoryState(request.layout, head.id, (_state, spread) => request.wrap[spread.id] || [], undefined, resume);
  if (!chain || head.rawStoryText === undefined) return null;
  return { content: head.storyContent, rawText: head.rawStoryText,
    frames: chain.filter(frame => frame.textContent !== previousSlices.get(frame.id))
      .map(({ id, text, textContent, storyStart, storyEnd }) => ({ id, text, textContent, storyStart, storyEnd })) };
}
