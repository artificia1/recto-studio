import type { CanvasElement, ProjectState, StoryRun } from '../types';
import { contentOf, storyHeads } from '../engine/publicationReferences';
import { publicationId } from '../engine/publicationReferences';
import { tableGrid } from '../engine/tableCells';

export type TranslationAddress =
  | { kind: 'paragraph'; frameId: string; index: number; paragraphId?: string }
  | { kind: 'note'; noteId: string }
  | { kind: 'cell'; frameId: string; row: number; column: number }
  | { kind: 'image'; frameId: string; field: 'altText' | 'caption' }
  | { kind: 'caption'; frameId: string }
  | { kind: 'parent'; parentId: string; frameId: string; index: number }
  | { kind: 'title' };

export type TranslationPart =
  | { kind: 'text'; text: string }
  | { kind: 'format'; id: string; text: string }
  | { kind: 'marker'; id: string };

export interface TranslationUnit {
  key: string;
  address: TranslationAddress;
  group: string;
  label: string;
  frameId?: string;
  page?: number;
  source: TranslationPart[];
  codes: Map<string, StoryRun>;
}

export interface TranslationGroup {
  id: string;
  label: string;
  page?: number;
  restricted?: 'hidden layer' | 'inactive edition' | 'unused parent page';
  units: TranslationUnit[];
}

export const MAX_TRANSLATION_UNITS = 12000;
export const MAX_UNIT_LENGTH = 24000;
export const MAX_XLIFF_BYTES = 16 * 1024 * 1024;

export function languageTag(value: string): string {
  if (!value.trim() || value.length > 64) throw new Error('Enter a language tag such as en-US, fr-CA or ja.');
  try { return Intl.getCanonicalLocales(value.trim())[0]; }
  catch { throw new Error('Enter a valid language tag such as en-US, fr-CA or ja.'); }
}

function cleanText(text: string) {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized.length > MAX_UNIT_LENGTH) throw new Error('A translation unit exceeds 24,000 characters. Split the source paragraph or cell.');
  if (!/^[\u0009\u000a\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]*$/u.test(normalized)) {
    throw new Error('A translation unit contains characters that cannot be exchanged in XML.');
  }
  return normalized;
}

export function storyTranslationParts(runs: StoryRun[]) {
  const parts: TranslationPart[] = [];
  const codes = new Map<string, StoryRun>();
  const append = (run: StoryRun, protectedText: boolean) => {
    if (!run.text) return;
    if (protectedText) {
      const identity = run.noteId || run.reference || run.indexId
        ? [run.noteId, run.reference, run.indexId] : [run.text];
      const id = publicationId(`m${codes.size + 1}`, JSON.stringify(identity));
      parts.push({ kind: 'marker', id });
      codes.set(id, run);
      return;
    }
    const text = cleanText(run.text);
    if (Object.entries(run).some(([field, value]) => field !== 'text' && value !== undefined)) {
      const id = String(codes.size + 1);
      parts.push({ kind: 'format', id, text });
      codes.set(id, run);
      return;
    }
    const last = parts.at(-1);
    if (last?.kind === 'text') last.text += text;
    else parts.push({ kind: 'text', text });
  };
  for (const run of runs) {
    if (run.noteId || run.reference || run.indexId) {
      append(run, true);
      continue;
    }
    let start = 0;
    const controls = /\{\{(?:page|physicalPage|totalPages|docTitle|sectionTitle|chapterTitle)\}\}|\{(?:xref|index|cond):[^}]+\}|\{\/cond\}/gi;
    for (const match of run.text.matchAll(controls)) {
      append({ ...run, text: run.text.slice(start, match.index) }, false);
      append({ ...run, text: match[0] }, true);
      start = match.index + match[0].length;
    }
    append({ ...run, text: run.text.slice(start) }, false);
  }
  return { parts, codes };
}

export function translationText(parts: TranslationPart[], codes?: Map<string, StoryRun>): string {
  return parts.map(part => part.kind === 'marker' ? codes?.get(part.id)?.text || '〔marker〕' : part.text).join('');
}

const elementTitle = (element: CanvasElement, fallback: string) => element.name?.trim() || fallback;
const groupKey = (kind: string, id: string) => publicationId(kind, id);

export function translationCatalog(state: ProjectState): TranslationGroup[] {
  const locations = new Map<string, { element: CanvasElement; page?: number }>();
  const hiddenLayers = new Set(state.layers.filter(layer => !layer.visible || layer.printable === false).map(layer => layer.id));
  const inactiveEditions = new Set((state.conditions || []).filter(condition => !condition.visible).map(condition => condition.id));
  const restricted = (element: CanvasElement): TranslationGroup['restricted'] =>
    element.layerId && hiddenLayers.has(element.layerId) ? 'hidden layer'
      : element.conditionId && inactiveEditions.has(element.conditionId) ? 'inactive edition' : undefined;
  for (const spread of state.spreads) {
    const pages = new Map(spread.pages.map(page => [page.id, page.pageNumber]));
    for (const element of spread.elements) {
      if (!element.pasteboard && !element.editorialOnly && !element.nonprinting) locations.set(element.id, { element, page: pages.get(element.pageId) });
    }
  }
  const groups: TranslationGroup[] = [];
  const groupsById = new Map<string, TranslationGroup>();
  const noteRestrictions = new Map<string, TranslationGroup['restricted']>();
  let unitCount = 0;
  const group = (id: string, label: string, page?: number, restriction?: TranslationGroup['restricted']) => {
    const result: TranslationGroup = { id, label, page, restricted: restriction, units: [] };
    groups.push(result);
    groupsById.set(id, result);
    return result;
  };
  const add = (destination: TranslationGroup, address: TranslationAddress, label: string,
    source: TranslationPart[], codes = new Map<string, StoryRun>(), frameId?: string) => {
    if (!source.some(part => part.kind !== 'marker' && part.text.trim())) return;
    cleanText(translationText(source, codes));
    if (++unitCount > MAX_TRANSLATION_UNITS) throw new Error('This publication exceeds 12,000 translation units. Split it into chapters before exchanging translations.');
    const identity = address.kind === 'paragraph' && address.paragraphId
      ? [address.kind, address.frameId, address.paragraphId] : address;
    destination.units.push({ key: publicationId('u', JSON.stringify(identity)), group: destination.id,
      address, label, frameId, page: destination.page, source, codes });
  };
  const addPlain = (destination: TranslationGroup, address: TranslationAddress, label: string, text: string, frameId?: string) =>
    add(destination, address, label, [{ kind: 'text', text: cleanText(text) }], undefined, frameId);
  if (state.settings.title?.trim()) {
    addPlain(group('publication', 'Publication details'), { kind: 'title' }, 'Publication title', state.settings.title);
  }
  for (const head of storyHeads(state)) {
    if (head.generated && head.generated.kind !== 'caption' || head.dataBinding || !locations.has(head.id)) continue;
    const content = contentOf(head);
    const ids = new Map<string, number>();
    for (const paragraph of content.paragraphs) if (paragraph.id) ids.set(paragraph.id, (ids.get(paragraph.id) || 0) + 1);
    for (const [index, paragraph] of content.paragraphs.entries()) {
      const restriction = restricted(head) || (paragraph.conditionId && inactiveEditions.has(paragraph.conditionId) ? 'inactive edition' : undefined);
      const groupId = groupKey(restriction ? 'restricted-story' : 'story', head.id);
      const { parts, codes } = storyTranslationParts(paragraph.runs);
      const destination = groupsById.get(groupId) ||
        group(groupId, elementTitle(head, translationText(parts, codes).trim().slice(0, 75) || 'Story'), locations.get(head.id)?.page, restriction);
      if (restriction) for (const run of paragraph.runs) if (run.noteId) noteRestrictions.set(run.noteId, restriction);
      const paragraphId = paragraph.id && ids.get(paragraph.id) === 1 ? paragraph.id : undefined;
      add(destination, { kind: 'paragraph', frameId: head.id, index, paragraphId }, `Paragraph ${index + 1}`, parts, codes, head.id);
    }
  }
  for (const [id, { element, page }] of locations) {
    if (element.type === 'table' && !element.prevFrameId) {
      const destination = group(groupKey('table', id), elementTitle(element, 'Table'), page, restricted(element));
      const grid = tableGrid(element.cells, element.headerRowCount, element.footerRowCount || 0);
      for (const [row, cells] of grid.entries()) {
        for (const [column, owner] of cells.entries()) {
          if (owner.row !== row || owner.column !== column) continue;
          addPlain(destination, { kind: 'cell', frameId: id, row, column }, `Row ${row + 1}, column ${column + 1}`, owner.cell.text, id);
        }
      }
    }
    if (element.type === 'image') {
      const destination = group(groupKey('image', id), elementTitle(element, 'Image'), page, restricted(element));
      for (const field of ['altText', 'caption'] as const) if (element[field]) {
        addPlain(destination, { kind: 'image', frameId: id, field }, field === 'altText' ? 'Image description' : 'Image caption', element[field]!, id);
      }
    }
    if (element.type === 'text' && element.generated?.kind === 'caption') {
      addPlain(group(groupKey('caption', id), 'Generated caption', page, restricted(element)), { kind: 'caption', frameId: id },
        'Caption wording', element.generated.title, id);
    }
  }
  const usedParents = new Set<string>();
  const parents = new Map(state.masterSpreads.map(parent => [parent.id, parent]));
  for (const spread of state.spreads) {
    let current = spread.masterSpreadId;
    while (current && !usedParents.has(current)) {
      usedParents.add(current);
      current = parents.get(current)?.parentMasterId;
    }
  }
  for (const parent of state.masterSpreads) {
    for (const frame of parent.elements) {
      if (frame.type !== 'text' || frame.prevFrameId || frame.generated || frame.dataBinding || frame.pasteboard || frame.editorialOnly || frame.nonprinting) continue;
      const destination = group(groupKey('parent', JSON.stringify([parent.id, frame.id])),
        `Parent page · ${parent.name} · ${elementTitle(frame, 'Text frame')}`, undefined,
        restricted(frame) || (!usedParents.has(parent.id) ? 'unused parent page' : undefined));
      const paragraphs = (frame.storyContent || frame.textContent || contentOf(frame)).paragraphs;
      for (const [index, paragraph] of paragraphs.entries()) {
        const { parts, codes } = storyTranslationParts(paragraph.runs);
        add(destination, { kind: 'parent', parentId: parent.id, frameId: frame.id, index }, `Paragraph ${index + 1}`, parts, codes);
      }
    }
  }
  const noteIds = new Set<string>();
  for (const note of state.settings.footnotes || []) {
    if (noteIds.has(note.id)) throw new Error('Repair duplicate note IDs before exchanging translations.');
    noteIds.add(note.id);
    if (!note.elementId || !locations.has(note.elementId)) continue;
    const kind = note.kind === 'endnote' ? 'Endnote' : 'Footnote';
    const location = locations.get(note.elementId)!;
    const destination = group(groupKey('note', note.id), `${kind} ${note.number}`, location.page,
      restricted(location.element) || noteRestrictions.get(note.id));
    addPlain(destination, { kind: 'note', noteId: note.id }, kind, note.text, note.elementId);
  }
  return groups.filter(destination => destination.units.length);
}
