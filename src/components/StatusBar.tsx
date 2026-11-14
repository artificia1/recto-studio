import { useState, useEffect, useRef } from 'preact/hooks';
import { ProjectState, DisplayQuality } from '../types';
import { lazy, Suspense } from 'preact/compat';
import { stateManager } from '../state';
import type { SaveStatus } from '../state/autosave';
import { version } from '../../package.json';

const PreflightDrawer = lazy(() => import('./PreflightDrawer'));

interface StatusBarProps {
  state: ProjectState;
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: 'Saved locally',
  pending: 'Saving…',
  saving: 'Saving…',
  error: 'Autosave failed. Save a project copy.',
};

export function StatusBar({ state }: StatusBarProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  useEffect(() => stateManager.autosave.subscribe(setSaveStatus), []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentSpread = state.spreads[state.activeSpreadIndex];
  const pages = currentSpread?.pages.map(page => page.pageNumber) ?? [];
  const pagesDesc = pages.length > 1 ? `Pages ${pages.join('–')}` : pages.length === 1 ? `Page ${pages[0]}` : 'Spread';

  const issues = stateManager.runPreflightCheck();

  // Close drawer when clicking outside
  useEffect(() => {
    if (!drawerOpen) return;
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        drawerRef.current &&
        !drawerRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setDrawerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [drawerOpen]);

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span role="status" className={`status-save status-save-${saveStatus}`}>
          {SAVE_LABELS[saveStatus]}
        </span>
        <button
          type="button"
          ref={triggerRef}
          className={issues.length ? 'status-preflight-btn' : 'status-preflight-ok'}
          onClick={() => setDrawerOpen(open => !open)}
          aria-expanded={drawerOpen}
          title={issues.length ? 'Click to view and resolve print preflight issues' : 'Print Preflight: All print criteria passed. Click to view audit.'}
        >
          <span aria-hidden="true" className="status-preflight-dot" />
          {issues.length ? `Preflight: ${issues.length} ${issues.length === 1 ? 'error' : 'errors'}` : 'Preflight: No errors'}
        </button>

        <span className="status-item status-mode" title={state.settings.facingPages ? 'Facing Pages' : 'Single-page layout'}>{pagesDesc}</span>
        <span className="status-item status-meta-margins">Margins: {state.settings.margins.insideMm}/{state.settings.margins.outsideMm} mm</span>
        <span className="status-item status-meta-bleed">Bleed: {state.settings.bleedMm} mm</span>
        <span className="status-item status-active-tool">Tool: <b>{state.activeTool.toUpperCase()}</b></span>
      </div>

      <div className="status-right">
        <label className="status-display-group">
          <span className="status-display-title">Display</span>
          <select
            value={state.displayQuality || 'typical'}
            onChange={event => stateManager.setDisplayQuality(event.currentTarget.value as DisplayQuality)}
            className="status-quality-select"
            title="Display Performance: Fast (Wireframe), Typical (Proxy Cache), High (Full Res)"
          >
            <option value="fast">Fast</option>
            <option value="typical">Typical</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="status-display-group">
          <span className="status-display-title">Plates</span>
          <select
            value={state.plateSolo || 'all'}
            onChange={event => stateManager.setPlateSolo(event.currentTarget.value as ProjectState['plateSolo'])}
            className="status-quality-select"
            title="CMYK Separation Plates: All, Cyan, Magenta, Yellow, Black (K), Spot & Finishing"
          >
            <option value="all">All (CMYK)</option>
            <option value="cyan">Cyan</option>
            <option value="magenta">Magenta</option>
            <option value="yellow">Yellow</option>
            <option value="black">Black (K)</option>
            <option value="spot">Spot & Finishing</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => stateManager.toggleTacHeatmap()}
          className="status-btn-pill"
          aria-pressed={!!state.tacHeatmap}
          title="Toggle Visual TAC (Total Area Coverage) Ink Density Heatmap on Canvas"
        >
          TAC Heatmap: {state.tacHeatmap ? 'ON' : 'OFF'}
        </button>
        <span className="status-item status-version" title={`Recto Studio v${version}`}>v{version}</span>
      </div>

      {drawerOpen && <Suspense fallback={null}><PreflightDrawer issues={issues} drawerRef={drawerRef} onClose={() => setDrawerOpen(false)} /></Suspense>}
    </footer>
  );
}
