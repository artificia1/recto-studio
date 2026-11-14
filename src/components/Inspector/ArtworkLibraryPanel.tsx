import { useEffect, useRef, useState } from 'preact/hooks';
import { savePublicationFile } from '../../desktop';
import { ARTWORK_FILE_LIMIT, captureArtwork, instantiateArtwork, parseReusableArtwork, type ReusableArtwork } from '../../engine/reusableArtwork';
import { stateManager } from '../../state';
import { artworkLibraryChannel, loadArtworkLibrary, removeLibraryArtwork, saveLibraryArtwork } from '../../state/artworkLibrary';
import type { ProjectState } from '../../types';

export function ArtworkLibraryPanel({ state }: { state: ProjectState }) {
  const [records, setRecords] = useState<ReusableArtwork[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [selectedPage, setSelectedPage] = useState('');
  const spread = state.spreads[state.activeSpreadIndex];
  const page = spread.pages.find(page => page.id === selectedPage) || spread.pages[0];
  const channel = useRef<BroadcastChannel | null>(null);
  const readVersion = useRef(0);
  const refresh = async () => {
    const version = ++readVersion.current;
    const next = await loadArtworkLibrary();
    if (version === readVersion.current) setRecords(next);
  };
  const report = (error: unknown) => setMessage(
    error instanceof Error && error.name !== 'QuotaExceededError' ? error.message
      : 'The artwork library could not save. Free up browser storage or download and remove an entry.',
  );

  useEffect(() => {
    if (!open) return;
    const sync = () => void refresh().catch(report);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(artworkLibraryChannel);
      channel.current.onmessage = sync;
    }
    sync();
    return () => {
      readVersion.current++;
      channel.current?.close();
      channel.current = null;
    };
  }, [open]);

  const changeLibrary = async (change: Promise<void>) => {
    await change;
    channel.current?.postMessage('changed');
    await refresh();
  };
  const add = async (record: ReusableArtwork) => {
    await changeLibrary(saveLibraryArtwork(record));
    setMessage('Saved ' + record.name + ' to the library.');
  };
  const act = async (action: () => void | Promise<void>) => {
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  };

  return <details className="publication-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Artwork library</summary>
    <p>Save independent objects to reuse in any document. Download entries to move them to another device.</p>
    <label>Artwork name<input value={name} maxLength={100} onInput={event => setName(event.currentTarget.value)} /></label>
    <div className="publication-actions">
      <button className="sm-btn" disabled={busy || !name.trim() || !state.selectedElementIds.length} onClick={() => void act(async () => {
        await add(captureArtwork(stateManager.getState(), name));
        setName('');
      })}>Save selection</button>
      <label>Import artwork<input type="file" accept=".recto-artwork" disabled={busy} onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void act(async () => {
          if (file.size > ARTWORK_FILE_LIMIT) throw new Error('Artwork files support up to 2 MiB.');
          await add(parseReusableArtwork(await file.text()));
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
        <button className="sm-btn" disabled={busy} onClick={() => void act(() => {
          const { margins, facingPages } = state.settings;
          const x = facingPages && page.side === 'left' ? margins.outsideMm : margins.insideMm;
          stateManager.insertArtwork(instantiateArtwork(record, x, margins.topMm), page.id);
          setMessage('Placed ' + record.name + ' on page ' + page.pageNumber + '.');
        })}>Place</button>
        <button className="sm-btn" disabled={busy} onClick={() => void act(async () => {
          const basename = record.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'artwork';
          await savePublicationFile(basename + '.recto-artwork', new TextEncoder().encode(JSON.stringify(record)), 'application/json');
        })}>Download</button>
        <button className="sm-btn" disabled={busy} onClick={() => void act(() => changeLibrary(removeLibraryArtwork(record.id)))}>Remove</button>
      </div>
    </div>)}
  </details>;
}
