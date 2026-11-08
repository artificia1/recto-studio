import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';

export default function MasterItemsPanel({ state }: { state: ProjectState }) {
  const [id, setId] = useState(''), [message, setMessage] = useState('');
  const master = state.masterSpreads.find(master => master.id === id) || state.masterSpreads[0];
  const act = (action: () => void) => { try { action(); setMessage('Master updated. Descendants inherit the change.'); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  return <details className="publication-panel"><summary>Edit master items</summary>
    <p>Edit owned objects here; inherited items are edited in their parent. To add artwork, select it in the spread, then copy it into the chosen master. Corresponding page sides are used when available.</p>
    <label>Master to edit<select aria-label="Master to edit" value={master?.id || ''} onChange={event => setId(event.currentTarget.value)}>{state.masterSpreads.map(master => <option key={master.id} value={master.id}>{master.name}</option>)}</select></label>
    <button className="sm-btn" disabled={!master} onClick={() => master && act(() => stateManager.copySelectionToMaster(master.id))}>Copy selected artwork into master</button>
    <div className="editorial-list">{master?.elements.map(element => <div className="reference-note" key={element.id}>
      <strong>{element.name || `${element.type} · ${element.id.slice(-8)}`}</strong>
      <button className="sm-btn" onClick={() => act(() => stateManager.updateMasterItem(master.id, element.id, { locked: !element.locked }))}>{element.locked ? 'Unlock master item' : 'Lock master item'}</button>
      <div className="input-grid-2">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key} (mm)<input aria-label={`Master ${key} ${element.id}`} type="number" step={0.5} value={element[key]} disabled={element.locked} onChange={event => act(() => stateManager.updateMasterItem(master.id, element.id, { [key]: Number(event.currentTarget.value) }))}/></label>)}</div>
      {element.type === 'text' && <label>Master text<textarea value={element.text} disabled={element.locked} onChange={event => act(() => stateManager.updateMasterItem(master.id, element.id, { text: event.currentTarget.value }))}/></label>}
    </div>)}</div>
    {message && <p role="status">{message}</p>}
  </details>;
}
