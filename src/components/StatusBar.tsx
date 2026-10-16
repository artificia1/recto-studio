import { useState } from 'preact/hooks';
import { ProjectState, DisplayQuality } from '../types';
import { stateManager } from '../state';

interface StatusBarProps {
  state: ProjectState;
}

export function StatusBar({ state }: StatusBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const currentSpread = state.spreads[state.activeSpreadIndex];
  const pagesDesc = currentSpread?.pages?.map((p) => `Page ${p.pageNumber}`).join(' - ') || 'Spread';

  const issues = stateManager.runPreflightCheck();

  const handleQualityChange = (e: any) => {
    stateManager.setDisplayQuality(e.target.value as DisplayQuality);
  };

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-item status-mode">● {state.settings.facingPages ? 'Facing Pages' : 'Single'} ({pagesDesc})</span>
        <span className="status-divider">|</span>
        <span className="status-item status-meta-margins">Margins: {state.settings.margins.insideMm}/{state.settings.margins.outsideMm}mm</span>
        <span className="status-divider status-meta-margins">|</span>
        <span className="status-item status-meta-bleed">Bleed: {state.settings.bleedMm}mm</span>
        <span className="status-divider status-meta-bleed">|</span>
        <span className="status-item status-active-tool">Tool: <b>{state.activeTool.toUpperCase()}</b></span>
        <span className="status-divider">|</span>

        {issues.length === 0 ? (
          <span
            className="status-preflight-ok"
            onClick={() => setDrawerOpen(!drawerOpen)}
            title="Print Preflight: All print criteria passed"
          >
            ✔ Preflight: OK
          </span>
        ) : (
          <button
            className="status-preflight-btn"
            onClick={() => setDrawerOpen(!drawerOpen)}
            title="Click to view print preflight issues"
          >
            ⚠ Preflight: {issues.length} {issues.length === 1 ? 'Issue' : 'Issues'}
          </button>
        )}
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
            <option value="fast">⚡ Fast</option>
            <option value="typical">📊 Typical</option>
            <option value="high">🔍 High</option>
          </select>
        </div>
        <span className="status-divider status-meta-telemetry">|</span>
        <span className="status-item status-meta-telemetry">100% Offline • 0 KB Telemetry</span>
        <span className="status-divider">|</span>
        <span className="status-item status-version">Recto Studio v1.0.0</span>
      </div>

      {drawerOpen && (
        <div
          className="preflight-drawer"
          style={{
            position: 'absolute',
            bottom: '26px',
            left: '12px',
            width: '420px',
            maxHeight: '260px',
            backgroundColor: '#1c1c1c',
            border: '1px solid #444',
            borderRadius: '6px',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '7px 12px',
              backgroundColor: '#262626',
              borderBottom: '1px solid #383838',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: '#eee',
            }}
          >
            <span>PRINT PREFLIGHT AUDIT ({issues.length} {issues.length === 1 ? 'ISSUE' : 'ISSUES'})</span>
            <button
              onClick={() => setDrawerOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '0 4px',
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              overflowY: 'auto',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxHeight: '210px',
            }}
          >
            {issues.length === 0 ? (
              <div style={{ padding: '12px', color: '#2ec4b6', fontSize: '11px', textAlign: 'center' }}>
                ✔ Document passes all print preflight checks (No overset text, resolution issues, bleed gaps, or trim hazards).
              </div>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.id}
                  style={{
                    padding: '6px 8px',
                    backgroundColor: '#232323',
                    borderRadius: '4px',
                    borderLeft: `3px solid ${issue.severity === 'error' ? '#e63946' : '#f4a261'}`,
                    fontSize: '11px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    stateManager.setActiveSpread(issue.spreadIndex);
                    if (issue.elementId) {
                      stateManager.selectElements([issue.elementId]);
                    }
                  }}
                  title="Click to jump to and select this element on canvas"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999', fontSize: '10px' }}>
                    <b style={{ color: issue.severity === 'error' ? '#ff6b6b' : '#f4a261' }}>{issue.code}</b>
                    <span>Page {issue.pageNumber} • Spread {issue.spreadIndex + 1}</span>
                  </div>
                  <div style={{ color: '#e0e0e0', lineHeight: '1.3' }}>{issue.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
