import { stateManager } from '../state';
import { ProjectState, ToolType } from '../types';

interface ToolbarProps {
  state: ProjectState;
}

export function Toolbar({ state }: ToolbarProps) {
  const currentTool = state.activeTool;
  const activeSpread = stateManager.getActiveSpread();
  const selectedEl = state.selectedElementId
    ? activeSpread.elements.find((e) => e.id === state.selectedElementId)
    : null;
  const fillColor = (selectedEl as any)?.backgroundColor || (selectedEl as any)?.fillColor || '#ffffff';
  const strokeColor = (selectedEl as any)?.borderColor || (selectedEl as any)?.strokeColor || '#111111';

  return (
    <aside className="toolbar-left">
      <button
        className={`tool-btn ${currentTool === 'select' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('select')}
        title="Selection Tool (V)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 2l9 7.5-4.5.5 2.5 4.5-1.8.9-2.5-4.5L3 13V2z" />
        </svg>
      </button>

      <button
        className={`tool-btn ${currentTool === 'text' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('text')}
        title="Type Tool (T)"
      >
        <span style={{ fontWeight: 800, fontSize: '13px', fontFamily: 'serif' }}>T</span>
      </button>

      <button
        className={`tool-btn ${currentTool === 'frame' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('frame')}
        title="Rectangle Frame Tool (F)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="2.5" y="2.5" width="11" height="11" />
          <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
          <line x1="13.5" y1="2.5" x2="2.5" y2="13.5" />
        </svg>
      </button>

      <button
        className={`tool-btn ${currentTool === 'table' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('table')}
        title="Table Tool (B / Shift+T)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="2.5" y="2.5" width="11" height="11" />
          <line x1="2.5" y1="8" x2="13.5" y2="8" />
          <line x1="8" y1="2.5" x2="8" y2="13.5" />
        </svg>
      </button>

      <button
        className={`tool-btn ${currentTool === 'pen' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('pen')}
        title="Pen Tool (P)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.5 1.5l2 2-7.5 7.5-3.5 1 1-3.5 8-7z" fill="currentColor" fillOpacity="0.15" />
          <circle cx="6" cy="10" r="0.7" fill="currentColor" />
        </svg>
      </button>

      <button
        className={`tool-btn ${currentTool === 'shape-rect' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('shape-rect')}
        title="Rectangle Tool (M)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="2.5" y="3.5" width="11" height="9" rx="0.5" />
        </svg>
      </button>

      <button
        className={`tool-btn ${currentTool === 'shape-ellipse' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('shape-ellipse')}
        title="Ellipse / Circle Tool (O)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="5.5" />
        </svg>
      </button>

      <button
        className={`tool-btn ${currentTool === 'shape-line' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('shape-line')}
        title="Line Tool (L)"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <line x1="3" y1="13" x2="13" y2="3" />
        </svg>
      </button>

      <button
        className={`tool-btn ${currentTool === 'measure' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('measure')}
        title="Measure Tool (K) — Click and drag to measure distance, angle, and delta"
      >
        <span style={{ fontWeight: 800, fontSize: '13px', lineHeight: 1 }}>↔</span>
      </button>

      <div className="tool-divider"></div>

      <button
        className={`tool-btn ${currentTool === 'hand' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('hand')}
        title="Hand Tool (H) or Spacebar drag"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 2v5M7.5 3v4M9.5 4v3M3.5 5v5a4 4 0 0 0 8 0V4.5a.7.7 0 0 0-1.4 0v2M1.5 7.5l2-2.5" />
        </svg>
      </button>

      <div className="tool-divider"></div>

      {/* InDesign-style Fill / Stroke Swatch Box */}
      <div className="toolbar-swatches" title="Fill & Stroke (Shift+X to swap)">
        <div className="swatch-container">
          <div
            className="swatch-stroke"
            style={{ backgroundColor: strokeColor === 'transparent' ? '#27272a' : strokeColor }}
            title={`Stroke: ${strokeColor}`}
          />
          <div
            className="swatch-fill"
            style={{ backgroundColor: fillColor === 'transparent' ? '#ffffff' : fillColor }}
            title={`Fill: ${fillColor}`}
          />
          <button
            className="swatch-swap-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (selectedEl) {
                stateManager.updateElement(selectedEl.id, {
                  backgroundColor: strokeColor,
                  borderColor: fillColor,
                } as any);
              }
            }}
            title="Swap Fill and Stroke (Shift+X)"
          >
            ⇄
          </button>
        </div>
      </div>

      <div className="tool-divider"></div>

      <button
        className={`tool-btn ${state.previewMode ? 'active' : ''}`}
        onClick={() => stateManager.togglePreviewMode()}
        title="Toggle Preview Screen Mode (W)"
      >
        <span style={{ fontWeight: 800, fontSize: '11px', letterSpacing: '0.5px' }}>W</span>
      </button>
    </aside>
  );
}
