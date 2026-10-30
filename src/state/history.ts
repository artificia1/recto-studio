/** Bounded document history. Stored and restored values never share references. */
export class StateHistory<T> {
  private entries: T[] = [];
  private index = -1;

  constructor(private readonly limit = 30) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a positive integer.');
  }

  private clone(value: T): T {
    // Preserve the document's existing JSON serialization behavior.
    return JSON.parse(JSON.stringify(value));
  }

  push(value: T): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(this.clone(value));
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
  }

  undo(): T | null {
    if (this.index <= 0) return null;
    return this.clone(this.entries[--this.index]);
  }

  redo(): T | null {
    if (this.index >= this.entries.length - 1) return null;
    return this.clone(this.entries[++this.index]);
  }

  clear(): void {
    this.entries = [];
    this.index = -1;
  }
}
