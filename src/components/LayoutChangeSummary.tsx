import { useState } from 'preact/hooks';
import type { compareLayouts } from '../engine/layoutChanges';

type Result = ReturnType<typeof compareLayouts>;
type Location = Result['newOverset'][number];

const pageList = (locations: Location[]) => locations.length
  ? [...new Set(locations.map(location => location.page))].map(page => `page ${page}`).join(', ')
  : 'no placed text';

export function LayoutChangeSummary({ result, onNavigate, coverReview = false }: {
  result: Result;
  onNavigate?: (id: string) => void;
  coverReview?: boolean;
}) {
  const [rowLimit, setRowLimit] = useState(20);
  const groups = [
    { title: 'Paragraph placements', changes: result.paragraphs },
    { title: 'Footnote placements', changes: result.notes },
  ];
  const overset = [
    { title: 'New overset', locations: result.newOverset },
    { title: 'Cleared overset', locations: result.clearedOverset },
  ];
  const navigation = (location?: Location) => location && onNavigate &&
    <button className="sm-btn" onClick={() => onNavigate(location.frameId)}>Go to frame on page {location.page}</button>;
  const longest = Math.max(...groups.map(group => group.changes.length), ...overset.map(group => group.locations.length));
  return <section aria-label="Layout changes">
    <p>{result.pagesBefore === result.pagesAfter ? `${result.pagesAfter} pages` : `Pages ${result.pagesBefore} → ${result.pagesAfter}`}
      {result.trimBefore !== result.trimAfter && ` · Trim ${result.trimBefore} → ${result.trimAfter}`}</p>
    {coverReview && <p role="alert">This revision changes the approved cover dimensions. Review the cover again before book delivery.</p>}
    {!longest && <p>No changes to matched paragraph or footnote placements or overset status.</p>}
    {groups.map(({ title, changes }) => changes.length > 0 && <details key={title}>
      <summary>{title} ({changes.length})</summary>
      <ul className="editorial-list">{changes.slice(0, rowLimit).map(change => <li key={change.id}>
        <p className="review-text">{change.label}</p>
        <p>{pageList(change.from)} → {pageList(change.to)}
          {change.from.length > 0 && pageList(change.from) === pageList(change.to) && ' · different frames'}</p>
        {navigation(change.to[0] || change.from[0])}
      </li>)}</ul>
    </details>)}
    {overset.map(({ title, locations }) => locations.length > 0 && <details key={title} open={title === 'New overset'}>
      <summary>{title} ({locations.length})</summary>
      <ul className="editorial-list">{locations.slice(0, rowLimit).map(location =>
        <li key={location.frameId}><p>Page {location.page}</p>{navigation(location)}</li>)}</ul>
    </details>)}
    {longest > rowLimit && <button className="sm-btn" onClick={() => setRowLimit(rowLimit + 50)}>Show more layout changes</button>}
  </section>;
}
