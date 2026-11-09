import * as Y from 'yjs';
import type { ProjectState, StoryContent, StoryRun } from '../types';
import { plainStory, storyText } from './storyContent';

export const SHARED_PROJECT_KEYS = ['settings', 'spreads', 'masterSpreads', 'paragraphStyles', 'characterStyles', 'layers',
  'objectStyles', 'conditions', 'crossReferences', 'indexEntries', 'storyRevisions', 'embeddedFonts', 'comments'] as const;
export type SharedProject = Pick<ProjectState, typeof SHARED_PROJECT_KEYS[number]>;
const collections = new Set(['spreads', 'masterSpreads', 'paragraphStyles', 'characterStyles', 'layers', 'objectStyles',
  'conditions', 'crossReferences', 'indexEntries', 'storyRevisions', 'embeddedFonts', 'comments', 'pages', 'elements', 'footnotes']);
const derivedText = new Set(['text', 'rawStoryText', 'storyContent', 'textContent', 'storyStart', 'storyEnd', 'autoPaginationError']);
const localOrigin = Symbol('local-document-edit');
const seedOrigin = Symbol('shared-document-seed');
// Replica ordering must not depend on the operating system's language settings.
const compareKeys = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type Attributes = Record<string, unknown>;
type Delta = { insert: string; attributes?: Attributes };
type SharedMap = Y.Map<unknown>;

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function storyDelta(content: StoryContent): Delta[] {
  return content.paragraphs.flatMap(paragraph => {
    const { runs, ...metadata } = paragraph;
    return [...runs.filter(run => !!run.text).map(({ text, ...attributes }) => ({ insert: text, attributes })),
      { insert: '\n', attributes: { paragraph: metadata } }];
  });
}

function decodeStory(text: Y.Text): StoryContent {
  const paragraphs: StoryContent['paragraphs'] = [];
  let runs: StoryRun[] = [];
  for (const delta of text.toDelta() as Delta[]) {
    if (typeof delta.insert !== 'string') throw new Error('Shared manuscripts must contain text.');
    const { paragraph, ...format } = delta.attributes || {};
    const parts = delta.insert.split('\n');
    parts.forEach((part, index) => {
      if (part) runs.push({ ...format, text: part } as StoryRun);
      if (index < parts.length - 1) { paragraphs.push({ ...(paragraph as object || {}), runs: runs.length ? runs : [{ text: '' }] }); runs = []; }
    });
  }
  if (runs.length || !paragraphs.length) paragraphs.push({ runs: runs.length ? runs : [{ text: '' }] });
  return { version: 1, paragraphs };
}

/** Change only the edited characters and attributes, retaining concurrent CRDT identities. */
function syncStory(text: Y.Text, content: StoryContent) {
  const delta = storyDelta(content), next = delta.map(part => part.insert).join(''), before = text.toString();
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < next.length && before[prefix] === next[prefix]) prefix++;
  if (prefix && /[\uD800-\uDBFF]/.test(before[prefix - 1])) prefix--;
  while (suffix < before.length - prefix && suffix < next.length - prefix && before[before.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(before[before.length - suffix])) suffix--;
  const remove = before.length - prefix - suffix, insert = next.slice(prefix, next.length - suffix);
  if (remove) text.delete(prefix, remove);
  if (insert) text.insert(prefix, insert);
  const current = text.toDelta() as Delta[];
  let actualIndex = 0, wantedIndex = 0, actualOffset = 0, wantedOffset = 0, position = 0;
  while (actualIndex < current.length && wantedIndex < delta.length) {
    const actual = current[actualIndex], wanted = delta[wantedIndex];
    const length = Math.min(actual.insert.length - actualOffset, wanted.insert.length - wantedOffset);
    const attributes: Attributes = {}, a = actual.attributes || {}, b = wanted.attributes || {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[key], b[key])) attributes[key] = b[key] === undefined ? null : structuredClone(b[key]);
    if (Object.keys(attributes).length && length) text.format(position, length, attributes);
    position += length; actualOffset += length; wantedOffset += length;
    if (actualOffset === actual.insert.length) { actualIndex++; actualOffset = 0; }
    if (wantedOffset === wanted.insert.length) { wantedIndex++; wantedOffset = 0; }
  }
}

function wrapper(parent: SharedMap, key: string, kind: string): SharedMap {
  const current = parent.get(key);
  if (current instanceof Y.Map && current.get('kind') === kind) return current;
  const created = new Y.Map<unknown>(); parent.set(key, created); created.set('kind', kind);
  created.set('data', kind === 'story' ? new Y.Text() : new Y.Map<unknown>());
  return created;
}

function syncObject(parent: SharedMap, value: Record<string, unknown>, type?: string) {
  const textElement = type === 'elements' && value.type === 'text';
  const wanted = new Map(Object.entries(value).filter(([key, item]) => item !== undefined &&
    !(textElement && derivedText.has(key)) && !(type === 'spreads' && key === 'spreadIndex') && !(type === 'pages' && key === 'pageNumber')));
  for (const key of [...parent.keys()]) if (!wanted.has(key) && key !== 'manuscript') parent.delete(key);
  for (const [key, item] of [...wanted].sort(([a], [b]) => compareKeys(a, b))) syncValue(parent, key, item);
  if (textElement) {
    if (!value.prevFrameId && !value.generated) {
      const node = wrapper(parent, 'manuscript', 'story');
      const plain = !value.storyContent;
      if (node.get('plain') !== plain) node.set('plain', plain);
      const content = value.storyContent as StoryContent || plainStory(String(value.rawStoryText ?? value.text ?? ''));
      syncStory(node.get('data') as Y.Text, content);
    } else parent.delete('manuscript');
  }
}

function syncValue(parent: SharedMap, key: string, value: unknown) {
  if (Array.isArray(value) && collections.has(key)) {
    const node = wrapper(parent, key, 'list'), items = node.get('data') as SharedMap;
    const active = new Set<string>();
    value.forEach((item: Record<string, unknown>, order) => {
      const id = String(key === 'embeddedFonts' ? item.family : item.id);
      active.add(id);
      let record = items.get(id) as SharedMap | undefined;
      if (!(record instanceof Y.Map)) { record = new Y.Map<unknown>(); items.set(id, record); record.set('value', new Y.Map<unknown>()); }
      if (record.get('order') !== order) record.set('order', order);
      if (record.get('deleted') !== false) record.set('deleted', false);
      syncObject(record.get('value') as SharedMap, item, key);
    });
    for (const [id, record] of items.entries()) if (!active.has(id) && (record as SharedMap).get('deleted') !== true) (record as SharedMap).set('deleted', true);
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const node = wrapper(parent, key, 'object'); syncObject(node.get('data') as SharedMap, value as Record<string, unknown>);
  } else if (!same(parent.get(key), value)) parent.set(key, structuredClone(value));
}

function readObject(map: SharedMap): Record<string, unknown> {
  const output = Object.fromEntries([...map.entries()].filter(([key]) => key !== 'manuscript').map(([key, value]) => [key, readValue(value)]));
  if (output.type === 'text') {
    const node = map.get('manuscript') as SharedMap | undefined;
    if (node instanceof Y.Map) {
      const content = decodeStory(node.get('data') as Y.Text);
      output.text = output.rawStoryText = storyText(content);
      if (!node.get('plain')) output.storyContent = content;
    } else output.text = '';
  }
  return output;
}

function readValue(value: unknown): unknown {
  if (!(value instanceof Y.Map)) return structuredClone(value);
  const data = value.get('data') as SharedMap;
  if (value.get('kind') === 'object') return readObject(data);
  if (value.get('kind') === 'list') return [...data.entries()].filter(([, record]) => !(record as SharedMap).get('deleted'))
    .sort(([a, x], [b, y]) => Number((x as SharedMap).get('order')) - Number((y as SharedMap).get('order')) || compareKeys(a, b))
    .map(([, record]) => readObject((record as SharedMap).get('value') as SharedMap));
  throw new Error('Unknown collaborative value type.');
}

export function sharedProject(state: ProjectState): SharedProject {
  return Object.fromEntries(SHARED_PROJECT_KEYS.filter(key => state[key] !== undefined).map(key => [key, state[key]])) as SharedProject;
}

export class CollaborativeDocument {
  readonly doc = new Y.Doc();
  readonly root = this.doc.getMap<unknown>('publication');
  readonly undoManager: Y.UndoManager;
  private listeners = new Set<(update: Uint8Array) => void>();
  private changeListeners = new Set<() => void>();

  constructor(baseline: SharedProject) {
    // Identical sorted seed operations share identities across replicas; independent
    // edits resume under each replica's random actor ID, avoiding duplicated copy.
    const actor = this.doc.clientID; this.doc.clientID = 0;
    this.doc.transact(() => this.syncRoot(baseline), seedOrigin);
    this.doc.clientID = actor || 1;
    this.undoManager = new Y.UndoManager(this.root, { trackedOrigins: new Set([localOrigin]), captureTimeout: 350 });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') for (const listener of this.listeners) listener(update);
      if (origin !== localOrigin) for (const listener of this.changeListeners) listener();
    });
  }

  private syncRoot(snapshot: SharedProject) {
    for (const key of SHARED_PROJECT_KEYS) {
      if (snapshot[key] === undefined) this.root.delete(key); else syncValue(this.root, key, snapshot[key]);
    }
  }

  update(snapshot: SharedProject) { this.doc.transact(() => this.syncRoot(snapshot), localOrigin); }
  apply(update: Uint8Array) {
    if (!update.byteLength || update.byteLength > 64 * 1024 * 1024) throw new Error('Shared document update exceeds 64 MiB.');
    Y.applyUpdate(this.doc, update, 'remote');
  }
  encode(): Uint8Array { return Y.encodeStateAsUpdate(this.doc); }
  snapshot(): SharedProject {
    const result = Object.fromEntries([...this.root.entries()].map(([key, value]) => [key, readValue(value)])) as SharedProject;
    let pageNumber = 1;
    result.spreads.forEach((spread, index) => { spread.spreadIndex = index; spread.pages.forEach(page => { page.pageNumber = pageNumber++; }); });
    result.masterSpreads.forEach(master => master.pages.forEach((page, index) => { page.pageNumber = index + 1; }));
    return result;
  }
  onUpdate(listener: (update: Uint8Array) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onRemoteChange(listener: () => void) { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
  undo() { this.undoManager.undo(); }
  redo() { this.undoManager.redo(); }
  stopCapturing() { this.undoManager.stopCapturing(); }
  destroy() { this.listeners.clear(); this.changeListeners.clear(); this.undoManager.destroy(); this.doc.destroy(); }
}
