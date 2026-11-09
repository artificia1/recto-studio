import { useEffect, useState } from 'preact/hooks';
import { savePublicationFile } from '../../desktop';
import { ARTWORK_FILE_LIMIT, captureArtwork, instantiateArtwork, parseReusableArtwork, type ReusableArtwork } from '../../engine/reusableArtwork';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';

const KEY = 'recto-artwork-library-v1';
const STORAGE_LIMIT = 3 * 1024 * 1024;

function readLibrary(): ReusableArtwork[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > STORAGE_LIMIT) return [];
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records)) return [];
    return records.slice(0, 30).flatMap(record => {
      try { return [parseReusableArtwork(JSON.stringify(record))]; }
      catch { return []; }
    });
  } catch { return []; }
}

export function ArtworkLibraryPanel({ state }: { state: ProjectState }) {
  const [records, setRecords] = useState(readLibrary);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [selectedPage, setSelectedPage] = useState('');
  const spread = state.spreads[state.activeSpreadIndex];
  const page = spread.pages.find(page => page.id === selectedPage) || spread.pages[0];
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === KEY) setRecords(readLibrary()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const save = (next: ReusableArtwork[]) => {
    const json = JSON.stringify(next);
    if (next.length > 30 || json.length > STORAGE_LIMIT) throw new Error('The local library is full. Download and remove an entry to make room.');
    localStorage.setItem(KEY, json);
    setRecords(next);
  };
  const add = (record: ReusableArtwork) => {
    save([record, ...readLibrary().filter(item => item.id !== record.id)]);
    setMessage('Saved ' + record.name + ' to the library.');
  };
  const act = async (action: () => void | Promise<void>) => {
    setMessage('');
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <details className="publication-panel">
    <summary>Artwork library</summary>
    <p>Save independent objects to reuse in any document. Download entries to move them to another device.</p>
    <label>Artwork name<input value={name} maxLength={100} onInput={event => setName(event.currentTarget.value)} /></label>
    <div className="publication-actions">
      <button className="sm-btn" disabled={!name.trim() || !state.selectedElementIds.length} onClick={() => void act(() => {
        add(captureArtwork(stateManager.getState(), name));
        setName('');
      })}>Save selection</button>
      <label>Import artwork<input type="file" accept=".recto-artwork" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void act(async () => {
          if (file.size > ARTWORK_FILE_LIMIT) throw new Error('Artwork files support up to 2 MiB.');
          add(parseReusableArtwork(await file.text()));
        });
      }} /></label>
    </div>
    {spread.pages.length > 1 && <label>Place on page<select value={page.id} onChange={event => setSelectedPage(event.currentTarget.value)}>
      {spread.pages.map(page => <option key={page.id} value={page.id}>Page {page.pageNumber}</option>)}
    </select></label>}
    {message && <p role="status">{message}</p>}
    {records.map(record => <div className="publication-panel" key={record.id}>
      <strong>{record.name}</strong><p>{record.elements.length} object(s)</p>
      <div className="publication-actions">
        <button className="sm-btn" onClick={() => void act(() => {
          const { margins, facingPages } = state.settings;
          const x = facingPages && page.side === 'left' ? margins.outsideMm : margins.insideMm;
          stateManager.insertArtwork(instantiateArtwork(record, x, margins.topMm), page.id);
          setMessage('Placed ' + record.name + ' on page ' + page.pageNumber + '.');
        })}>Place</button>
        <button className="sm-btn" onClick={() => void act(async () => {
          const basename = record.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'artwork';
          await savePublicationFile(basename + '.recto-artwork', new TextEncoder().encode(JSON.stringify(record)), 'application/json');
        })}>Download</button>
        <button className="sm-btn" onClick={() => void act(() => save(readLibrary().filter(item => item.id !== record.id)))}>Remove</button>
      </div>
    </div>)}
  </details>;
}
