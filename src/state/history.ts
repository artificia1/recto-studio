import type { CanvasElement, Spread } from '../types';

const payloadFields = ['src', 'proxySrc', 'text', 'rawStoryText', 'storyContent', 'textContent'] as const;
type PayloadField = typeof payloadFields[number];
type Payload = { index: number; field: PayloadField; data: string; encoded: boolean };
type SpreadSnapshot = string | { shell: string; payloads: Payload[] };
type Snapshot = string | { document: string; spreads: SpreadSnapshot[] };

function saveSpread(value: unknown, previous?: SpreadSnapshot): SpreadSnapshot {
  const spread = value as Partial<Spread> | null;
  if (Array.isArray(spread?.elements)) {
    let elements: CanvasElement[] | undefined;
    const payloads: Payload[] = [];
    spread.elements.forEach((element, index) => {
      if (element?.type !== 'text' && element?.type !== 'image') return;
      const fields = element as unknown as Partial<Record<PayloadField, unknown>>;
      for (const field of payloadFields) {
        const value = fields[field];
        const length = typeof value === 'string' ? value.length : 0;
        const largeStory = field === 'storyContent' && element.type === 'text' && element.storyContent &&
          ((element.rawStoryText?.length || 0) >= 32_768 || (element.storyContent.paragraphs?.length || 0) >= 128);
        const largeSlice = field === 'textContent' && element.type === 'text' && element.textContent &&
          ((element.text?.length || 0) >= 32_768 || (element.textContent.paragraphs?.length || 0) >= 128);
        if (length < 32_768 && !largeStory && !largeSlice) continue;
        const encoded = typeof value !== 'string';
        const data = encoded ? JSON.stringify(value) : value;
        const before = typeof previous === 'object' ? previous.payloads[payloads.length] : undefined;
        payloads.push(before?.index === index && before.field === field && before.data === data && before.encoded === encoded
          ? before : { index, field, data, encoded });
        elements ??= spread.elements!.slice();
        if (elements[index] === element) elements[index] = { ...element };
        (elements[index] as unknown as Record<PayloadField, unknown>)[field] = null;
      }
    });
    if (elements) {
      const shell = JSON.stringify({ ...spread, elements });
      if (typeof previous === 'object' && previous.shell === shell) {
        if (payloads.length === previous.payloads.length && payloads.every((part, index) => part === previous.payloads[index])) return previous;
        return { shell: previous.shell, payloads };
      }
      return { shell, payloads };
    }
  }
  const json = JSON.stringify(value) ?? 'null';
  return json === previous ? previous : json;
}

function readSpread(snapshot: SpreadSnapshot): unknown {
  if (typeof snapshot === 'string') return JSON.parse(snapshot);
  const spread = JSON.parse(snapshot.shell);
  for (const { index, field, data, encoded } of snapshot.payloads) {
    spread.elements[index][field] = encoded ? JSON.parse(data) : data;
  }
  return spread;
}

/** Bounded JSON history. Only undo and redo materialize a document. */
export class StateHistory<T> {
  private entries: Snapshot[] = [];
  private index = -1;

  constructor(private readonly limit = 30, private readonly spreadKey?: keyof T & string) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a positive integer.');
  }

  private encode(value: T): Snapshot {
    const key = this.spreadKey;
    if (!key || !Array.isArray(value?.[key])) {
      const json = JSON.stringify(value);
      if (json === undefined) throw new TypeError('History requires a JSON value.');
      return json;
    }
    const previous = this.entries[this.index];
    const prior = typeof previous === 'object' ? previous : undefined;
    const document = JSON.stringify({ ...value, [key]: null });
    return {
      document: document === prior?.document ? prior.document : document,
      spreads: Array.from(value[key] as unknown[], (spread, index) => saveSpread(spread, prior?.spreads[index])),
    };
  }

  private restore(snapshot: Snapshot): T {
    if (typeof snapshot === 'string') return JSON.parse(snapshot);
    const document = JSON.parse(snapshot.document);
    document[this.spreadKey!] = snapshot.spreads.map(readSpread);
    return document;
  }

  push(value: T): void {
    const snapshot = this.encode(value);
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(snapshot);
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
  }

  undo(): T | null {
    if (this.index <= 0) return null;
    return this.restore(this.entries[--this.index]);
  }

  redo(): T | null {
    if (this.index >= this.entries.length - 1) return null;
    return this.restore(this.entries[++this.index]);
  }

  clear(): void {
    this.entries = [];
    this.index = -1;
  }
}
