import { useEffect, useRef, useState } from 'preact/hooks';
import { importScribusFile, type ScribusImport } from '../import/scribusImport';
import { useModalFocus } from '../hooks/useModalFocus';
import { stateManager } from '../state';

export default function ScribusImportDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const [result, setResult] = useState<ScribusImport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useModalFocus(true, dialog);
  useEffect(() => () => { active.current = false; }, []);

  const read = async (file?: File) => {
    setResult(undefined);
    setError('');
    if (!file) return;
    setBusy(true);
    try {
      const next = await importScribusFile(file);
      if (active.current) setResult(next);
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const open = () => {
    if (!result) return;
    try { stateManager.loadFromJson(JSON.stringify(result.project)); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <div className="modal-overlay" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
    <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="scribus-import-title" ref={dialog}
      style={{ width: 'min(540px, 94vw)', maxHeight: '90vh' }}>
      <header className="modal-header">
        <h2 className="modal-title" id="scribus-import-title">Import Scribus document</h2>
        <button className="modal-close-btn" onClick={onClose}>Close</button>
      </header>
      <div style={{ padding: '14px 18px', overflowY: 'auto' }}>
        <p>Choose a Scribus 1.6 document to see what will carry over before opening it.</p>
        <input type="file" aria-label="Scribus document" accept=".sla,.gz" disabled={busy} onChange={event => void read(event.currentTarget.files?.[0])} />
        {busy && <p role="status">Reading Scribus document…</p>}
        {error && <p role="alert">{error}</p>}
        {result && <>
          <p role="status"><strong>{result.project.settings.title}</strong><br />
            {result.project.spreads.length} page(s) · {result.imported} editable object(s) · {result.skipped} skipped</p>
          {!!result.warnings.length && <ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <p>Opening replaces the current document. Save your work before continuing.</p>
        </>}
      </div>
      <footer className="modal-footer">
        <button className="sm-btn" onClick={onClose}>Cancel</button>
        <button className="sm-btn" disabled={!result || busy} onClick={open}>Open in Recto</button>
      </footer>
    </div>
  </div>;
}
