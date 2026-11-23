import { useEffect, useState } from 'preact/hooks';
import { stateManager } from '../state';

const zoomPresets = [50, 75, 100, 125, 150, 200];

function useZoomPercent() {
  const [percent, setPercent] = useState(() => Math.round(stateManager.getState().zoom * 100));
  useEffect(() => {
    const unsubscribe = stateManager.subscribe(state => setPercent(Math.round(state.zoom * 100)));
    setPercent(Math.round(stateManager.getState().zoom * 100));
    return unsubscribe;
  }, []);
  return percent;
}

export function CanvasZoomSelect() {
  const percent = useZoomPercent();
  const custom = !zoomPresets.includes(percent);
  return (
    <select className="styled-select" value={custom ? 'custom' : String(percent / 100)} title="Canvas Zoom"
      onChange={event => {
        const value = event.currentTarget.value;
        if (value === 'fit') {
          stateManager.setZoomAndPan(0.85, 0, 0);
          if (percent === 85) event.currentTarget.value = 'custom';
        } else if (value !== 'custom') {
          stateManager.setZoom(Number(value));
        }
      }}>
      {custom && <option value="custom">{percent}%</option>}
      <option value="fit">Fit Spread</option>
      {zoomPresets.map(preset => <option key={preset} value={preset / 100}>{preset}%</option>)}
    </select>
  );
}

export function MobileCanvasZoom() {
  const percent = useZoomPercent();
  const step = (delta: number) => {
    stateManager.setZoom(Math.round(stateManager.getState().zoom * 100 + delta) / 100);
  };
  return (
    <div className="mobile-canvas-zoom-pill">
      <button className="mobile-zoom-btn" onClick={() => step(-15)} title="Zoom Out" aria-label="Zoom Out">−</button>
      <button className="mobile-zoom-btn mobile-zoom-fit-btn" onClick={() => stateManager.setZoomAndPan(0.85, 0, 0)}
        title="Fit Spread to Screen" aria-label="Fit Spread">Fit</button>
      <span className="mobile-zoom-label">{percent}%</span>
      <button className="mobile-zoom-btn" onClick={() => step(15)} title="Zoom In" aria-label="Zoom In">+</button>
    </div>
  );
}
