import type { reviewPreflightChange } from '../engine/preflightReview';

export function PreflightChangeSummary({ result }: { result: ReturnType<typeof reviewPreflightChange> }) {
  return <section aria-label="Preflight change preview">
    <p>{result.cleared.length} cleared · {result.introduced.length} new · {result.remaining.length} remaining</p>
    {(['cleared', 'introduced', 'remaining'] as const).map(key => result[key].length > 0 && <details key={key} open={key === 'introduced'}>
      <summary>{key === 'cleared' ? 'Findings cleared' : key === 'introduced' ? 'New findings' : 'Findings remaining'}</summary>
      <ul>{result[key].map((issue, index) => <li key={`${issue.id}-${index}`}>Page {issue.pageNumber} · {issue.message}</li>)}</ul>
    </details>)}
  </section>;
}
