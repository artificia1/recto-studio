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
  error: 'Autosave failed — export your project to keep a copy',
};

export function StatusBar({ state }: StatusBarProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  useEffect(() => stateManager.autosave.subscribe(setSaveStatus), []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | HTMLSpanElement>(null);
  const currentSpread = state.spreads[state.activeSpreadIndex];
  const pagesDesc = currentSpread?.pages?.map((p) => `Page ${p.pageNumber}`).join(' - ') || 'Spread';

  const issues = stateManager.runPreflightCheck();

  const handleQualityChange = (e: any) => {
    stateManager.setDisplayQuality(e.target.value as DisplayQuality);
  };

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
        <span role="status" style={{ color: saveStatus === 'error' ? '#ff7878' : 'inherit' }}>
          {SAVE_LABELS[saveStatus]}
        </span>
        {issues.length === 0 ? (
          <span
            ref={triggerRef as any}
            className="status-preflight-ok"
            onClick={(e) => {
              e.stopPropagation();
              setDrawerOpen(!drawerOpen);
            }}
            title="Print Preflight: All print criteria passed. Click to view audit."
            style={{ flexShrink: 0 }}
          >
            <span style={{ fontSize: '9px', color: '#2ec4b6', marginRight: '4px' }}>●</span> Preflight: No errors
          </span>
        ) : (
          <button
            ref={triggerRef as any}
            className="status-preflight-btn"
            onClick={(e) => {
              e.stopPropagation();
              setDrawerOpen(!drawerOpen);
            }}
            title="Click to view and resolve print preflight issues"
            style={{ flexShrink: 0 }}
          >
            <span style={{ fontSize: '9px', color: '#ffffff', marginRight: '4px' }}>●</span> Preflight: {issues.length} {issues.length === 1 ? 'error' : 'errors'}
          </button>
        )}

        <span className="status-divider">|</span>
        <span className="status-item status-mode">● {state.settings.facingPages ? 'Facing Pages' : 'Single'} ({pagesDesc})</span>
        <span className="status-divider status-meta-margins">|</span>
        <span className="status-item status-meta-margins">Margins: {state.settings.margins.insideMm}/{state.settings.margins.outsideMm}mm</span>
        <span className="status-divider status-meta-bleed">|</span>
        <span className="status-item status-meta-bleed">Bleed: {state.settings.bleedMm}mm</span>
        <span className="status-divider">|</span>
        <span className="status-item status-active-tool">Tool: <b>{state.activeTool.toUpperCase()}</b></span>
      </div>

      <div className="status-right">
        <div className="status-display-group">
          <span className="status-display-title">Display:</span>
          <select
            value={state.displayQuality || 'typical'}
            onChange={handleQualityChange}
            className="status-quality-select"
            title="Display Performance: Fast (Wireframe), Typical (Proxy Cache), High (Full Res)"
          >
            <option value="fast">Fast</option>
            <option value="typical">Typical</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="status-display-group" style={{ marginLeft: '6px' }}>
          <span className="status-display-title">Plates:</span>
          <select
            value={state.plateSolo || 'all'}
            onChange={(e: any) => stateManager.setPlateSolo(e.target.value)}
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
        </div>
        <button
          type="button"
          onClick={() => stateManager.toggleTacHeatmap()}
          className={`status-btn-pill ${state.tacHeatmap ? 'status-btn-pill-active' : ''}`}
          style={{
            marginLeft: '6px',
            padding: '2px 8px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: '4px',
            border: state.tacHeatmap ? '1px solid #ef4444' : '1px solid #374151',
            background: state.tacHeatmap ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
            color: state.tacHeatmap ? '#f87171' : '#9ca3af',
          }}
          title="Toggle Visual TAC (Total Area Coverage) Ink Density Heatmap on Canvas"
        >
          TAC Heatmap: {state.tacHeatmap ? 'ON' : 'OFF'}
        </button>
        <span className="status-divider status-meta-telemetry">|</span>
        <span className="status-item status-meta-telemetry">100% Offline • 0 KB Telemetry</span>
        <span className="status-divider">|</span>
        <span className="status-item status-version">Recto Studio v{version}</span>
      </div>

      {drawerOpen && <Suspense fallback={null}><PreflightDrawer issues={issues} drawerRef={drawerRef} onClose={() => setDrawerOpen(false)} /></Suspense>}
    </footer>
  );
}
