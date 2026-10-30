/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { ProjectState } from '../types/index';
import { parseProject } from './projectValidation';

const DB_NAME = 'RectoStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const RECORD_ID = 'active_project';

export class RectoDB {
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
        req.onerror = () => {
          this.dbPromise = null;
          reject(req.error);
        };
      });
    }

    return this.dbPromise;
  }

  public static async saveProject(state: ProjectState, updatedAt = Date.now()): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        id: RECORD_ID,
        state: JSON.parse(JSON.stringify(state)),
        updatedAt,
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Autosave transaction aborted'));
      tx.onerror = () => reject(tx.error);
      store.put(record);
    });
  }

  public static async loadProject(): Promise<ProjectState | null> {
    return (await this.loadProjectRecord())?.state || null;
  }

  public static async loadProjectRecord(): Promise<{ state: ProjectState; updatedAt: number } | null> {
    try {
      const db = await this.getDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(RECORD_ID);
        req.onsuccess = () => {
          if (req.result && req.result.state) {
            resolve({ state: req.result.state, updatedAt: req.result.updatedAt || 0 });
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
    a.download = `${state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'project'}.recto`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public static async importProjectFile(file: File, defaults: ProjectState): Promise<ProjectState> {
    const text = await file.text();
    return parseProject(text, defaults);
  }
}

// Backward compatibility alias
export const PapercutDB = RectoDB;
