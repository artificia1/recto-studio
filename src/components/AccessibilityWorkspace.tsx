import { useMemo, useRef, useState } from 'preact/hooks';
import { stateManager } from '../state';
import type { CanvasElement, ProjectState, TextElement } from '../types';
import { isReadingContent, readingEntries, readingLabel, reviewReadingOrder, type ReadingEntry } from '../engine/readingOrder';
import { tableGrid } from '../engine/tableCells';
import { useModalFocus } from '../hooks/useModalFocus';
import { layoutFrameNotes } from '../engine/publicationReferences';
import './manuscript.css';
import './accessibilityWorkspace.css';

type Edit = { id: string; updates: Partial<CanvasElement> };

function LinearContent({ element, state }: { element: CanvasElement; state: ProjectState }) {
  if (element.type === 'text') {
    const notes = layoutFrameNotes(state, element);
    return <><p>{element.text}</p>
      {notes.lines.length > 0 && <aside aria-label="Footnotes">{notes.lines.map((line, index) =>
        <p key={`${line.noteId}-${index}`}>{line.text}</p>)}</aside>}
    </>;
  }
  if (element.type === 'image') return <p>Figure · {element.altText || 'Description missing'}{element.caption && <><br/>{element.caption}</>}</p>;
  if (element.type === 'table') {
    if (element.prevFrameId) return <p>Table continuation</p>;
    return <details>
      <summary>{readingLabel(element)}</summary>
      <table><tbody>{tableGrid(element.cells, element.headerRowCount, element.footerRowCount || 0).map((row, index) => <tr key={index}>
        {row.map((owner, column) => {
          if (owner.row !== index || owner.column !== column) return null;
          const Tag = index < element.headerRowCount ? 'th' : 'td';
          return <Tag key={column} scope={Tag === 'th' ? 'col' : undefined} rowSpan={owner.rowSpan} colSpan={owner.colSpan}>{owner.cell.text}</Tag>;
        })}
      </tr>)}</tbody></table>
    </details>;
  }
  return null;
}

function ReadingMap({ state, rows, active, select }: {
  state: ProjectState;
  rows: ReadingEntry[];
  active: string;
  select: (id: string) => void;
}) {
  const { widthMm, heightMm } = state.settings;
  return <div className="accessibility-page-map" aria-label="Numbered reading order on page">
    <svg viewBox={`0 0 ${widthMm} ${heightMm}`} aria-hidden="true">
      <rect width={widthMm} height={heightMm} className="accessibility-page-paper"/>
      {rows.map(({ element }) => <rect key={element.id}
        x={element.x} y={element.y} width={element.width} height={element.height}
        transform={`rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`}
        className={active === element.id ? 'accessibility-map-active' : 'accessibility-map-frame'}/>)}
    </svg>
    {rows.filter(({ element }) => isReadingContent(element)).map(({ element }, index) =>
      <button key={element.id} className="accessibility-page-marker" aria-label={`Select reading position ${index + 1}`}
        aria-pressed={active === element.id} style={{
          left: `${Math.max(4, Math.min(96, element.x / widthMm * 100))}%`,
          top: `${Math.max(3, Math.min(97, element.y / heightMm * 100))}%`,
        }} onClick={() => select(element.id)}>{index + 1}</button>)}
  </div>;
}

export default function AccessibilityWorkspace({ state, onClose }: { state: ProjectState; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(true, dialog);
  const pages = useMemo(() => state.spreads.flatMap(spread => spread.pages), [state]);
  const entries = useMemo(() => readingEntries(state), [state]);
  const byId = useMemo(() => new Map(entries.map(entry => [entry.element.id, entry])), [entries]);
  const findings = useMemo(() => reviewReadingOrder(entries, state), [entries, state]);
  const [pageId, setPage] = useState(() => state.spreads[state.activeSpreadIndex]?.pages[0]?.id || pages[0]?.id);
  const [activeId, setActive] = useState(state.selectedElementId || '');
  const [marked, setMarked] = useState(new Set<string>());
  const [article, setArticle] = useState('');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<'order' | 'review' | 'preview'>('order');
  const [limit, setLimit] = useState(40);
  const page = pages.find(item => item.id === pageId) || pages[0];
  const rows = entries.filter(entry => entry.pageId === page?.id);
  const order = rows.filter(entry => isReadingContent(entry.element));
  const selected = byId.get(activeId)?.element;
  const lockedLayers = new Set(state.layers.filter(layer => layer.locked).map(layer => layer.id));
  const locked = (element: CanvasElement) => element.locked || (element.layerId && lockedLayers.has(element.layerId));
  const revision = stateManager.getDocumentRevision();

  const choose = (id: string) => {
    const entry = byId.get(id);
    if (!entry) return;
    setPage(entry.pageId);
    setActive(id);
  };

  const commit = (edits: Edit[]) => {
    try {
      if (revision !== stateManager.getDocumentRevision()) throw new Error('The publication changed. Try the edit again.');
      if (edits.some(edit => {
        const element = byId.get(edit.id)?.element;
        return !element || locked(element);
      })) throw new Error('Unlock the affected frames and layers before editing their reading structure.');
      stateManager.applyScriptUpdates(edits);
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const move = (id: string, step: number) => {
    const index = order.findIndex(row => row.element.id === id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= order.length) return;
    const reordered = order.map(row => row.element);
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    commit(reordered.flatMap((element, i) => element.readingOrder === i + 1 ? [] :
      [{ id: element.id, updates: { readingOrder: i + 1 } }]));
  };

  const change = (updates: Partial<CanvasElement>) => {
    if (selected) commit([{ id: selected.id, updates }]);
  };

  return <div className="manuscript-overlay" onClick={onClose} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') onClose();
  }}>
    <section ref={dialog} className="manuscript-dialog accessibility-workspace" role="dialog" aria-modal="true"
      aria-label="Accessibility workspace" onClick={event => event.stopPropagation()}>
      <header className="manuscript-header">
        <h2>Accessibility workspace</h2>
        <button className="sm-btn" onClick={onClose}>Close</button>
      </header>
      <div className="accessibility-toolbar publication-actions" role="group" aria-label="Accessibility views">
        {([['order', 'Reading order'], ['review', `Findings (${findings.length})`], ['preview', 'Linear preview']] as const).map(([id, label]) =>
          <button key={id} className="sm-btn" aria-pressed={view === id} onClick={() => { setView(id); setLimit(40); }}>{label}</button>)}
        <label>Page <select value={page?.id} onChange={event => {
          setPage(event.currentTarget.value);
          setActive('');
          setLimit(40);
        }}>{pages.map(item => <option key={item.id} value={item.id}>{item.pageNumber}</option>)}</select></label>
      </div>
      {message && <p className="accessibility-message" role="alert">{message}</p>}
      <div className="accessibility-body">
        {view === 'order' && <>
          <div className="accessibility-map-column">
            <ReadingMap state={state} rows={rows} active={activeId} select={choose}/>
          </div>
          <div className="accessibility-content">
            <div className="accessibility-article publication-actions">
              <label>Article name<input maxLength={100} value={article} onInput={event => setArticle(event.currentTarget.value)}/></label>
              <button className="sm-btn" disabled={!marked.size || !article.trim()} onClick={() =>
                commit([...marked].map(id => ({ id, updates: { readingArticle: article.trim() } })))}>
                Assign selected ({marked.size})
              </button>
              <button className="sm-btn" disabled={!marked.size} onClick={() =>
                commit([...marked].map(id => ({ id, updates: { readingArticle: undefined } })))}>
                Remove from article
              </button>
            </div>
            <p className="accessibility-help">Select frames on one or more pages to assign an article. Use Move up and Move down or Alt + arrow keys to change the current page’s order.</p>
            {!rows.length && <p>No publication artwork on this page.</p>}
            <ol className="accessibility-rows">
              {[...order, ...rows.filter(row => !isReadingContent(row.element))].map(({ element }, index) => {
                const inOrder = index < order.length;
                const label = readingLabel(element);
                return <li key={element.id} className={activeId === element.id ? 'accessibility-row-selected' : ''}>
                  <span className="accessibility-row-number" aria-hidden="true">{inOrder ? index + 1 : '—'}</span>
                  <input type="checkbox" disabled={!inOrder || !!locked(element)} checked={marked.has(element.id)}
                    aria-label={`Select ${label} for article`} onChange={event => {
                      const next = new Set(marked);
                      if (event.currentTarget.checked) next.add(element.id);
                      else next.delete(element.id);
                      setMarked(next);
                    }}/>
                  <button className="accessibility-row-label" aria-pressed={activeId === element.id} onClick={() => choose(element.id)}
                    onKeyDown={event => {
                      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                      event.preventDefault();
                      move(element.id, event.key === 'ArrowUp' ? -1 : 1);
                    }}>{label}<small>{element.readingArticle || (inOrder ? element.type : 'Decorative artwork')}</small></button>
                  <button className="sm-btn" disabled={!inOrder || index === 0} aria-label={`Move up ${label}`} onClick={() => move(element.id, -1)}>↑</button>
                  <button className="sm-btn" disabled={!inOrder || index >= order.length - 1} aria-label={`Move down ${label}`} onClick={() => move(element.id, 1)}>↓</button>
                </li>;
              })}
            </ol>
          </div>
        </>}
        {view === 'review' && <div className="accessibility-content">
          {!findings.length && <p>No findings in the current publication. Use Linear preview to check the reading sequence.</p>}
          <ul className="accessibility-rows">{findings.slice(0, limit).map(finding => <li key={finding.id}>
            <span>Page {finding.page} · {finding.message}</span>
            <button className="sm-btn" onClick={() => { choose(finding.frameId); setView('order'); }}>Review frame</button>
          </li>)}</ul>
          {findings.length > limit && <button className="sm-btn" onClick={() => setLimit(limit + 40)}>Show more findings</button>}
        </div>}
        {view === 'preview' && <div className="accessibility-content">
          <p>Physical pages are read in sequence. This preview shows text as placed in the frames.</p>
          <ol className="accessibility-linear">{entries.filter(({ element }) => isReadingContent(element)).slice(0, limit).map(entry => {
            const { element } = entry;
            return <li key={element.id}>
              <small>Page {entry.page}{element.readingArticle ? ` · ${element.readingArticle}` : ''}</small>
              <LinearContent element={element} state={state}/>
              <button className="sm-btn" onClick={() => { choose(element.id); setView('order'); }}>Review frame</button>
            </li>;
          })}</ol>
          {entries.filter(({ element }) => isReadingContent(element)).length > limit &&
            <button className="sm-btn" onClick={() => setLimit(limit + 40)}>Show more content</button>}
        </div>}
        {view === 'order' && selected && <aside className="accessibility-properties publication-panel" key={selected.id}>
          <h3>{readingLabel(selected)}</h3>
          <button className="sm-btn" onClick={() => { stateManager.zoomToElement(selected.id); onClose(); }}>Go to canvas frame</button>
          {selected.type === 'image' && <>
            <label>Image description<textarea key={selected.altText} defaultValue={selected.altText || ''} maxLength={2000}
              disabled={!!locked(selected)} onBlur={event => {
                const value = event.currentTarget.value.trim();
                if (value !== (selected.altText || '')) change({ altText: value });
              }}/></label>
            <label className="publication-check"><input type="checkbox" disabled={!!locked(selected)}
              checked={!!selected.decorative} onChange={event => change({ decorative: event.currentTarget.checked })}/>Decorative image</label>
          </>}
          {selected.type === 'text' && !selected.prevFrameId && <>
            <label>First paragraph role<select disabled={!!locked(selected)} value={selected.readingRole || ''}
              onChange={event => change({ readingRole: (event.currentTarget.value || undefined) as TextElement['readingRole'] })}>
              <option value="">Use paragraph style</option>
              <option value="P">Paragraph</option>
              {[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={`H${level}`}>Heading {level}</option>)}
              <option value="Caption">Caption</option>
            </select></label>
            <label>Caption for<select disabled={!!locked(selected) || selected.generated?.kind === 'caption'}
              value={selected.captionForId || ''} onChange={event => change({ captionForId: event.currentTarget.value || undefined })}>
              <option value="">Choose figure or table</option>
              {entries.filter(({ element }) => isReadingContent(element) && (element.type === 'image' || element.type === 'table'))
                .map(({ element, page }) => <option key={element.id} value={element.id}>Page {page} · {readingLabel(element)}</option>)}
            </select></label>
          </>}
          {selected.type === 'table' && !selected.prevFrameId && <label>Column header rows<input key={selected.headerRowCount}
            type="number" min={0} max={selected.rows - (selected.footerRowCount || 0)} defaultValue={selected.headerRowCount}
            disabled={!!locked(selected)} onBlur={event => {
              const count = event.currentTarget.valueAsNumber;
              if (count === selected.headerRowCount) return;
              try {
                if (!Number.isInteger(count) || count < 0 || count > selected.rows - (selected.footerRowCount || 0)) throw new Error('Enter a valid header row count.');
                tableGrid(selected.cells, count, selected.footerRowCount || 0);
                if (revision !== stateManager.getDocumentRevision()) throw new Error('The publication changed. Try the edit again.');
                stateManager.updateTableSource(selected.id, { headerRowCount: count });
                setMessage('');
              } catch (error) {
                event.currentTarget.value = String(selected.headerRowCount);
                setMessage(error instanceof Error ? error.message : String(error));
              }
            }}/></label>}
        </aside>}
      </div>
    </section>
  </div>;
}
