import type { Footnote, ProjectState, StoryContent, StoryRun, TextElement } from '../types';
import { indexStory, plainStory, sliceStory, storyText } from './storyContent';
import { pageLabel } from './pageLabels';
import { layoutStory, layoutStoryParagraphs } from './storyLayout';
import { publicationWrapObjects } from './publicationWrap';
import { hierarchicalIndex } from './indexLayout';
import { applyEditionVisibility } from './publicationEditions';
import { publicationCaptions } from './publicationCaptions';
import { composeFootnotes, footnoteGeometry, wrapFootnote, type NoteContinuation } from './footnoteFlow';

export type StoryLayoutState = Pick<ProjectState, 'spreads' | 'paragraphStyles' | 'characterStyles' | 'masterSpreads' | 'layers'> & {
  settings: Pick<ProjectState['settings'], 'baselineGrid' | 'footnotes' | 'footnoteSettings'>;
};
const composedFootnotes = new WeakMap<TextElement, { state: StoryLayoutState; layout: ReturnType<typeof composeFootnotes> }>();

export const noteMarker = (number: number) => String(number).replace(/\d/g, digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]);
export const textFrames = (state: ProjectState) => state.spreads.flatMap(spread => spread.elements).filter((item): item is TextElement => item.type === 'text');
export const storyHeads = (state: ProjectState) => textFrames(state).filter(frame => !frame.prevFrameId);
export function contentOf(frame: TextElement): StoryContent { return frame.storyContent || plainStory(frame.rawStoryText ?? frame.text, frame.paragraphStyleId); }

export function insertRun(content: StoryContent, start: number, end: number, run: StoryRun): StoryContent {
  const text = storyText(content), length = text.length;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > length) throw new Error('Select a valid manuscript position.');
  for (const position of [start, end]) if (position > 0 && position < length && /[\uD800-\uDBFF]/.test(text[position - 1]) && /[\uDC00-\uDFFF]/.test(text[position])) throw new Error('Place the cursor outside the Unicode character.');
  let offset = 0;
  for (const paragraph of content.paragraphs) {
    for (const item of paragraph.runs) {
      const limit = offset + item.text.length;
      if ((item.noteId || item.reference) && [start, end].some(position => position > offset && position < limit)) throw new Error('Place the cursor outside the note or reference marker.');
      offset = limit;
    }
    offset++;
  }
  const left = sliceStory(content, 0, start).paragraphs, right = sliceStory(content, end, length).paragraphs;
  return { version: 1, paragraphs: [...left.slice(0, -1), { ...left.at(-1)!, runs: [...left.at(-1)!.runs, run, ...right[0].runs] }, ...right.slice(1)] };
}

function frameAt(state: ProjectState, head: TextElement, offset: number): TextElement {
  let frame = head;
  const seen = new Set<string>();
  const frames = textFrames(state);
  while (frame.nextFrameId && !seen.has(frame.id) && offset >= (frame.storyEnd ?? Infinity)) {
    seen.add(frame.id);
    const next = frames.find(item => item.id === frame.nextFrameId);
    if (!next) break;
    frame = next;
  }
  return frame;
}

export interface PublicationHeading { title: string; level: number; elementId: string; paragraphId?: string; pageId: string; label: string; pageNumber: number }
export const publicationId = (kind: string, id: string) => `${kind}-${[...new TextEncoder().encode(id)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
export function publicationText(state: ProjectState, text: string, pageNumber: number): string {
  const pages = state.spreads.flatMap(spread => spread.pages);
  const page = pages.find(page => page.pageNumber === pageNumber);
  const labels = pageLabel(pages, page?.id || '');
  const chapter = publicationHeadings(state).filter(heading => heading.level === 1 && heading.pageNumber <= pageNumber).at(-1)?.title || labels.sectionTitle || state.settings.title;
  const hidden = new Set(state.conditions?.filter(condition => !condition.visible).map(condition => condition.name.toLowerCase()) || []);
  return text.replace(/\{\{(page|physicalPage|totalPages|docTitle|sectionTitle|chapterTitle)\}\}/gi, (_, token: string) => ({ page: labels.label, physicalpage: String(pageNumber), totalpages: String(pages.length), doctitle: state.settings.title, sectiontitle: labels.sectionTitle || chapter, chaptertitle: chapter }[token.toLowerCase()] || ''))
    .replace(/\{xref:([^}]+)\}/g, (_, id: string) => { const target = textFrames(state).find(frame => frame.id === id.trim()); return target ? pageLabel(pages, target.pageId).label : '[#?]'; })
    .replace(/\{cond:([^}]+)\}([\s\S]*?)\{\/cond\}/g, (_, name: string, content: string) => hidden.has(name.trim().toLowerCase()) ? '' : content)
    .replace(/\{index:[^}]+\}/g, '');
}
export function publicationHeadings(state: ProjectState): PublicationHeading[] {
  const pages = state.spreads.flatMap(spread => spread.pages);
  const result: PublicationHeading[] = [];
  for (const head of storyHeads(state)) {
    if (head.generated || head.pasteboard) continue;
    let offset = 0;
    for (const [index, paragraph] of contentOf(head).paragraphs.entries()) {
      const style = state.paragraphStyles.find(style => style.id === (paragraph.styleId || head.paragraphStyleId));
      const tag = style?.pdfTag || '';
      const level = /^H[1-6]$/.test(tag) ? Number(tag[1]) : tag === 'Title' ? 1 :
        /style-h([1-6])/.exec(paragraph.styleId || head.paragraphStyleId || '')?.[1] ||
        (/headline|heading\s*1/i.test(style?.name || '') ? 1 : !head.storyContent && index === 0 && head.fontSizePt >= 24 ? 1 : 0);
      const title = paragraph.runs.map(run => run.text).join('').trim();
      if (level && title) {
        const frame = frameAt(state, head, offset);
        result.push({ title, level: Number(level), elementId: head.id, paragraphId: paragraph.id,
          pageId: frame.pageId, pageNumber: pages.find(page => page.id === frame.pageId)?.pageNumber || 1,
          label: pageLabel(pages, frame.pageId).label });
      }
      offset += paragraph.runs.reduce((n, run) => n + run.text.length, 0) + 1;
    }
  }
  return result.sort((a, b) => pages.findIndex(page => page.id === a.pageId) - pages.findIndex(page => page.id === b.pageId));
}

export function notesForFrame(state: Pick<StoryLayoutState, 'settings'>, frame: TextElement): Footnote[] {
  if (!state.settings.footnotes?.length) return [];
  const runs = (frame.textContent || frame.storyContent)?.paragraphs.flatMap(paragraph => paragraph.runs) || [];
  const ids = new Set(runs.map(run => run.noteId).filter(Boolean));
  return (state.settings.footnotes || []).filter(note => note.kind !== 'endnote' &&
    (ids.has(note.id) || (!note.anchorVersion && note.elementId === frame.id && frame.text.includes(noteMarker(note.number)))));
}

export function reflowStoryState(state: StoryLayoutState, frameId: string,
  getWrapObjects: typeof publicationWrapObjects = publicationWrapObjects) {
  const byId = new Map<string, TextElement>();
  const spreadsByFrame = new Map<string, ProjectState['spreads'][number]>();
  for (const spread of state.spreads) for (const element of spread.elements) {
    if (element.type !== 'text') continue;
    byId.set(element.id, element);
    spreadsByFrame.set(element.id, spread);
  }
  let head = byId.get(frameId);
  const seen = new Set<string>();
  while (head?.prevFrameId && !seen.has(head.id)) { seen.add(head.id); head = byId.get(head.prevFrameId); }
  if (!head) return;
  const chain: TextElement[] = []; seen.clear();
  let current: TextElement | undefined = head;
  while (current && !seen.has(current.id)) { seen.add(current.id); chain.push(current); current = current.nextFrameId ? byId.get(current.nextFrameId) : undefined; }
  const content = head.storyContent || plainStory(head.rawStoryText ?? chain.map(frame => frame.text).join('\n\n'), head.paragraphStyleId);
  head.storyContent = content; head.rawStoryText = storyText(content);
  const indexed = chain.length > 1 ? indexStory(content) : undefined;
  const slice = indexed?.slice ?? ((start: number, end: number) => sliceStory(content, start, end));
  const wrapBySpread = new Map<ProjectState['spreads'][number], ReturnType<typeof publicationWrapObjects>>();
  let offset = 0;
  let pending: NoteContinuation[] = [];
  const documentHasNotes = !!state.settings.footnotes?.length;
  for (const [index, frame] of chain.entries()) {
    const lastFrame = index === chain.length - 1;
    const remaining = lastFrame ? slice(offset, head.rawStoryText.length) : undefined;
    const paragraphs = remaining?.paragraphs ?? indexed!.from(offset);
    const spread = spreadsByFrame.get(frame.id)!;
    let obstacles = wrapBySpread.get(spread);
    if (!obstacles) {
      obstacles = getWrapObjects(state, spread);
      wrapBySpread.set(spread, obstacles);
    }
    const options = { obstacles, baselineGrid: state.settings.baselineGrid };
    let reserved = 0;
    let layout = layoutStoryParagraphs(paragraphs, frame, state.paragraphStyles, state.characterStyles, undefined, reserved, options);
    let fragments: ReturnType<typeof composeFootnotes> | undefined;
    if (documentHasNotes) {
      const tailNotes = remaining ? notesForFrame(state, { ...frame, textContent: remaining }) : [];
      for (let pass = 0; pass <= 8; pass++) {
        const visible = slice(offset, offset + layout.consumed);
        const notes = notesForFrame(state, { ...frame, textContent: visible });
        if (!notes.length && !pending.length && !reserved && !tailNotes.length) { fragments = undefined; break; }
        fragments = composeFootnotes(state, frame, visible, layout.lines, notes, pending);
        fragments.unplacedAnchors += Math.max(0, tailNotes.length - notes.length);
        if (fragments.height <= reserved + 0.001 || pass === 8) break;
        reserved = fragments.height;
        layout = layoutStoryParagraphs(paragraphs, frame, state.paragraphStyles, state.characterStyles, undefined, reserved, options);
      }
    }
    const end = lastFrame ? head.rawStoryText.length : offset + layout.consumed;
    frame.textContent = remaining ?? slice(offset, end);
    frame.text = head.rawStoryText.slice(offset, end);
    frame.storyStart = offset; frame.storyEnd = end;
    if (fragments) {
      composedFootnotes.set(frame, { state, layout: { ...fragments, height: Math.max(reserved, fragments.height) } });
      pending = fragments.carry;
    } else {
      composedFootnotes.delete(frame);
    }
    if (index) { delete frame.storyContent; delete frame.rawStoryText; }
    offset = end;
  }
  return chain;
}

export function publicationSnapshot(source: ProjectState): ProjectState {
  const state = structuredClone(source);
  migrateLegacyNotes(state);
  applyEditionVisibility(state);
  for (let pass = 0; pass < 8; pass++) {
    const before = JSON.stringify(textFrames(state).map(frame => [frame.id, frame.storyStart, frame.storyEnd, frame.text]));
    const changed = refreshPublication(state);
    for (const head of storyHeads(state)) if (head.storyContent) reflowStoryState(state, head.id);
    const after = JSON.stringify(textFrames(state).map(frame => [frame.id, frame.storyStart, frame.storyEnd, frame.text]));
    if (!changed && before === after) return state;
  }
  throw new Error('Publication references did not settle. Refresh the document and review its generated lists.');
}

/** Migrate only an unambiguous marker in its recorded owner; never scan unrelated exponents. */
export function migrateLegacyNotes(state: ProjectState) {
  const frames = textFrames(state);
  for (const note of state.settings.footnotes || []) {
    if (note.anchorVersion) continue;
    note.anchorVersion = 1;
    const owner = frames.find(frame => frame.id === note.elementId);
    if (!owner) continue;
    let head = owner;
    const seen = new Set<string>();
    while (head.prevFrameId && !seen.has(head.id)) { seen.add(head.id); const prev = frames.find(frame => frame.id === head.prevFrameId); if (!prev) break; head = prev; }
    const marker = noteMarker(note.number);
    const matches = [...owner.text.matchAll(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g)].filter(match => match[0] === marker);
    if (matches.length !== 1) continue;
    const offset = (owner.storyStart || 0) + matches[0].index!;
    head.storyContent = insertRun(contentOf(head), offset, offset + marker.length, { text: marker, noteId: note.id });
    head.rawStoryText = storyText(head.storyContent);
  }
}

/** Shared physical layout for state flow, canvas and PDF. Long notes wrap by measured width. */
export function layoutFrameNotes(state: ProjectState, frame: TextElement, notes?: Footnote[]) {
  const composed = composedFootnotes.get(frame);
  if (composed?.state === state) return composed.layout;
  notes ??= notesForFrame(state, frame);
  const { size, family, columns, gutter, columnWidth: width, lineHeight } = footnoteGeometry(state, frame);
  const lines: { text: string; noteId: string; column: number; x: number; y: number }[] = [];
  const base = { lines, size, family, lineHeight, columnWidth: width, remaining: 0, unplacedAnchors: 0 };
  if (!notes.length) return { ...base, height: 0 };
  const content = frame.textContent || frame.storyContent || plainStory(frame.text);
  const anchors = new Map<string, number>();
  let offset = 0;
  for (const paragraph of content.paragraphs) {
    for (const run of paragraph.runs) { if (run.noteId) anchors.set(run.noteId, offset); offset += run.text.length; }
    offset++;
  }
  let placements = new Map<string, number>();
  const wrapped = new Map(notes.map(note => [note.id, wrapFootnote(`${note.number}. ${note.text}`, width, size, family)]));
  let height = 0;
  const spread = state.spreads.find(spread => spread.elements.some(element => element.id === frame.id));
  const options = { obstacles: spread ? publicationWrapObjects(state, spread) : [], baselineGrid: state.settings.baselineGrid };
  for (let pass = 0; pass < 8 && notes.length; pass++) {
    const layout = layoutStory(content, frame, state.paragraphStyles, state.characterStyles, undefined, height, options);
    placements = new Map(notes.map(note => {
      const anchor = anchors.get(note.id);
      const line = anchor === undefined ? undefined : layout.lines.find(line => anchor >= line.start && anchor < line.end);
      return [note.id, Math.min(columns - 1, line?.column ?? columns - 1)];
    }));
    const counts = Array.from({ length: columns }, (_, column) => notes.filter(note => placements.get(note.id) === column).reduce((sum, note) => sum + wrapped.get(note.id)!.length, 0));
    const required = Math.max(...counts) * lineHeight + 3;
    if (required <= height + 0.0001) break;
    height = required;
  }
  const rows = new Array(columns).fill(0);
  for (const note of notes) {
    const column = placements.get(note.id) ?? 0;
    for (const text of wrapped.get(note.id)!) lines.push({ text, noteId: note.id, column, x: column * (width + gutter), y: rows[column]++ * lineHeight });
  }
  return { ...base, height };
}

/** Refresh derived references only. The caller reflows between bounded passes. */
export function refreshPublication(state: ProjectState): boolean {
  let changed = false;
  if (!state.settings.identifier) { state.settings.identifier = `urn:uuid:${crypto.randomUUID()}`; changed = true; }
  const heads = storyHeads(state);
  const usedParagraphs = new Set<string>();
  for (const head of heads) if (head.storyContent) for (const paragraph of head.storyContent.paragraphs) {
    if (!paragraph.id || usedParagraphs.has(paragraph.id)) paragraph.id = `paragraph-${crypto.randomUUID()}`;
    usedParagraphs.add(paragraph.id);
  }
  const pages = state.spreads.flatMap(spread => spread.pages);
  const occurrences: { note: Footnote; run: StoryRun; frame: TextElement; offset: number }[] = [];
  for (const head of heads) {
    if (head.generated) continue;
    let offset = 0;
    for (const paragraph of contentOf(head).paragraphs) {
      for (const run of paragraph.runs) {
        const note = state.settings.footnotes?.find(note => note.id === run.noteId);
        if (note) occurrences.push({ note, run, frame: frameAt(state, head, offset), offset });
        const entry = state.indexEntries?.find(entry => entry.id === run.indexId);
        if (entry) { entry.elementId = frameAt(state, head, offset).id; entry.pageNumber = pages.find(page => page.id === frameAt(state, head, offset).pageId)?.pageNumber || 1; }
        offset += run.text.length;
      }
      offset++;
    }
  }
  occurrences.sort((a, b) => pages.findIndex(page => page.id === a.frame.pageId) - pages.findIndex(page => page.id === b.frame.pageId) || a.frame.y - b.frame.y || a.frame.x - b.frame.x || a.offset - b.offset);
  const seen = new Set<string>();
  const counters = new Map<string, number>();
  for (const { note, run, frame } of occurrences) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    const scope = state.settings.footnoteSettings?.scope;
    const section = pages.slice(0, pages.findIndex(page => page.id === frame.pageId) + 1).findLast(page => page.section)?.id || 'document';
    const key = `${note.kind || 'footnote'}:${note.kind === 'endnote' ? 'document' : scope === 'page' ? frame.pageId : scope === 'section' ? section : 'document'}`;
    const number = (counters.get(key) || 0) + 1; counters.set(key, number);
    note.number = number; note.elementId = frame.id; note.pageId = frame.pageId;
    if (run.text !== noteMarker(number)) { run.text = noteMarker(number); changed = true; }
  }
  const headings = publicationHeadings(state);
  const captions = publicationCaptions(state);
  const captionById = new Map(captions.map(item => [item.id, item]));
  const frameById = new Map(textFrames(state).map(frame => [frame.id, frame]));
  for (const head of heads) {
    if (!head.storyContent) continue;
    for (const paragraph of head.storyContent.paragraphs) for (const run of paragraph.runs) if (run.reference) {
      const ref = run.reference;
      const heading = ref.targetParagraphId ? headings.find(heading => ref.targetParagraphId === heading.paragraphId) : undefined;
      if (heading && ref.targetElementId !== heading.elementId) { ref.targetElementId = heading.elementId; changed = true; }
      const target = frameById.get(ref.targetElementId);
      const label = ref.format === 'caption' ? captionById.get(ref.targetElementId)?.label || '[missing caption]' : heading ? (ref.format === 'title' ? heading.title : heading.label) :
        !ref.targetParagraphId && target ? (ref.format === 'title' ? target.text.split('\n')[0] : pageLabel(pages, target.pageId).label) : '[missing reference]';
      if (run.text !== label) { run.text = label; changed = true; }
    }
  }
  for (const head of heads.filter(head => head.generated)) {
    const generated = head.generated!;
    let content: StoryContent;
    if (generated.kind === 'caption') {
      const caption = captionById.get(head.id);
      content = plainStory(caption ? `${caption.label} — ${caption.title}` : generated.title);
    } else if (generated.kind === 'figures' || generated.kind === 'tables') {
      const kind = generated.kind === 'figures' ? 'Figure' : 'Table';
      content = { version: 1, paragraphs: [{ runs: [{ text: generated.title }] }, ...captions.filter(item => item.kind === kind).map(item => ({ runs: [
        { text: `${item.label} — ${item.title} · ` }, { text: item.page, reference: { targetElementId: item.id, format: 'page' as const } },
      ] }))] };
    } else if (generated.kind === 'toc') content = { version: 1, paragraphs: [{ runs: [{ text: generated.title }] }, ...headings.map(heading => ({ runs: [
      { text: '  '.repeat(heading.level - 1) },
      { text: heading.title, reference: { targetElementId: heading.elementId, targetParagraphId: heading.paragraphId, format: 'title' as const } },
      { text: ' ········ ' }, { text: heading.label, reference: { targetElementId: heading.elementId, targetParagraphId: heading.paragraphId, format: 'page' as const } },
    ] }))] };
    else if (generated.kind === 'endnotes') content = plainStory([generated.title, ...(state.settings.footnotes || []).filter(note => note.kind === 'endnote' && seen.has(note.id)).map(note => `${note.number}. ${note.text}`)].join('\n'));
    else {
      const topics = new Map<string, Map<number, { label: string; elementId?: string }>>();
      const authorities = generated.kind === 'authorities';
      const liveIds = new Set(heads.filter(source => !source.generated).flatMap(source => contentOf(source).paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.indexId))));
      const entries = (state.indexEntries || []).filter(entry => authorities ? !!entry.authorityCategory && liveIds.has(entry.id) : !entry.authorityCategory);
      for (const source of heads.filter(source => !source.generated)) {
        if (authorities) break;
        for (const match of storyText(contentOf(source)).matchAll(/\{index:([^}]+)\}/g)) {
          const [topic, subtopic] = match[1].split(':');
          const frame = frameAt(state, source, match.index!);
          entries.push({ id: '', topic, subtopic, elementId: frame.id, pageNumber: pages.find(page => page.id === frame.pageId)?.pageNumber || 1 });
        }
      }
      for (const entry of entries) {
        const topic = `${authorities ? `${entry.authorityCategory}\u0000` : ''}${entry.topic}${entry.subtopic ? ` — ${entry.subtopic}` : ''}`;
        const page = pages.find(page => page.pageNumber === entry.pageNumber);
        const labels = topics.get(topic) || new Map<number, { label: string; elementId?: string }>();
        if (page) labels.set(page.pageNumber, { label: pageLabel(pages, page.id).label, elementId: entry.elementId });
        topics.set(topic, labels);
      }
      const paragraphs: StoryContent['paragraphs'] = [{ runs: [{ text: generated.title }] }];
      let letter = '';
      for (const [key, labels] of [...topics].sort(([a], [b]) => a.localeCompare(b))) {
        const [category, citation] = authorities ? key.split('\u0000') : ['', key];
        const topic = citation;
        const initial = authorities ? ({ cases: 'Cases', statutes: 'Statutes', treatises: 'Treatises' }[category] || category) : Array.from(topic)[0]?.toUpperCase() || '#';
        if (initial !== letter) { letter = initial; paragraphs.push({ runs: [{ text: authorities ? letter : `[ ${letter} ]`, bold: true }] }); }
        const runs: StoryRun[] = [{ text: `${topic}  ` }];
        for (const [index, [, value]] of [...labels].sort(([a], [b]) => a - b).entries()) {
          if (index) runs.push({ text: ', ' });
          runs.push({ text: value.label, ...(value.elementId ? { reference: { targetElementId: value.elementId, format: 'page' as const } } : {}) });
        }
        paragraphs.push({ runs });
      }
      content = { version: 1, paragraphs: authorities ? paragraphs : [{ runs: [{ text: generated.title }] }, ...hierarchicalIndex(entries, pages)] };
    }
    // Paragraph IDs on generated lists are not reference targets.
    const comparable = (value: StoryContent) => JSON.stringify(value.paragraphs.map(({ id: _, ...paragraph }) => paragraph));
    if (comparable(contentOf(head)) !== comparable(content)) { head.storyContent = content; changed = true; }
  }
  for (const head of heads) if (head.storyContent) head.rawStoryText = storyText(head.storyContent);
  return changed;
}
