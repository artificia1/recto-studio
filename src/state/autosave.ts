import type { ProjectState } from '../types';
import type { ActiveDesktopProject } from './desktopRecovery';
import type { AutosaveJob, RecoveryJson } from './autosaveWorkerClient';
import { RectoDB } from './persistence';

export const AUTOSAVE_KEY = 'recto_project_autosave';
const TIMESTAMP_KEY = `${AUTOSAVE_KEY}_timestamp`;
const WORKER_SNAPSHOT_MIN_LENGTH = 512 * 1024;
const SAVE_INTERVAL_MS = 500;
const MAX_DRAG_SAVE_DELAY_MS = 2000;
const MAX_CAPTURE_DELAY_MS = 2500;
const CAPTURE_BATCH_MS = 8;
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

interface RecoverySession {
  id: string;
  fileName?: string;
}

interface QueuedWrite {
  session: RecoverySession | undefined;
  run: () => Promise<void>;
}

interface BrowserSnapshot {
  json: RecoveryJson;
  updatedAt: number;
  localSaved?: boolean;
}

function saveInWorker(job: AutosaveJob): Promise<boolean> {
  return import('./autosaveWorkerClient').then(client => client.saveProjectInWorker(job)).catch(() => false);
}

function joinRecoveryJson(json: RecoveryJson): string {
  return typeof json === 'string' ? json : json.join('');
}

async function captureProjectJson(state: ProjectState, isCurrent: () => boolean): Promise<string[] | undefined> {
  const shell = JSON.stringify({ ...state, spreads: undefined, masterSpreads: undefined });
  if (!shell?.startsWith('{') || !shell.endsWith('}') || shell.length <= 2) return;
  const parts = [shell.slice(0, -1)];
  let deadline = performance.now() + CAPTURE_BATCH_MS;
  for (const key of ['spreads', 'masterSpreads'] as const) {
    const spreads = state[key];
    parts.push(`,"${key}":[`);
    for (let index = 0; index < spreads.length; index++) {
      if (performance.now() >= deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (!isCurrent()) return;
        deadline = performance.now() + CAPTURE_BATCH_MS;
      }
      if (index) parts.push(',');
      parts.push(JSON.stringify(spreads[index]) ?? 'null');
    }
    parts.push(']');
  }
  parts.push('}');
  return isCurrent() ? parts : undefined;
}

/** Batches edits while keeping asynchronous writes in document order. */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private writes: Promise<void> = Promise.resolve();
  private queuedTail?: QueuedWrite;
  private latestBrowserSnapshot?: BrowserSnapshot;
  private remainingWrites = 0;
  private saveAfterWrite = false;
  private pendingSince = 0;
  private canvasDragActive = false;
  private dragDeferred = false;
  private capture?: object;
  private revision = 0;
  private lastWriteTime = 0;
  private recoverySession?: RecoverySession;
  private desktopRestore?: ActiveDesktopProject & { legacy?: boolean };
  private legacyDesktopState?: ProjectState;
  private status: SaveStatus = 'saved';
  private listeners = new Set<(status: SaveStatus) => void>();

  constructor(private readonly getState: () => ProjectState, private readonly layoutVersion = () => 0) {}

  subscribe(listener: (status: SaveStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: SaveStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach(listener => listener(status));
  }

  schedule() {
    if (typeof window === 'undefined') return;
    if (!this.pending) this.pendingSince = Date.now();
    this.pending = true;
    this.revision++;
    this.setStatus('pending');
    // A bounded batch also saves periodically during continuous editing.
    if (!this.saveAfterWrite && !this.capture) this.timer ??= setTimeout(() => this.startScheduledWrite(), SAVE_INTERVAL_MS);
  }

  setCanvasDragActive(active: boolean) {
    this.canvasDragActive = active;
    if (!active && this.dragDeferred) {
      clearTimeout(this.timer);
      this.dragDeferred = false;
      this.timer = setTimeout(() => this.startScheduledWrite(), 100);
    }
  }

  private startScheduledWrite() {
    this.timer = undefined;
    this.dragDeferred = false;
    if (this.remainingWrites) {
      this.saveAfterWrite = true;
      return;
    }
    // Measure from the first pending edit so continuous drag gestures cannot starve recovery.
    const delay = this.pendingSince + SAVE_INTERVAL_MS + MAX_DRAG_SAVE_DELAY_MS - Date.now();
    if (this.pending && this.canvasDragActive && delay > 0) {
      this.dragDeferred = true;
      this.timer = setTimeout(() => this.startScheduledWrite(), delay);
      return;
    }
    if (this.pending && typeof Worker !== 'undefined' && typeof indexedDB !== 'undefined' &&
        Date.now() - this.pendingSince < MAX_CAPTURE_DELAY_MS) {
      const state = this.getState();
      if (state.spreads.length + state.masterSpreads.length >= 24) {
        const capture = this.capture = {};
        const revision = this.revision;
        const layoutVersion = this.layoutVersion();
        const isCurrent = () => this.capture === capture &&
          this.revision === revision && this.layoutVersion() === layoutVersion;
        const finish = (json?: string[]) => {
          if (this.capture !== capture) return;
          const current = isCurrent();
          this.capture = undefined;
          if (current) void this.savePending(false, json);
          else if (this.pending) this.timer ??= setTimeout(() => this.startScheduledWrite(), 0);
        };
        void captureProjectJson(state, isCurrent).then(finish, () => finish());
        return;
      }
    }
    void this.savePending(false);
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
    this.capture = undefined;
    this.timer = undefined;
    this.dragDeferred = false;
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
    this.capture = undefined;
    this.timer = undefined;
    this.dragDeferred = false;
    this.pending = false;
    this.revision++;
    this.setStatus('saved');
  }

  private writeTime(): number {
    return this.lastWriteTime = Math.max(Date.now(), this.lastWriteTime + 1);
  }

  flush(): Promise<void> {
    if (!this.pending && this.latestBrowserSnapshot) this.saveLocalSnapshot(this.latestBrowserSnapshot);
    return this.savePending(true);
  }

  private savePending(immediate: boolean, prepared?: string[]): Promise<void> {
    clearTimeout(this.timer);
    this.capture = undefined;
    this.timer = undefined;
    this.dragDeferred = false;
    this.saveAfterWrite = false;
    if (!this.pending) return this.writes;
    this.pending = false;
    const revision = this.revision;
    const updatedAt = this.writeTime();
    const session = this.recoverySession;
    if (session) return this.saveCheckpoint(session, revision, updatedAt, true, prepared);
    let json: RecoveryJson;
    try { json = prepared ?? JSON.stringify(this.getState()); }
    catch {
      this.pending = true;
      this.setStatus('error');
      return this.writes;
    }
    const snapshot: BrowserSnapshot = { json, updatedAt };
    this.latestBrowserSnapshot = snapshot;
    const database = typeof indexedDB !== 'undefined';
    const useWorker = database && (typeof json !== 'string' || json.length >= WORKER_SNAPSHOT_MIN_LENGTH) && typeof Worker !== 'undefined';
    // Large scheduled saves use IndexedDB first. A flush on tab exit can still
    // write the exact pending snapshot synchronously while the worker is busy.
    if (immediate || !useWorker) this.saveLocalSnapshot(snapshot);
    this.setStatus('saving');
    return this.enqueueWrite(undefined, async () => {
      let databaseSaved = false;
      if (database) {
        try {
          databaseSaved = useWorker && await saveInWorker({ json, updatedAt });
          if (!databaseSaved) {
            if (snapshot === this.latestBrowserSnapshot) this.saveLocalSnapshot(snapshot);
            await RectoDB.saveProject(JSON.parse(joinRecoveryJson(json)) as ProjectState, updatedAt);
            databaseSaved = true;
          }
        } catch { /* Report failure only when neither storage backend succeeded. */ }
      }
      if (snapshot === this.latestBrowserSnapshot) this.latestBrowserSnapshot = undefined;
      if (revision === this.revision) {
        const saved = !!snapshot.localSaved || databaseSaved;
        this.pending = !saved;
        this.setStatus(saved ? 'saved' : 'error');
      }
    });
  }

  private saveLocalSnapshot(snapshot: BrowserSnapshot) {
    if (snapshot.localSaved !== undefined) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, joinRecoveryJson(snapshot.json));
      localStorage.setItem(TIMESTAMP_KEY, String(snapshot.updatedAt));
      snapshot.localSaved = true;
    } catch { snapshot.localSaved = false; }
  }

  private saveCheckpoint(session: RecoverySession, revision: number, updatedAt: number, recoverable = true,
    prepared?: string[]): Promise<void> {
    const checkpoint = { id: session.id, fileName: session.fileName, recoverable };
    let snapshot: RecoveryJson | ProjectState;
    try {
      // Capture before the next document or edit can change the live state.
      const state = this.getState();
      snapshot = prepared ?? (typeof Worker === 'undefined' || typeof indexedDB === 'undefined'
        ? structuredClone(state) : JSON.stringify(state));
    }
    catch {
      this.pending = recoverable;
      this.setStatus('error');
      return this.writes;
    }
    this.setStatus('saving');
    return this.enqueueWrite(session, async () => {
      let saved = false;
      try {
        saved = (Array.isArray(snapshot) || typeof snapshot === 'string' && snapshot.length >= WORKER_SNAPSHOT_MIN_LENGTH) &&
          await saveInWorker({ json: snapshot, updatedAt, checkpoint });
        if (!saved) {
          const { saveRecoveryCheckpoint } = await import('./desktopRecovery');
          const state = typeof snapshot === 'string' || Array.isArray(snapshot)
            ? JSON.parse(joinRecoveryJson(snapshot)) as ProjectState : snapshot;
          await saveRecoveryCheckpoint(checkpoint.id, state, updatedAt, checkpoint.fileName, checkpoint.recoverable);
          saved = true;
        }
      } catch { /* Keep the current checkpoint pending for a retry. */ }
      if (revision === this.revision) {
        this.pending = recoverable && !saved;
        this.setStatus(saved ? 'saved' : 'error');
      }
    });
  }

  private enqueueWrite(session: RecoverySession | undefined, run: () => Promise<void>): Promise<void> {
    if (this.queuedTail && this.queuedTail.session === session) {
      // Explicit flushes still capture immediately. Keep only the newest snapshot
      // when consecutive writes for the same target have yet to start.
      this.queuedTail.run = run;
      return this.writes;
    }
    const entry = this.queuedTail = { session, run };
    this.remainingWrites++;
    this.writes = this.writes.then(async () => {
      if (this.queuedTail === entry) this.queuedTail = undefined;
      try { await entry.run(); }
      finally {
        this.remainingWrites--;
        if (!this.remainingWrites && this.saveAfterWrite) {
          this.saveAfterWrite = false;
          this.startScheduledWrite();
        }
      }
    });
    return this.writes;
  }

  async recover(hasValidLocalSave?: boolean): Promise<ProjectState | null> {
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
      if (hasValidLocalSave ?? !!localStorage.getItem(AUTOSAVE_KEY)) {
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
