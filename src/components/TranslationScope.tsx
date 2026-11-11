import { useMemo, useState } from 'preact/hooks';
import type { TranslationGroup } from '../translation/catalog';

export function TranslationScope({ groups, selected, onChange }: {
  groups: TranslationGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const term = query.trim().toLocaleLowerCase();
  const matching = useMemo(() => groups.filter(group => !term || group.label.toLocaleLowerCase().includes(term) ||
    (group.page !== undefined && String(group.page) === term)), [groups, term]);
  const unitCount = groups.reduce((sum, group) => sum + (selected.has(group.id) ? group.units.length : 0), 0);
  return <section aria-label="Translation scope">
    <label>Find stories or page numbers<input type="search" value={query} onInput={event => {
      setQuery(event.currentTarget.value);
      setLimit(30);
    }}/></label>
    <div className="publication-actions">
      <button className="sm-btn" disabled={!matching.length} onClick={() =>
        onChange(new Set([...selected, ...matching.map(group => group.id)]))}>Select matching groups</button>
      <button className="sm-btn" disabled={!selected.size} onClick={() => onChange(new Set())}>Clear selection</button>
      <span>{unitCount.toLocaleString()} selected units</span>
    </div>
    <ul className="translation-scope-list">
      {matching.slice(0, limit).map(group => <li key={group.id}>
        <label className="publication-check">
          <input type="checkbox" checked={selected.has(group.id)} onChange={event => {
            const next = new Set(selected);
            if (event.currentTarget.checked) next.add(group.id);
            else next.delete(group.id);
            onChange(next);
          }}/>
          <span>{group.label}<small>{group.page === undefined ? '' : `Page ${group.page} · `}{group.units.length} units
            {group.restricted && ` · ${group.restricted}`}</small></span>
        </label>
      </li>)}
    </ul>
    {!matching.length && <p>No translatable groups match this search.</p>}
    {matching.length > limit && <button className="sm-btn" onClick={() => setLimit(limit + 30)}>Show more groups</button>}
  </section>;
}
