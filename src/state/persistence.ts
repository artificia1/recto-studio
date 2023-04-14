import { ProjectState } from '../types/index';

const DB_NAME = 'PapercutStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const RECORD_ID = 'active_project';

export class PapercutDB {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  public static async getDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB not supported in this environment');
    }

    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    return this.dbPromise;
  }

  public static async saveProject(state: ProjectState): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          id: RECORD_ID,
          state: JSON.parse(JSON.stringify(state)),
          updatedAt: Date.now(),
        };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      // Fallback silently if IndexedDB is disabled or in test environments
      console.warn('IndexedDB save skipped:', e);
    }
  }

  public static async loadProject(): Promise<ProjectState | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(RECORD_ID);
        req.onsuccess = () => {
          if (req.result && req.result.state) {
            resolve(req.result.state);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  public static exportProjectFile(state: ProjectState) {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'project'}.papercut`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public static async importProjectFile(file: File): Promise<ProjectState> {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed.settings || !parsed.spreads) {
      throw new Error('Invalid Papercut document structure');
    }
    return parsed as ProjectState;
  }
}
