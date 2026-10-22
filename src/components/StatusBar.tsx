import { useState, useEffect, useRef } from 'preact/hooks';
import { ProjectState, DisplayQuality, PreflightIssue } from '../types';
import { stateManager } from '../state';

interface StatusBarProps {
  state: ProjectState;
}

export function StatusBar({ state }: StatusBarProps) {
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

  const handleFixIssue = (e: MouseEvent, issue: PreflightIssue) => {
    e.stopPropagation();
    stateManager.autoFixPreflightIssue(issue);
  };

  const handleFixAll = (e: MouseEvent) => {
    e.stopPropagation();
    stateManager.autoFixAllPreflightIssues();
  };

  return (
    <footer className="status-bar">
      <div className="status-left">
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
            title="CMYK Separation Plates: All, Cyan, Magenta, Yellow, Black (K)"
          >
            <option value="all">All (CMYK)</option>
            <option value="cyan">Cyan</option>
            <option value="magenta">Magenta</option>
            <option value="yellow">Yellow</option>
            <option value="black">Black (K)</option>
          </select>
        </div>
        <span className="status-divider status-meta-telemetry">|</span>
        <span className="status-item status-meta-telemetry">100% Offline • 0 KB Telemetry</span>
        <span className="status-divider">|</span>
        <span className="status-item status-version">Recto Studio v1.0.0</span>
      </div>

      {drawerOpen && (
        <div ref={drawerRef} className="preflight-drawer">
          <div className="preflight-drawer-header">
            <div className="preflight-drawer-title">
              <span>PRINT PREFLIGHT AUDIT</span>
              <span
                style={{
                  fontSize: '9.5px',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: '10px',
                  backgroundColor: issues.length === 0 ? '#2ec4b6' : '#e63946',
                  color: '#ffffff',
                }}
              >
                {issues.length} {issues.length === 1 ? 'ISSUE' : 'ISSUES'}
              </span>
            </div>
            <div className="preflight-actions">
              {issues.length > 0 && (
                <button
                  className="preflight-fix-all-btn"
                  onClick={handleFixAll}
                  title="Automatically fix all resolvable preflight issues"
                >
                  Auto-Fix All
                </button>
              )}
              <button
                className="preflight-close-btn"
                onClick={() => setDrawerOpen(false)}
                title="Close preflight audit panel"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="preflight-drawer-body">
            {issues.length === 0 ? (
              <div style={{ padding: '16px 12px', color: '#2ec4b6', fontSize: '11px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', marginBottom: '6px' }}>OK</div>
                <b>All Preflight Checks Passed</b>
                <div style={{ color: '#888', marginTop: '4px', fontSize: '10.5px' }}>
                  No overset text, low-res assets, missing Alt Text, bleed gaps, or trim edge hazards detected.
                </div>
              </div>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.id}
                  className="preflight-item"
                  style={{
                    borderLeft: `3px solid ${issue.severity === 'error' ? '#e63946' : '#f4a261'}`,
                  }}
                  onClick={() => {
                    stateManager.setActiveSpread(issue.spreadIndex);
                    if (issue.elementId) {
                      stateManager.selectElements([issue.elementId]);
                    }
                  }}
                  title="Click to jump to element and inspect on canvas"
                >
                  <div className="preflight-item-top">
                    <b style={{ color: issue.severity === 'error' ? '#ff6b6b' : '#f4a261' }}>
                      {issue.code}
                    </b>
                    <span style={{ color: '#888888' }}>
                      Page {issue.pageNumber} • Spread {issue.spreadIndex + 1}
                    </span>
                  </div>
                  <div style={{ color: '#e0e0e0', lineHeight: '1.35', fontSize: '11px' }}>
                    {issue.message}
                  </div>
                  <div className="preflight-item-actions">
                    <button
                      className="preflight-fix-btn"
                      onClick={(e) => handleFixIssue(e as any, issue)}
                      title="Apply automatic fix for this issue"
                    >
                      Quick Fix
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
