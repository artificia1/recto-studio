import { useState } from 'preact/hooks';
import { ornamentalRosette } from '../../engine/ornamentalRosette';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';

export function OrnamentPanel({ state }: { state: ProjectState }) {
  const [diameter, setDiameter] = useState(60);
  const [lobes, setLobes] = useState(12);
  const [modulation, setModulation] = useState(0.32);
  const [message, setMessage] = useState('');
  let ornament: ReturnType<typeof ornamentalRosette> | undefined, error = '';
  try { ornament = ornamentalRosette(diameter, lobes, modulation); } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  return <details className="publication-panel">
    <summary>Rosette ornaments</summary>
    <p>Editable mathematical line art for decorative certificates, invitations and badges. Patterns repeat; copier resistance, microprint readability and latent-image effects are not guaranteed.</p>
    <label>Rosette diameter (mm)<input type="number" min={2} max={200} value={diameter} onInput={event => setDiameter(Number(event.currentTarget.value))}/></label>
    <label>Rosette lobes<input type="number" min={3} max={32} value={lobes} onInput={event => setLobes(Number(event.currentTarget.value))}/></label>
    <label>Rosette modulation<input type="range" min={0.05} max={0.45} step={0.01} value={modulation} onInput={event => setModulation(Number(event.currentTarget.value))}/></label>
    {ornament && <svg role="img" aria-label="Rosette preview" viewBox={`-1 -1 ${diameter + 2} ${diameter + 2}`} style={{ width: '100%', height: '160px' }}><path d={ornament.path} fill="none" stroke="currentColor" stroke-width={0.12}/></svg>}
    {error && <p role="alert">{error}</p>}
    <div className="publication-actions"><button className="sm-btn" disabled={!ornament} onClick={() => {
      try {
        const spread = stateManager.getActiveSpread(), settings = stateManager.getState().settings;
        const layer = state.layers.find(layer => layer.id === state.activeLayerId);
        if (layer?.locked || layer?.visible === false) throw new Error('Choose a visible, unlocked layer.');
        if (diameter > settings.widthMm - settings.margins.insideMm - settings.margins.outsideMm || diameter > settings.heightMm - settings.margins.topMm - settings.margins.bottomMm) throw new Error('Reduce the diameter to fit within this page’s margins.');
        const result = ornamentalRosette(diameter, lobes, modulation);
        stateManager.addElement({ id: `ornament-${crypto.randomUUID()}`, name: 'Decorative rosette', type: 'path', pageId: spread.pages[0].id,
          x: settings.margins.insideMm, y: settings.margins.topMm, width: diameter, height: diameter,
          rotation: 0, opacity: 1, zIndex: Math.max(0, ...spread.elements.map(element => element.zIndex)) + 1,
          locked: false, nodes: result.nodes, closed: true, fillColor: 'transparent', strokeColor: '#284763',
          strokeWidthMm: 0.12, strokeCap: 'round', strokeJoin: 'round', strokeDash: 'solid' });
        setMessage('Editable ornament inserted. Proof the line weight with your printer.');
      } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    }}>Insert editable rosette</button></div>
    {message && <p role="status">{message}</p>}
  </details>;
}
