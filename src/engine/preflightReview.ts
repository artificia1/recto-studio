import type { PreflightIssue } from '../types';

const cause = (issue: PreflightIssue) => JSON.stringify([issue.code, issue.severity, issue.message]);
const instance = (issue: PreflightIssue) => JSON.stringify([cause(issue), issue.elementId || issue.pageNumber]);

export function groupPreflightIssues(issues: PreflightIssue[]) {
  const groups = new Map<string, PreflightIssue[]>();
  for (const issue of issues) {
    const key = cause(issue), group = groups.get(key);
    if (group) group.push(issue);
    else groups.set(key, [issue]);
  }
  return [...groups.entries()].sort(([, a], [, b]) =>
    Number(b[0].severity === 'error') - Number(a[0].severity === 'error') || b.length - a.length);
}

export function reviewPreflightChange(before: PreflightIssue[], after: PreflightIssue[]) {
  const old = new Set(before.map(instance)), next = new Set(after.map(instance));
  return { cleared: before.filter(issue => !next.has(instance(issue))),
    introduced: after.filter(issue => !old.has(instance(issue))), remaining: after.filter(issue => old.has(instance(issue))) };
}
