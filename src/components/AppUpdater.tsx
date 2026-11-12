import { useEffect, useRef, useState } from 'preact/hooks';
import { getVersion } from '@tauri-apps/api/app';
import type { Update } from '@tauri-apps/plugin-updater';
import { stateManager } from '../state';
import { installSavedUpdate } from '../updateInstaller';
import './appUpdater.css';

const failures = {
  check: 'Could not check for updates.',
  download: 'Could not download or verify the update.',
  save: 'Installation paused.',
  install: 'Could not start the installer.',
};

/** The native plugin verifies the package before making it available for installation. */
export function AppUpdater() {
  const [offer, setOffer] = useState<Update | null>(null);
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState(false);
  const downloaded = useRef(false);
  const busy = useRef(false);

  useEffect(() => () => {
    // Dismissing an offer releases both the update and any downloaded installer.
    if (offer) void offer.close().catch(() => {});
  }, [offer]);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    let stage: keyof typeof failures = 'check';
    try {
      if (!offer) {
        setStatus('Checking for updates…');
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check({ timeout: 20000 });
        setOffer(update);
        if (update) {
          setStatus(`Version ${update.version} is ready. Installation will close the app.`);
        } else {
          const version = await getVersion().catch(() => '');
          setStatus(version ? `Recto Studio ${version} is up to date.` : 'You have the latest version.');
        }
        return;
      }

      if (!downloaded.current) {
        stage = 'download';
        const message = `Downloading version ${offer.version}…`;
        setStatus(message);
        let received = 0;
        let total: number | undefined;
        await offer.download(event => {
          if (event.event === 'Started') total = event.data.contentLength;
          if (event.event === 'Progress') {
            received += event.data.chunkLength;
            if (total) setStatus(`${message} ${Math.min(100, Math.round(received / total * 100))}%`);
          }
          if (event.event === 'Finished') setStatus('Verifying update…');
        }, { timeout: 120000 });
        downloaded.current = true;
      }

      stage = 'save';
      setStatus('Saving your publication before installation…');
      // A canvas text edit commits on blur, including one started during the download.
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.matches('input, textarea') || active.isContentEditable)) active.blur();
      await installSavedUpdate(offer, stateManager.autosave, () => {
        stage = 'install';
        setStatus('Starting the installer…');
      });
      setOffer(null);
      downloaded.current = false;
      setStatus('Update installed. Reopen Recto Studio to continue.');
    } catch (error) {
      setStatus(`${failures[stage]} ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  function dismiss() {
    setOffer(null);
    downloaded.current = false;
    setStatus('');
  }

  return <div className="app-updater">
    <button className="action-btn" type="button" disabled={working} onClick={run}>
      {working ? 'Updating…' : offer ? 'Install update' : 'Check for updates'}
    </button>
    {status && <div className="app-updater-status">
      <div role="status">{status}</div>
      {offer && <div className="app-updater-version">Installed version {offer.currentVersion}</div>}
      {!working && <button className="sm-btn app-updater-dismiss" type="button" onClick={dismiss}>Dismiss</button>}
    </div>}
  </div>;
}
