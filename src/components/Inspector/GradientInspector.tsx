import { useState } from 'preact/hooks';
import type { FillGradient, ShapeElement, VectorPathElement } from '../../types';
import { stateManager } from '../../state';
import { displayGradientColor, validGradient } from '../../engine/fillGradients';
import { rgbColor } from '../../engine/inkColors';

type Artwork = ShapeElement | VectorPathElement;

function defaultFill(element: Artwork): FillGradient {
  const initial = rgbColor(displayGradientColor(element.fillColor)) ? element.fillColor : '#122447';
  return { kind: 'linear', start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 },
    stops: [{ offset: 0, color: initial }, { offset: 1, color: '#ffffff' }] };
}

export default function GradientInspector({ element, disabled }: { element: Artwork; disabled: boolean }) {
  const [error, setError] = useState('');
  const gradient = element.fillGradient;
  const change = (next?: FillGradient) => {
    if (next && !validGradient(next)) { setError('Choose distinct points and stop positions between 0% and 100%.'); return; }
    stateManager.updateElement(element.id, { fillGradient: next, ...(next ? { fillColor: next.stops[0].color } : {}) });
    setError('');
  };
  return <details className="publication-panel" open={!!gradient}>
    <summary>Gradient fill</summary>
    <fieldset disabled={disabled}>
      <label>Fill type<select value={gradient?.kind || 'solid'} onChange={event => {
        const kind = event.currentTarget.value;
        if (kind === 'solid') { change(); return; }
        const next = gradient || defaultFill(element);
        change({ ...next, kind: kind as FillGradient['kind'],
          ...(kind === 'radial' && !gradient ? { start: { x: 0.5, y: 0.5 } } : {}) });
      }}>
        <option value="solid">Solid</option><option value="linear">Linear gradient</option><option value="radial">Radial gradient</option>
      </select></label>
      {gradient && <>
        <div className="input-grid-2">{(['start', 'end'] as const).flatMap(point =>
          (['x', 'y'] as const).map(axis => <label key={point + axis}>{point === 'start' ? 'Start' : 'End'} {axis.toUpperCase()} (%)
            <input type="number" step="1" min="-3200" max="3200" value={+(gradient[point][axis] * 100).toFixed(3)} onChange={event => {
              const input = event.currentTarget, value = input.valueAsNumber;
              if (Number.isFinite(value)) change({ ...gradient, [point]: { ...gradient[point], [axis]: value / 100 } });
            }} />
          </label>))}</div>
        {gradient.stops.map((stop, index) => {
          const color = rgbColor(displayGradientColor(stop.color)) || [0, 0, 0];
          const update = (next: typeof stop) => change({ ...gradient, stops: gradient.stops.map((entry, i) => i === index ? next : entry).sort((a, b) => a.offset - b.offset) });
          return <div className="publication-actions" key={index}>
            <label>Stop {index + 1} colour<input type="color" value={'#' + color.map(value => value.toString(16).padStart(2, '0')).join('')} onChange={event => update({ ...stop, color: event.currentTarget.value })} /></label>
            <label>Stop {index + 1} position (%)<input type="number" min="0" max="100" step="0.1" value={+(stop.offset * 100).toFixed(3)} onChange={event => {
              if (Number.isFinite(event.currentTarget.valueAsNumber)) update({ ...stop, offset: event.currentTarget.valueAsNumber / 100 });
            }} /></label>
            <button className="sm-btn" aria-label={'Remove stop ' + (index + 1)} disabled={gradient.stops.length <= 2}
              onClick={() => change({ ...gradient, stops: gradient.stops.filter((_, i) => i !== index) })}>Remove</button>
          </div>;
        })}
        <div className="publication-actions">
          <button className="sm-btn" disabled={gradient.stops.length >= 16} onClick={() => {
            const gaps = gradient.stops.slice(1).map((stop, i) => ({ first: gradient.stops[i], last: stop }));
            const { first, last } = gaps.reduce((a, b) => a.last.offset - a.first.offset >= b.last.offset - b.first.offset ? a : b);
            change({ ...gradient, stops: [...gradient.stops, { offset: (first.offset + last.offset) / 2, color: first.color }].sort((a, b) => a.offset - b.offset) });
          }}>Add stop</button>
          <button className="sm-btn" onClick={() => change({ ...gradient, stops: gradient.stops.map(stop => ({ ...stop, offset: 1 - stop.offset })).reverse() })}>Reverse colours</button>
        </div>
      </>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </details>;
}
