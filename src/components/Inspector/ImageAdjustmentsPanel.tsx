import type { ImageAdjustments, ImageElement } from '../../types';
import { neutralAdjustments } from '../../engine/imageAdjustments';
import { stateManager } from '../../state';

export default function ImageAdjustmentsPanel({ image }: { image: ImageElement }) {
  const settings = image.adjustments || neutralAdjustments;
  const disabled = image.locked || !!stateManager.getState().layers.find(layer => layer.id === image.layerId)?.locked;
  const update = (adjustments?: ImageAdjustments) => stateManager.updateElement(image.id, { adjustments });
  if (!/^data:image\/(?:png|jpeg|webp);/i.test(image.src) || image.equation) return image.adjustments ? <section className="inspector-section">
    <p>Image adjustments need an embedded PNG, JPEG or WebP.</p>
    <button className="sm-btn" disabled={disabled} onClick={() => update()}>Reset image adjustments</button>
  </section> : null;
  const level = (key: 'black' | 'white' | 'gamma', label: string, min: number, max: number, step = 1) =>
    <label>{label}<input type="number" min={min} max={max} step={step} value={settings[key]} disabled={disabled} onChange={event => {
      const value = event.currentTarget.valueAsNumber;
      if (Number.isFinite(value)) update({ ...settings, [key]: Math.max(min, Math.min(max, value)) });
    }}/></label>;
  const points = [{ input: 0, output: 0 }, ...settings.curve, { input: 255, output: 255 }];
  return <details className="inspector-section">
    <summary>Image adjustments</summary>
    <p>Adjust this frame’s appearance while keeping the original image available.</p>
    <label><input type="checkbox" checked={!!settings.grayscale} disabled={disabled} onChange={event =>
      update({ ...settings, grayscale: event.currentTarget.checked })}/>Grayscale</label>
    {level('black', 'Black level', 0, settings.white - 1)}
    {level('white', 'White level', settings.black + 1, 255)}
    {level('gamma', 'Midtone gamma', 0.1, 5, 0.1)}
    <svg viewBox="0 0 255 255" role="img" aria-label="Tone curve" style={{ width: '100%', maxHeight: '120px', background: 'var(--bg-input)' }}>
      <polyline points={points.map(point => `${point.input},${255 - point.output}`).join(' ')} fill="none" stroke="#55c8ff" stroke-width="3"/>
    </svg>
    {settings.curve.map((point, index) => <div key={index}>
      {(['input', 'output'] as const).map(axis => <label key={axis}>Point {index + 1} {axis}
        <input type="number" min={axis === 'input' ? points[index].input + 1 : 0} max={axis === 'input' ? points[index + 2].input - 1 : 255}
          value={point[axis]} disabled={disabled} onChange={event => {
            const input = event.currentTarget;
            if (!Number.isFinite(input.valueAsNumber)) return;
            const value = Math.max(Number(input.min), Math.min(Number(input.max), input.valueAsNumber));
            update({ ...settings, curve: settings.curve.map((item, i) => i === index ? { ...item, [axis]: value } : item) });
          }}/></label>)}
      <button className="sm-btn" disabled={disabled} onClick={() => update({ ...settings, curve: settings.curve.filter((_, i) => i !== index) })}>Remove point {index + 1}</button>
    </div>)}
    <button className="sm-btn" disabled={disabled || settings.curve.length >= 8} onClick={() => {
      const segments = points.slice(1).map((end, index) => ({ start: points[index], end }));
      const { start, end } = segments.reduce((a, b) => a.end.input - a.start.input >= b.end.input - b.start.input ? a : b);
      if (end.input - start.input < 2) return;
      update({ ...settings, curve: [...settings.curve, { input: Math.round((start.input + end.input) / 2),
        output: Math.round((start.output + end.output) / 2) }].sort((a, b) => a.input - b.input) });
    }}>Add curve point</button>
    <button className="sm-btn" disabled={disabled || !image.adjustments} onClick={() => update()}>Reset image adjustments</button>
  </details>;
}
