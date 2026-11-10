import type { ShapeElement, VectorDecoration, VectorPathElement } from '../../types';
import { validDecorationColor } from '../../engine/vectorDecoration';
import { explicitCmyk } from '../../engine/inkColors';
import { stateManager } from '../../state';

type Artwork = ShapeElement | VectorPathElement;
const RGB_CORNERS = ['#103a68', '#10a7a0', '#b62658', '#f6be42'];
const CMYK_CORNERS = ['cmyk(90,65,0,10)', 'cmyk(80,0,35,0)', 'cmyk(0,90,25,10)', 'cmyk(0,30,90,0)'];
const mesh = (process: boolean): VectorDecoration => ({ kind: 'mesh', columns: 2, rows: 2, colors: process ? [...CMYK_CORNERS] : [...RGB_CORNERS] });

export default function VectorDecorationPanel({ element, disabled }: { element: Artwork; disabled: boolean }) {
  const closed = element.type === 'shape' ? element.shapeKind !== 'line' : element.closed;
  const decoration = element.decoration;
  const update = (value?: VectorDecoration) => stateManager.updateElement(element.id, { decoration: value });
  const numeric = (label: string, value: number, min: number, max: number, change: (value: number) => void, step = 0.1) =>
    <label>{label}<input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => {
      const number = event.currentTarget.valueAsNumber;
      if (Number.isFinite(number)) change(Math.max(min, Math.min(max, number)));
    }}/></label>;
  const inkInput = (label: string, value: string, change: (value: string) => void, process?: boolean) =>
    <label>{label}<input value={value} disabled={disabled} onChange={event => {
      const input = event.currentTarget, ink = input.value.trim();
      if (validDecorationColor(ink, process)) change(ink);
      else input.value = value;
    }}/></label>;
  return <details className="inspector-section">
    <summary>Vector fills and strokes</summary>
    {closed && <>
      <label>Vector fill<select aria-label="Vector fill" value={decoration?.kind || ''} disabled={disabled || !!element.spotColor} onChange={event => {
        const mode = event.currentTarget.value;
        update(mode === 'hatch' ? { kind: 'hatch', color: '#151515', angle: 45, spacing: 3, weight: 0.25, crossed: false }
          : mode === 'mesh' ? mesh(false) : undefined);
      }}><option value="">Standard fill</option><option value="hatch">Vector hatching</option><option value="mesh">Mesh gradient</option></select></label>
      {element.spotColor && <p>Choose a process or RGB fill before adding hatching or a mesh.</p>}
      {decoration?.kind === 'hatch' && <>
        {inkInput('Hatch ink', decoration.color, color => update({ ...decoration, color }))}
        {numeric('Hatch angle', decoration.angle, -360, 360, angle => update({ ...decoration, angle }), 1)}
        {numeric('Hatch spacing (mm)', decoration.spacing, 0.25, 100, spacing => update({ ...decoration, spacing, weight: Math.min(spacing, decoration.weight) }))}
        {numeric('Hatch weight (mm)', decoration.weight, 0.05, decoration.spacing, weight => update({ ...decoration, weight }))}
        <label><input type="checkbox" checked={decoration.crossed} disabled={disabled} onChange={event =>
          update({ ...decoration, crossed: event.currentTarget.checked })}/>Crosshatch</label>
      </>}
      {decoration?.kind === 'mesh' && <>
        <button className="sm-btn" disabled={disabled} onClick={() => update(mesh(!explicitCmyk(decoration.colors[0])))}>
          {explicitCmyk(decoration.colors[0]) ? 'Start RGB mesh' : 'Start CMYK mesh'}
        </button>
        {(['columns', 'rows'] as const).map(axis => <div key={axis}>{numeric(`Mesh ${axis}`, decoration[axis], 2, 6, value => {
          const next = { ...decoration, [axis]: Math.round(value) };
          next.colors = Array.from({ length: next.rows * next.columns }, (_, index) => {
            const x = Math.round((index % next.columns) * (decoration.columns - 1) / (next.columns - 1));
            const y = Math.round(Math.floor(index / next.columns) * (decoration.rows - 1) / (next.rows - 1));
            return decoration.colors[y * decoration.columns + x];
          });
          update(next);
        }, 1)}</div>)}
        <p>Mesh node colors use one color space.</p>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${decoration.columns}, minmax(0, 1fr))`, gap: '4px' }}>
          {decoration.colors.map((color, index) => <div key={index}>{inkInput(`Node ${index + 1}`, color,
            value => update({ ...decoration, colors: decoration.colors.map((current, i) => i === index ? value : current) }),
            !!explicitCmyk(decoration.colors[0]))}</div>)}
        </div>
      </>}
    </>}
    <label><input type="checkbox" checked={!!element.strokePattern} disabled={disabled} onChange={event =>
      stateManager.updateElement(element.id, { strokePattern: event.currentTarget.checked ? { dash: 3, gap: 2 } : undefined })}/>Patterned stroke</label>
    {element.strokePattern && (['dash', 'gap'] as const).map(key => <div key={key}>{numeric(`Stroke ${key} (mm)`, element.strokePattern![key], 0.1, 100,
      value => stateManager.updateElement(element.id, { strokePattern: { ...element.strokePattern!, [key]: value } }))}</div>)}
  </details>;
}
