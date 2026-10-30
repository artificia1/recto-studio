import { useRef, useState } from 'preact/hooks';
import type { Update } from '@tauri-apps/plugin-updater';
import { stateManager } from '../state';
import { installSavedUpdate } from '../updateInstaller';

/** Checks only on request; installing an update must never discard pending edits. */
export function AppUpdater() {
  const update = useRef<Update | null>(null);
  const busy = useRef(false);
  const [status, setStatus] = useState('');
  const [available, setAvailable] = useState(false);
  const [working, setWorking] = useState(false);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      if (!update.current) {
        setStatus('Checking for updates…');
        const { check } = await import('@tauri-apps/plugin-updater');
        update.current = await check({ timeout: 20000 });
        setAvailable(!!update.current);
        setStatus(update.current ? `Version ${update.current.version} is ready. Installation will close the app.` : 'You have the latest version.');
      } else {
        let received = 0;
        let total = 0;
        await installSavedUpdate(update.current, stateManager.autosave, event => {
          if (event.event === 'Started') total = event.data.contentLength || 0;
          if (event.event === 'Progress') received += event.data.chunkLength;
          setStatus(event.event === 'Finished' ? 'Preparing update…' : total ? `Downloading update… ${Math.min(100, Math.round(received / total * 100))}%` : 'Downloading update…');
        }, () => setStatus('Saving your publication before installation…'));
        setStatus('Update installed. Reopen Recto Studio to continue.');
        await update.current.close();
        update.current = null;
        setAvailable(false);
      }
    } catch (error) {
      setStatus(`Update failed: ${error instanceof Error ? error.message : String(error)} Try again when you’re connected.`);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return <div className="app-updater">
    <button className="action-btn" disabled={working} onClick={run}>{working ? 'Updating…' : available ? 'Install update' : 'Check for updates'}</button>
    {status && <span className="app-updater-status" role="status">{status}</span>}
  </div>;
}
