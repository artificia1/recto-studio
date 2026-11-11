import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';
import { buildHouseStyleEdits, checkHouseStyle, defaultHouseStyleRules, type HouseStyleRules } from '../../engine/houseStyle';
import { captureLayout, compareLayouts, type LayoutCapture } from '../../engine/layoutChanges';
import { LayoutChangeSummary } from '../LayoutChangeSummary';

const storageKey = 'recto_house_style_rules_v1';
let comparisonPoint: { session: number; layout: LayoutCapture } | undefined;

function loadRules(): HouseStyleRules {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw || raw.length > 20000) return defaultHouseStyleRules;
    const value = JSON.parse(raw);
    if (typeof value.terms === 'string' && typeof value.paragraphPrefix === 'string' &&
      typeof value.paragraphStyle === 'string' && typeof value.spacing === 'boolean' && typeof value.units === 'boolean') return value;
  } catch { /* The checker also works without browser storage. */ }
  return defaultHouseStyleRules;
}

export default function EditorialReviewPanel({ state }: { state: ProjectState }) {
  const session = stateManager.getDocumentSession();
  if (comparisonPoint && comparisonPoint.session !== session) comparisonPoint = undefined;
  const baseline = comparisonPoint?.layout;
  const [comparison, setComparison] = useState<{ session: number; result: ReturnType<typeof compareLayouts> }>();
  const layout = comparison?.session === session ? comparison.result : undefined;
  const [layoutMessage, setLayoutMessage] = useState('');
  const [rules, setRules] = useState(loadRules);
  const [review, setReview] = useState<(ReturnType<typeof checkHouseStyle> & { revision: number })>();
  const [selected, setSelected] = useState(new Set<string>());
  const [visible, setVisible] = useState(25);
  const [message, setMessage] = useState('');
  const navigate = (id: string) => { stateManager.zoomToElement(id); };
  const update = (patch: Partial<HouseStyleRules>) => {
    setRules({ ...rules, ...patch });
    setReview(undefined);
    setSelected(new Set());
    setMessage('');
  };
  const stale = review && review.revision !== stateManager.getDocumentRevision();
  const pageByFrame = new Map(review && !stale ? state.spreads.flatMap(spread => {
    const pages = new Map(spread.pages.map(page => [page.id, page.pageNumber]));
    return spread.elements.map(element => [element.id, pages.get(element.pageId)] as const);
  }) : []);

  return <>
    <details className="publication-panel">
      <summary>Layout change inspector</summary>
      <p>Capture the current layout, make your edits, then compare to see which paragraphs and footnotes moved.</p>
      <div className="publication-actions">
        <button className="sm-btn" onClick={() => {
          try {
            comparisonPoint = { session, layout: captureLayout(stateManager.getState()) };
            setComparison(undefined);
            setLayoutMessage('Layout captured.');
          } catch (reason) { setLayoutMessage(String(reason)); }
        }}>{baseline ? 'Replace comparison point' : 'Capture current layout'}</button>
        <button className="sm-btn" disabled={!baseline} onClick={() => {
          if (!baseline) return;
          try {
            setComparison({ session, result: compareLayouts(baseline, captureLayout(stateManager.getState())) });
            setLayoutMessage('');
          } catch (reason) { setLayoutMessage(String(reason)); }
        }}>Compare current layout</button>
      </div>
      {layoutMessage && <p role="status">{layoutMessage}</p>}
      {layout && <LayoutChangeSummary result={layout} onNavigate={navigate}/>}
    </details>
    <details className="publication-panel">
      <summary>House style checker</summary>
      <label>Preferred wording<textarea maxLength={11000} value={rules.terms} placeholder="e-mail → email"
        onInput={event => update({ terms: event.currentTarget.value })}/></label>
      <p>Enter one case-sensitive rule per line using current wording → preferred wording.</p>
      <label className="publication-check"><input type="checkbox" checked={rules.spacing}
        onChange={event => update({ spacing: event.currentTarget.checked })}/>Collapse repeated interior spaces</label>
      <label className="publication-check"><input type="checkbox" checked={rules.units}
        onChange={event => update({ units: event.currentTarget.checked })}/>Keep numbers with common metric and temperature units</label>
      <details>
        <summary>Required paragraph style</summary>
        <label>Paragraph starts with<input maxLength={100} value={rules.paragraphPrefix}
          onInput={event => update({ paragraphPrefix: event.currentTarget.value })}/></label>
        <label>Expected style<select value={rules.paragraphStyle} onChange={event => update({ paragraphStyle: event.currentTarget.value })}>
          <option value="">Choose a style</option>
          {[...new Set(state.paragraphStyles.map(style => style.name))].map(name => <option key={name}>{name}</option>)}
        </select></label>
      </details>
      <div className="publication-actions">
        <button className="sm-btn" onClick={() => {
          try {
            const result = checkHouseStyle(stateManager.getState(), rules);
            setReview({ ...result, revision: stateManager.getDocumentRevision() });
            setSelected(new Set());
            setVisible(25);
            setMessage('');
          } catch (reason) { setMessage(String(reason)); }
        }}>Check document</button>
        <button className="sm-btn" onClick={() => {
          try {
            localStorage.setItem(storageKey, JSON.stringify(rules));
            setMessage('House rules saved on this device.');
          } catch { setMessage('House rules could not be saved on this device.'); }
        }}>Save rules</button>
      </div>
      {message && <p role="status">{message}</p>}
      {stale && <p role="alert">The document changed. Run the check again.</p>}
      {review && !stale && <>
        <p>{review.limited ? 'First 500 findings. Narrow the rules to review the rest.' : `${review.findings.length} findings`}</p>
        {review.findings.length > 0 && <ul className="editorial-list">{review.findings.slice(0, visible).map(finding => <li key={finding.id}>
          <p>Page {pageByFrame.get(finding.frameId) ?? '—'} · {finding.reason}</p>
          <p className="review-text">{finding.excerpt}</p>
          {finding.replacement !== undefined && <label className="publication-check">
            <input type="checkbox" checked={selected.has(finding.id)} onChange={event => {
              const next = new Set(selected);
              if (event.currentTarget.checked) next.add(finding.id);
              else next.delete(finding.id);
              setSelected(next);
            }}/>Replace “{finding.text}” with “{finding.replacement}”
          </label>}
          <button className="sm-btn" onClick={() => navigate(finding.frameId)}>Go to story frame</button>
        </li>)}</ul>}
        <div className="publication-actions">
          {visible < review.findings.length && <button className="sm-btn" onClick={() => setVisible(visible + 25)}>Show more findings</button>}
          <button className="sm-btn" disabled={!selected.size} onClick={() => {
            try {
              const edits = buildHouseStyleEdits(stateManager.getState(), review.findings.filter(finding => selected.has(finding.id)));
              stateManager.applyReviewedStoryEdits(review.revision, edits);
              setMessage(selected.size === 1 ? 'Applied 1 selected fix.' : `Applied ${selected.size} selected fixes.`);
              setSelected(new Set());
              setReview(undefined);
            } catch (reason) { setMessage(String(reason)); }
          }}>Apply selected fixes</button>
        </div>
      </>}
    </details>
  </>;
}
