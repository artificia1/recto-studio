type HistoryValue = null | string | number | boolean | HistoryValue[] | HistoryRecord;
type HistoryRecord = { [key: string]: HistoryValue };
type SpreadSnapshot = { value: HistoryValue } | { json: string };
type Snapshot = string | { document: string; spreads: SpreadSnapshot[] };

const useJson = Symbol('Use native JSON serialization');

function capture(value: unknown, previous: HistoryValue | undefined,
  tableCells: WeakMap<unknown[], HistoryValue>, depth = 0): HistoryValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value || 0 : null;
  if (typeof value !== 'object' || depth >= 64 || typeof (value as { toJSON?: unknown }).toJSON === 'function') throw useJson;

  if (Array.isArray(value)) {
    const prior = Array.isArray(previous) ? previous : undefined;
    let next: HistoryValue[] | undefined;
    for (let index = 0; index < value.length; index++) {
      const item = capture(value[index] ?? null, prior?.[index], tableCells, depth + 1);
      if (!next && (!prior || item !== prior[index])) next = prior?.slice(0, index) ?? [];
      next?.push(item);
    }
    return next ?? (prior?.length === value.length ? prior : prior?.slice(0, value.length) ?? []);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw useJson;
  const record = value as Record<string, unknown>;
  const prior = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : undefined;
  const previousKeys = prior ? Object.keys(prior) : [];
  let count = 0;
  let next: HistoryRecord | undefined;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child === undefined) continue;
    if (key === '__proto__') throw useJson;

    let item: HistoryValue;
    if (key === 'cells' && Array.isArray(child)) {
      const shared = tableCells.get(child);
      item = shared ?? capture(child, prior?.[key], tableCells, depth + 1);
      if (!shared) tableCells.set(child, item);
    } else {
      item = capture(child, prior?.[key], tableCells, depth + 1);
    }
    if (!next && (key !== previousKeys[count] || item !== prior?.[key])) {
      next = {};
      for (let index = 0; index < count; index++) {
        const name = previousKeys[index];
        next[name] = prior![name];
      }
    }
    if (next) next[key] = item;
    count++;
  }
  if (next) return next;
  if (!prior) return {};
  if (count === previousKeys.length) return prior;
  return Object.fromEntries(previousKeys.slice(0, count).map(key => [key, prior[key]]));
}

function saveSpread(value: unknown, tableCells: WeakMap<unknown[], HistoryValue>, previous?: SpreadSnapshot): SpreadSnapshot {
  try {
    const prior = previous && 'value' in previous ? previous : undefined;
    const snapshot = capture(value, prior?.value, tableCells);
    return prior && snapshot === prior.value ? prior : { value: snapshot };
  } catch (error) {
    if (error !== useJson) throw error;
    const json = JSON.stringify(value) ?? 'null';
    return previous && 'json' in previous && previous.json === json ? previous : { json };
  }
}

function copySnapshot(value: HistoryValue): HistoryValue {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copySnapshot);
  const copy: HistoryRecord = {};
  for (const key of Object.keys(value)) copy[key] = copySnapshot(value[key]);
  return copy;
}

/** Bounded document history. Unchanged JSON data is shared only inside history. */
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
    const tableCells = new WeakMap<unknown[], HistoryValue>();
    return {
      document: document === prior?.document ? prior.document : document,
      spreads: Array.from(value[key] as unknown[], (spread, index) => saveSpread(spread, tableCells, prior?.spreads[index])),
    };
  }

  private restore(snapshot: Snapshot): T {
    if (typeof snapshot === 'string') return JSON.parse(snapshot);
    const document = JSON.parse(snapshot.document);
    // Copy each reference independently, including repeated table cell data.
    document[this.spreadKey!] = snapshot.spreads.map(spread => 'json' in spread ? JSON.parse(spread.json) : copySnapshot(spread.value));
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
