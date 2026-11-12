import type { ProjectState } from '../types';

export interface RecoveryEntry {
  id: string;
  title: string;
  fileName?: string;
  updatedAt: number;
}

export interface ActiveDesktopProject {
  sessionId: string;
  fileName?: string;
  state: ProjectState;
}

const STORE = 'checkpoints';
const UPDATED_AT = 'updatedAt';
const ACTIVE_PROJECT = 'active-project';
let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local recovery storage is unavailable.'));
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('RectoStudioRecovery', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex(UPDATED_AT, 'updatedAt');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open local recovery storage.'));
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function write(update: (store: IDBObjectStore) => void): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('The recovery checkpoint could not be saved.'));
    try { update(transaction.objectStore(STORE)); }
    catch (error) { transaction.abort(); reject(error); }
  });
}

async function read<T>(query: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = query(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not read local recovery storage.'));
  });
}

const snapshotKey = (id: string) => `project:${id}`;

export function saveRecoveryCheckpoint(id: string, state: ProjectState, updatedAt: number, fileName?: string,
  recoverable = true): Promise<void> {
  return write(store => {
    if (recoverable) {
      // The date index only includes summaries, so listing never reads document or asset bytes.
      store.put({ id: snapshotKey(id), state });
      store.put({ id, title: state.settings.title, fileName, updatedAt } satisfies RecoveryEntry);
      store.put({ id: ACTIVE_PROJECT, sessionId: id, fileName });
    } else {
      // Only the most recent clean document is resumable, with no recovery entry.
      store.put({ id: ACTIVE_PROJECT, sessionId: id, fileName, state });
      store.delete(snapshotKey(id));
      store.delete(id);
    }
  });
}

/** Undefined denotes an older profile with no desktop resume record yet. */
export async function loadActiveDesktopProject(): Promise<ActiveDesktopProject | null | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const store = transaction.objectStore(STORE);
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not read the active desktop project.'));
    const active = store.get(ACTIVE_PROJECT);
    active.onsuccess = () => {
      const record = active.result;
      if (!record) { resolve(undefined); return; }
      if (!record.sessionId) { resolve(null); return; }
      const { sessionId, fileName, state } = record;
      if (state) { resolve({ sessionId, fileName, state }); return; }
      const checkpoint = store.get(snapshotKey(sessionId));
      checkpoint.onsuccess = () => resolve(checkpoint.result ? { sessionId, fileName, state: checkpoint.result.state } : null);
    };
  });
}

export async function listRecoveryCheckpoints(): Promise<RecoveryEntry[]> {
  const entries = await read<RecoveryEntry[]>(store => store.index(UPDATED_AT).getAll());
  return entries.reverse();
}

export async function loadRecoveryCheckpoint(id: string): Promise<ProjectState | undefined> {
  const snapshot = await read<{ state: ProjectState } | undefined>(store => store.get(snapshotKey(id)));
  return snapshot?.state;
}

export function removeRecoveryCheckpoint(id: string): Promise<void> {
  return write(store => {
    store.delete(snapshotKey(id));
    store.delete(id);
    const active = store.get(ACTIVE_PROJECT);
    active.onsuccess = () => {
      if (active.result?.sessionId === id && !active.result.state) store.put({ id: ACTIVE_PROJECT });
    };
  });
}
