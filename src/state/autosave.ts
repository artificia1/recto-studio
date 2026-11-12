import type { ProjectState } from '../types';
import type { ActiveDesktopProject } from './desktopRecovery';
import { RectoDB } from './persistence';

export const AUTOSAVE_KEY = 'recto_project_autosave';
const TIMESTAMP_KEY = `${AUTOSAVE_KEY}_timestamp`;
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

interface RecoverySession {
  id: string;
  fileName?: string;
}

/** Batches edits while keeping asynchronous writes in document order. */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private writes: Promise<void> = Promise.resolve();
  private revision = 0;
  private lastWriteTime = 0;
  private recoverySession?: RecoverySession;
  private desktopRestore?: ActiveDesktopProject & { legacy?: boolean };
  private legacyDesktopState?: ProjectState;
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

  beginDesktopDocument(fileName?: string, legacyState?: ProjectState | null) {
    if (this.recoverySession) void this.flush();
    this.legacyDesktopState = legacyState ?? undefined;
    this.recoverySession = { id: crypto.randomUUID(), fileName };
    this.revision++;
    this.pending = false;
    this.setStatus('saved');
  }

  markDesktopSaved(fileName: string, isCurrentRevision: boolean) {
    const session = this.recoverySession;
    if (!session) return;
    session.fileName = fileName;
    if (!isCurrentRevision) {
      this.schedule();
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
    void this.saveCheckpoint(session, ++this.revision, this.writeTime(), false);
  }

  finishDesktopRestore(state: ProjectState) {
    const restored = this.desktopRestore;
    this.desktopRestore = undefined;
    if (!restored || restored.state !== state) return;
    this.recoverySession = { id: restored.sessionId, fileName: restored.fileName };
    if (restored.legacy) return; // The install notification migrates the old snapshot.
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
    this.revision++;
    this.setStatus('saved');
  }

  private writeTime(): number {
    return this.lastWriteTime = Math.max(Date.now(), this.lastWriteTime + 1);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return this.writes;
    this.pending = false;
    const revision = this.revision;
    const updatedAt = this.writeTime();
    const session = this.recoverySession;
    if (session) return this.saveCheckpoint(session, revision, updatedAt);
    let json: string;
    try { json = JSON.stringify(this.getState()); }
    catch {
      this.pending = true;
      this.setStatus('error');
      return this.writes;
    }
    const state = JSON.parse(json) as ProjectState;
    let localSaved = false;
    try {
      localStorage.setItem(AUTOSAVE_KEY, json);
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
        const saved = localSaved || databaseSaved;
        this.pending = !saved;
        this.setStatus(saved ? 'saved' : 'error');
      }
    });
    return this.writes;
  }

  private saveCheckpoint(session: RecoverySession, revision: number, updatedAt: number, recoverable = true): Promise<void> {
    const fileName = session.fileName;
    let state: ProjectState;
    try { state = structuredClone(this.getState()); }
    catch {
      this.pending = recoverable;
      this.setStatus('error');
      return this.writes;
    }
    this.setStatus('saving');
    this.writes = this.writes.then(async () => {
      let saved = false;
      try {
        await (await import('./desktopRecovery')).saveRecoveryCheckpoint(session.id, state, updatedAt, fileName, recoverable);
        saved = true;
      } catch { /* Keep the current checkpoint pending for a retry. */ }
      if (revision === this.revision) {
        this.pending = recoverable && !saved;
        this.setStatus(saved ? 'saved' : 'error');
      }
    });
    return this.writes;
  }

  async recover(hasValidLocalSave = true): Promise<ProjectState | null> {
    const session = this.recoverySession;
    if (session) {
      try {
        const active = await (await import('./desktopRecovery')).loadActiveDesktopProject();
        if (active !== undefined) {
          this.legacyDesktopState = undefined;
          this.desktopRestore = active ?? undefined;
          return active?.state ?? null;
        }
      } catch { /* Older active autosave remains available if desktop storage fails. */ }
    }
    const record = await RectoDB.loadProjectRecord();
    let localTimestamp = 0;
    try {
      if (hasValidLocalSave && localStorage.getItem(AUTOSAVE_KEY)) {
        localTimestamp = Number(localStorage.getItem(TIMESTAMP_KEY)) || 0;
      }
    } catch {}
    const newer = record && record.updatedAt > localTimestamp ? record.state : null;
    if (!session) return newer;
    const legacy = newer ?? this.legacyDesktopState ?? null;
    if (legacy) this.desktopRestore = { sessionId: session.id, fileName: session.fileName, state: legacy, legacy: true };
    return legacy;
  }
}
