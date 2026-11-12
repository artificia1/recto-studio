import { useEffect, useRef, useState } from 'preact/hooks';
import { useModalFocus } from '../hooks/useModalFocus';
import {
  listRecoveryCheckpoints,
  loadRecoveryCheckpoint,
  removeRecoveryCheckpoint,
  type RecoveryEntry,
} from '../state/desktopRecovery';
import type { ProjectState } from '../types';
import './recoveryDialog.css';

interface RecoveryDialogProps {
  onClose(): void;
  onRecover(state: ProjectState): Promise<void>;
}

export default function RecoveryDialog({ onClose, onRecover }: RecoveryDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<RecoveryEntry[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState<string>();
  useModalFocus(true, dialog);

  useEffect(() => {
    let active = true;
    listRecoveryCheckpoints().then(result => {
      if (active) setEntries(result);
    }, reason => {
      if (active) setError(String(reason instanceof Error ? reason.message : reason));
    });
    return () => { active = false; };
  }, []);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setBusy(false); }
  };

  const recover = (id: string) => run(async () => {
    const checkpoint = await loadRecoveryCheckpoint(id);
    if (!checkpoint) throw new Error('This checkpoint is no longer available.');
    await onRecover(checkpoint);
    onClose();
  });

  const remove = (id: string) => run(async () => {
    await removeRecoveryCheckpoint(id);
    setEntries(current => current?.filter(entry => entry.id !== id));
    setDiscard(undefined);
  });

  return <div className="modal-overlay" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) onClose();
  }}>
    <div className="modal-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-title" ref={dialog}>
      <header className="modal-header">
        <h2 id="recovery-title" className="modal-title">Project Recovery</h2>
        <button className="modal-close-btn" disabled={busy} onClick={onClose}>Close</button>
      </header>
      <div className="recovery-content">
        <p>Opening a checkpoint replaces the current workspace with an editable copy. Use Save As to choose its file.</p>
        {!entries && !error && <p role="status">Looking for local checkpoints…</p>}
        {entries?.length === 0 && <p role="status">No project checkpoints are stored on this device.</p>}
        {error && <p role="alert">{error}</p>}
        {!!entries?.length && <ul className="recovery-list">
          {entries.map(entry => <li key={entry.id} className="recovery-row">
            <div className="recovery-entry">
              <strong>{entry.title || 'Untitled project'}</strong>
              <span>{entry.fileName || 'Unsaved project'} · <time dateTime={new Date(entry.updatedAt).toISOString()}>
                {new Date(entry.updatedAt).toLocaleString()}
              </time></span>
            </div>
            <div className="recovery-actions">
              {discard === entry.id ? <>
                <button className="sm-btn" disabled={busy} onClick={() => void remove(entry.id)}>Confirm discard</button>
                <button className="sm-btn" disabled={busy} onClick={() => setDiscard(undefined)}>Cancel</button>
              </> : <>
                <button className="sm-btn" disabled={busy} onClick={() => void recover(entry.id)}
                  aria-label={`Recover ${entry.title || 'Untitled project'}`}>Recover</button>
                <button className="sm-btn" disabled={busy} onClick={() => setDiscard(entry.id)}
                  aria-label={`Discard checkpoint for ${entry.title || 'Untitled project'}`}>Discard</button>
              </>}
            </div>
          </li>)}
        </ul>}
      </div>
    </div>
  </div>;
}
