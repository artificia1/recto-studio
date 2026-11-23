import type { RefObject } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { PreflightIssue } from '../types';
import { stateManager } from '../state';
import { groupPreflightIssues } from '../engine/preflightReview';

const PAGE_SIZE = 40;

function PreflightPager({ page, total, label, onChange }: {
  page: number; total: number; label: 'groups' | 'findings'; onChange(page: number): void;
}) {
  if (total <= 1) return null;
  return <div className="preflight-actions">
    <button type="button" className="sm-btn" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous {label}</button>
    <span role="status">{page + 1} of {total}</span>
    <button type="button" className="sm-btn" disabled={page >= total - 1} onClick={() => onChange(page + 1)}>Next {label}</button>
  </div>;
}

function PreflightGroup({ findings, onInspect }: { findings: PreflightIssue[]; onInspect(issue: PreflightIssue): void }) {
  const [open, setOpen] = useState(findings.length === 1);
  const [page, setPage] = useState(0);
  const total = Math.ceil(findings.length / PAGE_SIZE);
  const current = Math.min(page, total - 1);
  const pages = useMemo(() => [...new Set(findings.map(issue => issue.pageNumber))].sort((a, b) => a - b), [findings]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      {findings[0].code} · {findings.length} {findings.length === 1 ? 'finding' : 'findings'} · Pages {pages.slice(0, 8).join(', ')}
      {pages.length > 8 && ` and ${pages.length - 8} more`}
    </summary>
    {open && <>
      {findings.length > 1 && <p className="preflight-group-message">{findings[0].message}</p>}
      <PreflightPager page={current} total={total} label="findings" onChange={setPage}/>
      {findings.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((issue, index) => (
        <div key={`${issue.id}-${index}`} className="preflight-item" data-severity={issue.severity}>
          <button type="button" className="preflight-item-locate" onClick={() => onInspect(issue)} title="Jump to finding on the canvas">
            <span className="preflight-item-top">
              <strong>{issue.code}</strong>
              <span>Page {issue.pageNumber} · Spread {issue.spreadIndex + 1}</span>
            </span>
            <span>{issue.message}</span>
          </button>
          <div className="preflight-item-actions">
            <button type="button" className="sm-btn" onClick={() => stateManager.autoFixPreflightIssue(issue)} title="Apply automatic fix for this issue">
              Quick Fix
            </button>
          </div>
        </div>
      ))}
    </>}
  </details>;
}

export default function PreflightDrawer({ issues, drawerRef, onClose }: {
  issues: PreflightIssue[];
  drawerRef: RefObject<HTMLDivElement>;
  onClose(): void;
}) {
  const groups = useMemo(() => groupPreflightIssues(issues), [issues]);
  const [page, setPage] = useState(0);
  const total = Math.ceil(groups.length / PAGE_SIZE);
  const current = Math.max(0, Math.min(page, total - 1));
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
        ) : <>
          <PreflightPager page={current} total={total} label="groups" onChange={setPage}/>
          {groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(([key, group]) =>
            <PreflightGroup key={key} findings={group} onInspect={inspectIssue}/>)}
        </>}
      </div>
    </div>
  );
}
