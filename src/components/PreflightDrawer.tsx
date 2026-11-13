import type { RefObject } from 'preact';
import type { PreflightIssue } from '../types';
import { stateManager } from '../state';
import { groupPreflightIssues } from '../engine/preflightReview';

export default function PreflightDrawer({ issues, drawerRef, onClose }: {
  issues: PreflightIssue[];
  drawerRef: RefObject<HTMLDivElement>;
  onClose(): void;
}) {
  const inspectIssue = (issue: PreflightIssue) => {
    stateManager.setActiveSpread(issue.spreadIndex);
    if (issue.elementId) stateManager.selectElements([issue.elementId]);
  };

  return (
    <div ref={drawerRef} className="preflight-drawer" role="region" aria-labelledby="preflight-audit-title">
      <div className="preflight-drawer-header">
        <div className="preflight-drawer-title">
          <h2 id="preflight-audit-title">Print Preflight Audit</h2>
          <span className="preflight-badge" data-severity={issues.length ? 'error' : 'ok'}>
            {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
          </span>
        </div>
        <div className="preflight-actions">
          {issues.length > 0 && (
            <button
              type="button"
              className="action-btn-primary"
              onClick={() => stateManager.autoFixAllPreflightIssues()}
              title="Automatically fix all resolvable preflight issues"
            >
              Auto-Fix All
            </button>
          )}
          <button
            type="button"
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
          <div className="preflight-empty">
            <strong>All Preflight Checks Passed</strong>
            <p>No overset text, low-res assets, missing alt text, bleed gaps, or trim edge hazards detected.</p>
          </div>
        ) : (
          groupPreflightIssues(issues).map(([key, group]) => <details key={key} open={group.length === 1}>
            <summary>
              {group[0].code} · {group.length} {group.length === 1 ? 'finding' : 'findings'} · Pages {[...new Set(group.map(issue => issue.pageNumber))].sort((a, b) => a - b).join(', ')}
            </summary>
            {group.length > 1 && <p className="preflight-group-message">{group[0].message}</p>}
            {group.map((issue, index) => (
              <div key={`${issue.id}-${index}`} className="preflight-item" data-severity={issue.severity}>
                <button type="button" className="preflight-item-locate" onClick={() => inspectIssue(issue)}
                  title="Jump to finding on the canvas">
                  <span className="preflight-item-top">
                    <strong>{issue.code}</strong>
                    <span>Page {issue.pageNumber} · Spread {issue.spreadIndex + 1}</span>
                  </span>
                  <span>{issue.message}</span>
                </button>
                <div className="preflight-item-actions">
                  <button type="button" className="sm-btn" onClick={() => stateManager.autoFixPreflightIssue(issue)}
                    title="Apply automatic fix for this issue">
                    Quick Fix
                  </button>
                </div>
              </div>
            ))}
          </details>)
        )}
      </div>
    </div>
  );
}
