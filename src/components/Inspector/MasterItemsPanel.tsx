import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import type { CanvasElement, MasterSpread, ProjectState } from '../../types';

const SIDE_ORDER = { left: 0, single: 1, right: 2 } as const;
const SIDE_LABEL = { left: 'Left page', single: 'Page', right: 'Right page' } as const;

function masterLabel(master: MasterSpread): string {
  return `[${master.prefix}] ${master.name}`;
}

function sideOf(master: MasterSpread, element: CanvasElement) {
  return master.pages.find(page => page.id === element.pageId)?.side ?? 'single';
}

/** Where a master item sits, so header, folio and other items can be told apart without their ids. */
function itemPlace(master: MasterSpread, element: CanvasElement, pageHeightMm: number): string {
  const middle = element.y + element.height / 2;
  const band = middle < pageHeightMm / 3 ? 'top' : middle > pageHeightMm * 2 / 3 ? 'bottom' : 'middle';
  return `${SIDE_LABEL[sideOf(master, element)]} · ${band}`;
}

function itemTitle(element: CanvasElement): string {
  if (element.name) return element.name;
  if (element.type !== 'text') return element.type;
  const text = (element.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'text (empty)';
  return `text “${text.length > 30 ? `${text.slice(0, 30)}…` : text}”`;
}

/** Left page first, then right; top to bottom within a page. */
function orderedItems(master: MasterSpread): CanvasElement[] {
  return [...master.elements].sort((a, b) =>
    SIDE_ORDER[sideOf(master, a)] - SIDE_ORDER[sideOf(master, b)] || a.y - b.y);
}

export default function MasterItemsPanel({ state }: { state: ProjectState }) {
  const [id, setId] = useState(''), [message, setMessage] = useState('');
  const master = state.masterSpreads.find(master => master.id === id) || state.masterSpreads[0];
  const act = (action: () => void) => { try { action(); setMessage('Master updated. Descendants inherit the change.'); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  return <details className="publication-panel"><summary>Edit master items</summary>
    <p>Edit owned objects here; inherited items are edited in their parent. To add artwork, select it in the spread, then copy it into the chosen master. Corresponding page sides are used when available.</p>
    <label>Master to edit<select aria-label="Master to edit" value={master?.id || ''} onChange={event => setId(event.currentTarget.value)}>{state.masterSpreads.map(master => <option key={master.id} value={master.id}>{masterLabel(master)}</option>)}</select></label>
    <button className="sm-btn" disabled={!master} onClick={() => master && act(() => stateManager.copySelectionToMaster(master.id))}>Copy selected artwork into master</button>
    <div className="editorial-list">{master && orderedItems(master).map(element => <div className="reference-note" key={element.id}>
      <strong title={element.id}>{itemTitle(element)}</strong>
      <span className="master-item-place">{itemPlace(master, element, state.settings.heightMm)}</span>
      <button className="sm-btn" onClick={() => act(() => stateManager.updateMasterItem(master.id, element.id, { locked: !element.locked }))}>{element.locked ? 'Unlock master item' : 'Lock master item'}</button>
      <div className="input-grid-2">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key} (mm)<input aria-label={`Master ${key} ${element.id}`} type="number" step={0.5} value={element[key]} disabled={element.locked} onChange={event => act(() => stateManager.updateMasterItem(master.id, element.id, { [key]: Number(event.currentTarget.value) }))}/></label>)}</div>
      {element.type === 'text' && <label>Master text<textarea value={element.text} disabled={element.locked} onChange={event => act(() => stateManager.updateMasterItem(master.id, element.id, { text: event.currentTarget.value }))}/></label>}
    </div>)}</div>
    {message && <p role="status">{message}</p>}
  </details>;
}
