import { useState } from 'preact/hooks';
import type { CanvasElement } from '../../types';
import { stateManager } from '../../state';
import { assetStore } from '../../engine/assetStore';

export default function TextWrapInspector({ element }: { element: CanvasElement }) {
  const wrap = element.textWrap || { mode: 'none', standoffMm: 3 };
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [threshold, setThreshold] = useState(15);
  const locked = element.locked || stateManager.getState().layers.some(layer => layer.id === element.layerId && layer.locked);
  return <div className="inspector-section">
    <div className="section-header">TEXT WRAP</div>
    <label>Wrap around this object<select aria-label="Text wrap mode" value={wrap.mode} disabled={locked || busy} onChange={event => stateManager.updateElement(element.id,
      { textWrap: { mode: event.currentTarget.value as typeof wrap.mode, standoffMm: wrap.standoffMm } })}>
      <option value="none">None</option><option value="boundingBox">Bounding box</option><option value="contour">Outer contour</option>
    </select></label>
    {wrap.mode !== 'none' && <label>Wrap gutter (mm)<input aria-label="Text wrap gutter" type="number" min={0} max={100} step={0.5} value={wrap.standoffMm} disabled={locked || busy}
      onChange={event => stateManager.updateElement(element.id, { textWrap: { ...wrap, standoffMm: Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0)) } })}/></label>}
    {element.type === 'image' && <details className="publication-panel"><summary>Wrap around transparency</summary>
      <p>Trace the placed image's alpha channel. The saved outline follows proportional fitting, cropping, focal point and rotation. Relinking clears the old outline.</p>
      <label>Alpha threshold<input aria-label="Wrap alpha threshold" type="number" min={0} max={254} value={threshold} disabled={busy} onChange={event => setThreshold(Math.max(0, Math.min(254, Number(event.currentTarget.value) || 0)))}/></label>
      <button className="sm-btn" disabled={locked || busy || !element.src} onClick={() => {
        const id = element.id, source = element.src;
        setBusy(true); setError('');
        void (async () => {
          try {
            const { decodeSrgbRaster } = await import('../../engine/rasterPixels');
            const image = await decodeSrgbRaster(source, 1024, true);
            const current = stateManager.getActiveSpread().elements.find(item => item.id === id);
            if (current?.type !== 'image' || current.src !== source) throw new Error('The artwork changed while tracing. Select it and trace again.');
            const contour = assetStore.computeAlphaContour(image.data, image.width, image.height, 256, threshold);
            stateManager.setElementAlphaContour(id, contour, { width: image.originalWidth, height: image.originalHeight });
          } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          finally { setBusy(false); }
        })();
      }}>{busy ? 'Tracing transparency…' : 'Trace transparency'}</button>
      {element.alphaContour && <p role="status">{element.alphaContour.length} outline slices saved.</p>}
      {element.alphaContour && <button className="sm-btn" disabled={locked || busy} onClick={() => stateManager.updateElement(element.id, { alphaContour: undefined })}>Clear saved outline</button>}
    </details>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
