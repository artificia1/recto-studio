import type { RefObject } from 'preact';
import type { PreflightIssue } from '../types';
import { stateManager } from '../state';

export default function PreflightDrawer({ issues, drawerRef, onClose }: {
  issues: PreflightIssue[];
  drawerRef: RefObject<HTMLDivElement>;
  onClose(): void;
}) {
  const handleFixIssue = (e: MouseEvent, issue: PreflightIssue) => {
    e.stopPropagation();
    stateManager.autoFixPreflightIssue(issue);
  };

  const handleFixAll = (e: MouseEvent) => {
    e.stopPropagation();
    stateManager.autoFixAllPreflightIssues();
  };

  return (
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
            onClick={onClose}
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
  );
}
