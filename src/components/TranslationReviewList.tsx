import { useMemo, useState } from 'preact/hooks';
import type { TranslationReview, TranslationStatus } from '../translation/review';
import type { TranslationQualityFinding } from '../translation/quality';
import { translationStatusNames as statusNames } from '../translation/report';
import type { TranslationPart } from '../translation/catalog';
import { TranslationUnitEditor } from './TranslationUnitEditor';

export function TranslationReviewList({ review, selected, onSelection, findings, onNavigate, disabled, onEdit }: {
  review: TranslationReview;
  selected: Set<string>;
  onSelection: (next: Set<string>) => void;
  findings: TranslationQualityFinding[];
  onNavigate: (frameId: string) => void;
  disabled: boolean;
  onEdit: (key: string, parts: TranslationPart[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'selected' | 'warnings' | TranslationStatus>('all');
  const [limit, setLimit] = useState(25);
  const [editing, setEditing] = useState('');
  const terms = query.toLocaleLowerCase().trim();
  const warnings = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const finding of findings) {
      const group = result.get(finding.key);
      if (group) group.push(finding.message);
      else result.set(finding.key, [finding.message]);
    }
    return result;
  }, [findings]);
  const matching = useMemo(() => review.rows.filter(row => {
    const visible = filter === 'all' || (filter === 'selected' && selected.has(row.key)) ||
      (filter === 'warnings' && warnings.has(row.key)) || filter === row.status;
    return visible && (!terms || `${row.group} ${row.source} ${row.target || ''}`.toLocaleLowerCase().includes(terms));
  }), [review, filter, selected, warnings, terms]);
  const statusCounts = useMemo(() => {
    const result = new Map<TranslationStatus, number>();
    for (const row of review.rows) result.set(row.status, (result.get(row.status) || 0) + 1);
    return result;
  }, [review]);
  const available = matching.filter(row => review.candidates.has(row.key));
  return <section aria-label="Translation unit review">
    <div className="translation-filters">
      <label>Find units<input type="search" value={query} onInput={event => {
        setQuery(event.currentTarget.value);
        setLimit(25);
      }}/></label>
      <label>Show<select value={filter} onChange={event => {
        setFilter(event.currentTarget.value as typeof filter);
        setLimit(25);
      }}>
        <option value="all">All units ({review.rows.length})</option>
        <option value="selected">Selected ({selected.size})</option>
        <option value="warnings">Quality findings ({warnings.size})</option>
        {Object.entries(statusNames).map(([key, label]) =>
          <option key={key} value={key}>{label} ({statusCounts.get(key as TranslationStatus) || 0})</option>)}
      </select></label>
    </div>
    <div className="publication-actions">
      <button className="sm-btn" disabled={disabled || !available.some(row => row.status === 'ready')} onClick={() =>
        onSelection(new Set([...selected, ...available.filter(row => row.status === 'ready').map(row => row.key)]))}>Select ready matches</button>
      <button className="sm-btn" disabled={disabled || !selected.size} onClick={() => onSelection(new Set())}>Clear selection</button>
      <span>{selected.size.toLocaleString()} selected</span>
    </div>
    <ul className="translation-units">
      {matching.slice(0, limit).map(row => {
        const candidate = review.candidates.get(row.key);
        return <li key={row.key}>
        <div className="translation-unit-header">
          {review.candidates.has(row.key) ? <label className="publication-check">
            <input type="checkbox" disabled={disabled} checked={selected.has(row.key)} aria-label={`Use ${row.label} in ${row.group}`}
              onChange={event => {
                const next = new Set(selected);
                if (event.currentTarget.checked) next.add(row.key);
                else next.delete(row.key);
                onSelection(next);
              }}/>
            <strong>{row.group} · {row.label}</strong>
          </label> : <strong>{row.group} · {row.label}</strong>}
          <small>{row.page === undefined ? '' : `Page ${row.page} · `}{statusNames[row.status]}</small>
        </div>
        <div className="translation-bilingual">
          <div><small>Source</small><p lang={review.sourceLanguage} dir="auto">{row.source}</p></div>
          <div><small>Translation</small><p lang={review.targetLanguage} dir="auto">{row.target || '—'}</p></div>
        </div>
        {row.detail && <p className="translation-finding">{row.detail}</p>}
        {warnings.get(row.key)?.map(warning => <p className="translation-finding" key={warning}>{warning}</p>)}
        <div className="publication-actions">
          {row.frameId && <button className="sm-btn" onClick={() => onNavigate(row.frameId!)}>Locate source frame</button>}
          {candidate?.returned.target && editing !== row.key && <button className="sm-btn" disabled={disabled}
            onClick={() => setEditing(row.key)}>Edit translated wording</button>}
        </div>
        {editing === row.key && candidate?.returned.target && <TranslationUnitEditor unit={candidate.unit}
          target={candidate.returned.target} language={review.targetLanguage} disabled={disabled}
          onCancel={() => setEditing('')} onSave={parts => { onEdit(row.key, parts); setEditing(''); }}/>}
      </li>;
      })}
    </ul>
    {!matching.length && <p>No units match this filter.</p>}
    {matching.length > limit && <button className="sm-btn" onClick={() => setLimit(limit + 25)}>Show more units</button>}
  </section>;
}
