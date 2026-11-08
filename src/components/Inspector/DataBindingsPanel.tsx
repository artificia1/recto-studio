import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProjectState, TextDataBinding } from '../../types';
import { stateManager } from '../../state';
import { previewDataRefresh, type DataRefreshChange } from '../../engine/dataRefresh';

const defaults: TextDataBinding = { source: 'Inventory', keyField: 'sku', recordKey: '', field: 'price' };

export default function DataBindingsPanel({ state }: { state: ProjectState }) {
  const element = state.spreads.flatMap(spread => spread.elements).find(element => element.id === state.selectedElementId);
  const selected = element?.type === 'text' ? element : undefined;
  const [form, setForm] = useState<TextDataBinding>(selected?.dataBinding || defaults);
  const [changes, setChanges] = useState<DataRefreshChange[]>([]);
  const [message, setMessage] = useState('');
  const sequence = useRef(0);
  useEffect(() => { sequence.current++; setForm(selected?.dataBinding || defaults); setChanges([]); setMessage(''); }, [selected?.id]);
  const edit = (key: keyof TextDataBinding, value: string) => { sequence.current++; setChanges([]); setForm({ ...form, [key]: value }); };
  return <details className="publication-panel">
    <summary>Bound text data</summary>
    <p>Bind standalone price or product frames to a reviewed JSON snapshot. Export snapshots from a trusted database gateway; publication files never contain SQL, passwords or connection strings. Refresh is manual.</p>
    {(['source', 'keyField', 'recordKey', 'field'] as const).map(key => <label key={key}>{({ source: 'Data source label', keyField: 'Record key field', recordKey: 'Record key value', field: 'Bound value field' })[key]}
      <input value={form[key]} maxLength={256} onInput={event => edit(key, event.currentTarget.value)}/></label>)}
    <div className="publication-actions">
      <button className="sm-btn" disabled={!selected} onClick={() => {
        try { stateManager.bindTextData(selected!.id, form); setChanges([]); setMessage('Text frame bound. Choose a snapshot to preview changes.'); }
        catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
      }}>Bind selected text frame</button>
      <button className="sm-btn" disabled={!selected?.dataBinding} onClick={() => {
        try { stateManager.bindTextData(selected!.id, null); setChanges([]); setMessage('Binding removed; text preserved.'); }
        catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
      }}>Unbind frame</button>
    </div>
    <label>JSON data snapshot<input type="file" accept=".json,application/json" onChange={async event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      const token = ++sequence.current; setChanges([]);
      if (!file) return;
      try {
        if (file.size > 4 * 1024 * 1024) throw new Error('Choose a JSON snapshot smaller than 4 MB.');
        const records: unknown = JSON.parse(await file.text());
        if (token !== sequence.current) return;
        const proposed = previewDataRefresh(stateManager.getState(), form.source, records);
        setChanges(proposed); setMessage(`${proposed.length} changed frames in source “${form.source}”. Values are used as provided; review currency formatting.`);
      } catch (reason) { if (token === sequence.current) setMessage(reason instanceof Error ? reason.message : String(reason)); }
    }}/></label>
    <ul className="editorial-list">{changes.slice(0, 100).map(change => <li key={change.elementId}><p>{change.binding.recordKey} · {change.binding.field}</p><p>{change.before} → {change.after}</p></li>)}</ul>
    {changes.length > 100 && <p>Showing the first 100 of {changes.length} changes.</p>}
    <div className="publication-actions"><button className="sm-btn" disabled={!changes.length} onClick={() => {
      try {
        const ids = new Set(changes.map(change => change.elementId));
        stateManager.applyDataRefresh(changes);
        const overflow = stateManager.runPreflightCheck().filter(issue => issue.code === 'OVERSET_TEXT' && ids.has(issue.elementId || '')).length;
        setMessage(`Updated ${changes.length} frames in one undo step. ${overflow} updated frames have overset text; review preflight.`);
        setChanges([]);
      } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    }}>Apply reviewed data changes</button></div>
    {message && <p role="status">{message}</p>}
  </details>;
}
