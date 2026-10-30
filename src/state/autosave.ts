import type { ProjectState } from '../types';
import { RectoDB } from './persistence';

export const AUTOSAVE_KEY = 'recto_project_autosave';
const TIMESTAMP_KEY = `${AUTOSAVE_KEY}_timestamp`;
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/** Batches edits while keeping asynchronous writes in document order. */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private writes: Promise<void> = Promise.resolve();
  private revision = 0;
  private status: SaveStatus = 'saved';
  private listeners = new Set<(status: SaveStatus) => void>();

  constructor(private readonly getState: () => ProjectState) {}

  subscribe(listener: (status: SaveStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: SaveStatus) {
    this.status = status;
    this.listeners.forEach(listener => listener(status));
  }

  schedule() {
    if (typeof window === 'undefined') return;
    this.pending = true;
    this.revision++;
    this.setStatus('pending');
    // A bounded batch also saves periodically during continuous editing.
    this.timer ??= setTimeout(() => { void this.flush(); }, 500);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return this.writes;
    this.pending = false;
    const revision = this.revision;
    const updatedAt = Date.now();
    const state = JSON.parse(JSON.stringify(this.getState())) as ProjectState;
    let localSaved = false;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
      localStorage.setItem(TIMESTAMP_KEY, String(updatedAt));
      localSaved = true;
    } catch { /* IndexedDB can still save documents exceeding localStorage quota. */ }
    this.setStatus('saving');
    this.writes = this.writes.then(async () => {
      let databaseSaved = false;
      if (typeof indexedDB !== 'undefined') {
        try {
          await RectoDB.saveProject(state, updatedAt);
          databaseSaved = true;
        } catch { /* Report failure only when neither storage backend succeeded. */ }
      }
      if (revision === this.revision) {
        this.setStatus(localSaved || databaseSaved ? 'saved' : 'error');
      }
    });
    return this.writes;
  }

  async recover(): Promise<ProjectState | null> {
    const record = await RectoDB.loadProjectRecord();
    if (!record) return null;
    let localTimestamp = 0;
    try {
      if (localStorage.getItem(AUTOSAVE_KEY)) {
        localTimestamp = Number(localStorage.getItem(TIMESTAMP_KEY)) || 0;
      }
    } catch {}
    return record.updatedAt > localTimestamp ? record.state : null;
  }
}
