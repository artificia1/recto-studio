import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useModalFocus } from '../hooks/useModalFocus';
import { enableOffline, hasInstallPrompt, offlineRegistration, offlineSupported, takeInstallPrompt } from '../webInstall';
import './webInstallDialog.css';

const releasePage = 'https://github.com/artificia1/recto-studio/releases';

export default function WebInstallDialog({ onClose }: { onClose(): void }) {
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [worker, setWorker] = useState<ServiceWorkerRegistration>();
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<'idle' | 'installing' | 'ready' | 'failed'>('idle');
  const [updateReady, setUpdateReady] = useState(false);
  const [canInstall, setCanInstall] = useState(hasInstallPrompt);
  const [installed, setInstalled] = useState(() => matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const safari = navigator.vendor === 'Apple Computer, Inc.';
  const mobileApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || safari && navigator.maxTouchPoints > 1;
  const mac = !mobileApple && /Macintosh/.test(navigator.userAgent);
  useModalFocus(true, panel);

  useEffect(() => {
    const sync = () => setCanInstall(hasInstallPrompt());
    const didInstall = () => { setInstalled(true); setCanInstall(false); };
    window.addEventListener('beforeinstallprompt', sync);
    window.addEventListener('appinstalled', didInstall);
    let alive = true;
    void offlineRegistration().then(registration => {
      if (alive) setWorker(current => current || registration);
    }).catch(() => {});
    return () => {
      alive = false;
      window.removeEventListener('beforeinstallprompt', sync);
      window.removeEventListener('appinstalled', didInstall);
    };
  }, []);

  useEffect(() => {
    if (!worker) return;
    let watched: ServiceWorker | null = null;
    const observe = () => {
      const active = worker.active;
      const next = worker.installing || worker.waiting || active;
      if (next !== watched) {
        watched?.removeEventListener('statechange', observe);
        watched = next;
        watched?.addEventListener('statechange', observe);
      }
      setUpdateReady(Boolean(active && worker.waiting));
      setState(active?.state === 'activated' ? 'ready' : next && next.state !== 'redundant' ? 'installing' : 'failed');
    };
    worker.addEventListener('updatefound', observe);
    navigator.serviceWorker.addEventListener('controllerchange', observe);
    observe();
    return () => {
      watched?.removeEventListener('statechange', observe);
      worker.removeEventListener('updatefound', observe);
      navigator.serviceWorker.removeEventListener('controllerchange', observe);
    };
  }, [worker]);

  const cache = async () => {
    closeButton.current?.focus();
    setLoading(true);
    setState('installing');
    try {
      const registration = await enableOffline();
      if (!registration.active && !registration.installing && !registration.waiting) {
        throw new Error('Offline installation did not start.');
      }
      setWorker(registration);
    }
    catch { setState('failed'); }
    finally { setLoading(false); }
  };

  const install = async () => {
    closeButton.current?.focus();
    const event = takeInstallPrompt();
    setCanInstall(false);
    if (event && (await event.prompt().catch(() => null))?.outcome === 'accepted') setInstalled(true);
  };

  return createPortal(<div className="web-install-overlay"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    }}>
    <section className="web-install-dialog" role="dialog" aria-modal="true" aria-labelledby="web-install-heading" ref={panel}>
      <header>
        <img src="./logo.png" alt="" width="46" height="46" />
        <h2 id="web-install-heading">Install Recto Studio</h2>
        <button type="button" className="action-btn" onClick={onClose} ref={closeButton} aria-label="Close install guide">Close</button>
      </header>
      <div className="web-install-options">
        <section aria-labelledby="recto-web-app-heading">
          <h3 id="recto-web-app-heading">Web app</h3>
          {installed ? <p>Recto is already open as a web app.</p>
            : mobileApple ? <p>In Safari, choose <strong>Share → Add to Home Screen</strong>.</p>
            : mac && safari ? <p>In Safari on macOS Sonoma 14 or later, choose <strong>File → Add to Dock</strong>.</p>
            : canInstall ? <button type="button" className="action-btn-primary" onClick={() => void install()}>Install web app</button>
            : <p>{mac ? 'Open Recto in Safari and choose File → Add to Dock on macOS Sonoma 14 or later.' :
              'Look for “Install app” in your browser menu.'}</p>}
          <p>Before switching to another app or browser profile, save a <code>.recto</code> project file and open it there.</p>
        </section>
        <section aria-labelledby="recto-offline-heading">
          <h3 id="recto-offline-heading">Offline access</h3>
          <p>Save a copy of the editor in this browser so you can reopen it without a connection.</p>
          {state !== 'ready' && offlineSupported() && <button type="button" className="action-btn" onClick={() => void cache()}
            disabled={loading || state === 'installing'}>{state === 'failed' ? 'Retry offline setup' : 'Enable offline access'}</button>}
          {!offlineSupported() && <p>Open the hosted editor in a browser that supports offline access.</p>}
          <p role="status">{updateReady ? 'An update is ready. Close all Recto tabs and windows, then reopen the editor.' :
            state === 'ready' ? 'Ready to open offline.' :
            state === 'installing' ? 'Saving editor files…' :
            state === 'failed' ? 'Could not save the editor. Check your connection and try again.' : ''}</p>
        </section>
        {!mobileApple && <section aria-labelledby="recto-downloads-heading">
          <h3 id="recto-downloads-heading">Desktop downloads</h3>
          <p>{mac ? 'Choose the Mac preview for Apple silicon or Intel.' : 'Get the standalone Windows, Linux, or macOS app.'}</p>
          <a href={releasePage} target="_blank" rel="noopener noreferrer">View GitHub releases</a>
        </section>}
      </div>
    </section>
  </div>, document.body);
}
