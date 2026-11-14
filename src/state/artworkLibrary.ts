import { parseReusableArtwork, type ReusableArtwork } from '../engine/reusableArtwork';
import { ARTWORK_STORE, RectoDB } from './persistence';

const legacyKey = 'recto-artwork-library-v1';
const migrationId = 'legacy-library-migrated';
const entryLimit = 30;
export const artworkLibraryChannel = 'recto-artwork-library';

interface StoredArtwork {
  id: string;
  savedAt: number;
  artwork: ReusableArtwork;
}

async function artworkTransaction<T>(mode: IDBTransactionMode, action: (
  store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void,
) => void): Promise<T> {
  const db = await RectoDB.getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARTWORK_STORE, mode);
    let result: T;
    let failure: Error | undefined;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The artwork library transaction did not finish.'));
    const fail = (error: Error) => { failure = error; tx.abort(); };
    action(tx.objectStore(ARTWORK_STORE), value => { result = value; }, fail);
  });
}

async function migrateLegacyLibrary(): Promise<void> {
  let raw: string | null;
  try { raw = localStorage.getItem(legacyKey); }
  catch { return; }
  if (!raw || raw.length > 3 * 1024 * 1024) return;

  let legacy: unknown;
  try { legacy = JSON.parse(raw); }
  catch { return; }
  if (!Array.isArray(legacy)) return;
  const artwork = legacy.slice(0, entryLimit).flatMap((record: unknown) => {
    try { return [parseReusableArtwork(JSON.stringify(record))]; }
    catch { return []; }
  });

  await artworkTransaction<void>('readwrite', (store, done) => {
    const request = store.getAllKeys();
    request.onsuccess = () => {
      const seen = new Set(request.result);
      if (!seen.has(migrationId)) {
        for (const [index, record] of artwork.entries()) {
          if (seen.has(record.id)) continue;
          seen.add(record.id);
          store.put({ id: record.id, savedAt: -index, artwork: record } satisfies StoredArtwork);
        }
        store.put({ id: migrationId });
      }
      done();
    };
  });
  try { if (localStorage.getItem(legacyKey) === raw) localStorage.removeItem(legacyKey); }
  catch { /* The committed migration marker prevents duplicate imports. */ }
}

export async function loadArtworkLibrary(): Promise<ReusableArtwork[]> {
  await migrateLegacyLibrary();
  return artworkTransaction('readonly', (store, done) => {
    const request: IDBRequest<(StoredArtwork | { id: typeof migrationId })[]> = store.getAll();
    request.onsuccess = () => done(request.result.filter((record): record is StoredArtwork => 'artwork' in record)
      .sort((a, b) => b.savedAt - a.savedAt).map(record => record.artwork));
  });
}

export async function saveLibraryArtwork(artwork: ReusableArtwork): Promise<void> {
  await migrateLegacyLibrary();
  return artworkTransaction('readwrite', (store, done, fail) => {
    const request = store.getAllKeys();
    request.onsuccess = () => {
      const ids = request.result;
      const count = ids.includes(migrationId) ? ids.length - 1 : ids.length;
      if (count >= entryLimit && !ids.includes(artwork.id)) {
        fail(new Error('The local library holds up to 30 entries. Download and remove an entry to make room.'));
        return;
      }
      store.put({ id: artwork.id, savedAt: Date.now(), artwork } satisfies StoredArtwork);
      done();
    };
  });
}

export async function removeLibraryArtwork(id: string): Promise<void> {
  await migrateLegacyLibrary();
  return artworkTransaction('readwrite', (store, done) => { store.delete(id); done(); });
}
