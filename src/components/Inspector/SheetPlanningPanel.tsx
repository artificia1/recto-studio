import { useState } from 'preact/hooks';
import { planSheet, type SheetPlanInput } from '../../engine/sheetPlanning';
import { savePublicationFile } from '../../desktop';
import type { ProjectState } from '../../types';

export function SheetPlanningPanel({ state }: { state: ProjectState }) {
  const [input, setInput] = useState<SheetPlanInput>({ sheetWidth: 1016, sheetHeight: 711.2, pieceWidth: state.settings.widthMm,
    pieceHeight: state.settings.heightMm, margin: 10, gap: 3, quantity: 24, allowRotation: false });
  const [message, setMessage] = useState('');
  let result: ReturnType<typeof planSheet> | undefined, error = '';
  try { result = planSheet(input); } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  const fields = { sheetWidth: 'Sheet width (mm)', sheetHeight: 'Sheet height (mm)', pieceWidth: 'Piece width (mm)', pieceHeight: 'Piece height (mm)', margin: 'Sheet margin (mm)', gap: 'Piece gap (mm)', quantity: 'Required quantity' } as const;
  return <details className="publication-panel">
    <summary>Rectangular sheet planning</summary>
    <p>Compare upright and rotated uniform grids. The default sheet is 40 × 28 inches. This does not generate cutting tools or interlocking carton geometry.</p>
    <div className="input-grid-2">{Object.entries(fields).map(([key, label]) => <label key={key}>{label}<input type="number" value={input[key as keyof typeof fields]} min={key === 'margin' || key === 'gap' ? 0 : 1} step={key === 'quantity' ? 1 : 0.1} onInput={event => setInput({ ...input, [key]: Number(event.currentTarget.value) })}/></label>)}</div>
    <label className="publication-check"><input type="checkbox" checked={input.allowRotation} onChange={event => setInput({ ...input, allowRotation: event.currentTarget.checked })}/>Allow 90° rotation (verify grain direction)</label>
    {error ? <p role="alert">{error}</p> : result && <>
      <p>{result.capacity} pieces per sheet · {result.sheetsRequired ?? 'No fit'} sheets required · {(result.firstSheetAreaUtilization * 100).toFixed(1)}% first-sheet area utilization.</p>
      <p>{result.warning}</p>
      <div className="publication-actions"><button className="sm-btn" onClick={async () => {
        try { setMessage(await savePublicationFile('recto-sheet-plan.json', JSON.stringify(result, null, 2), 'application/json') ? 'Sheet plan saved.' : 'Save cancelled.'); }
        catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
      }}>Save sheet plan</button></div>
    </>}
    {message && <p role="status">{message}</p>}
  </details>;
}
