import { stateManager } from '../state';
import { ProjectState } from '../types';

interface ToolbarProps {
  state: ProjectState;
}

function ToolIcon({ name }: { name: string }) {
  return <svg width="15" height="15" aria-hidden="true">
    <use href={`./toolbar-icons.svg#tool-${name}`} />
  </svg>;
}

export function Toolbar({ state }: ToolbarProps) {
  const currentTool = state.activeTool;
  const activeSpread = stateManager.getActiveSpread();
  const selectedEl = state.selectedElementId
    ? activeSpread.elements.find((e) => e.id === state.selectedElementId)
    : null;
  const fillColor = (selectedEl?.type === 'text' ? selectedEl.backgroundColor
    : selectedEl?.type === 'shape' || selectedEl?.type === 'path' ? selectedEl.fillColor : undefined) || '#ffffff';
  const strokeColor = (selectedEl && ('borderColor' in selectedEl ? selectedEl.borderColor : selectedEl.strokeColor)) || '#111111';

  return (
    <aside className="toolbar-left">
      <button
        className={`tool-btn ${currentTool === 'select' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('select')}
        title="Selection Tool (V)"
      >
        <ToolIcon name="select" />
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
        <ToolIcon name="frame" />
      </button>

      <button
        className={`tool-btn ${currentTool === 'table' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('table')}
        title="Table Tool (B / Shift+T)"
      >
        <ToolIcon name="table" />
      </button>

      <button
        className={`tool-btn ${currentTool === 'pen' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('pen')}
        title="Pen Tool (P)"
      >
        <ToolIcon name="pen" />
      </button>

      <button
        className={`tool-btn ${currentTool === 'pencil' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('pencil')}
        title="Pencil / Freehand Stylus Tool (N)"
      >
        <ToolIcon name="pencil" />
      </button>

      <button
        className={`tool-btn ${currentTool === 'shape-rect' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('shape-rect')}
        title="Rectangle Tool (M)"
      >
        <ToolIcon name="rectangle" />
      </button>

      <button
        className={`tool-btn ${currentTool === 'shape-ellipse' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('shape-ellipse')}
        title="Ellipse / Circle Tool (O)"
      >
        <ToolIcon name="ellipse" />
      </button>

      <button
        className={`tool-btn ${currentTool === 'shape-line' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('shape-line')}
        title="Line Tool (L)"
      >
        <ToolIcon name="line" />
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
        <ToolIcon name="hand" />
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
              if (selectedEl?.type === 'text') {
                stateManager.updateElement(selectedEl.id, { backgroundColor: strokeColor, borderColor: fillColor });
              } else if (selectedEl?.type === 'shape' || selectedEl?.type === 'path') {
                stateManager.updateElement(selectedEl.id, { fillColor: strokeColor, strokeColor: fillColor });
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
