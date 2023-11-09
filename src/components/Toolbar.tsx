import { stateManager } from '../state';
import { ProjectState, ToolType } from '../types';

interface ToolbarProps {
  state: ProjectState;
}

export function Toolbar({ state }: ToolbarProps) {
  const currentTool = state.activeTool;

  const tools: { id: ToolType; label: string; title: string }[] = [
    { id: 'select', label: 'V', title: 'Selection Tool (V)' },
    { id: 'text', label: 'T', title: 'Type Tool (T)' },
    { id: 'frame', label: 'F', title: 'Rectangle Frame Tool (F)' },
    { id: 'table', label: '⊞', title: 'Table Tool (B)' },
    { id: 'pen', label: '✒', title: 'Pen Tool (P)' },
    { id: 'shape-rect', label: '▭', title: 'Rectangle Tool (M)' },
    { id: 'shape-ellipse', label: '○', title: 'Ellipse Tool (O)' },
    { id: 'shape-line', label: '╱', title: 'Line Tool (L)' },
  ];

  return (
    <aside className="toolbar-left">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={`tool-btn ${currentTool === tool.id ? 'active' : ''}`}
          onClick={() => stateManager.setTool(tool.id)}
          title={tool.title}
        >
          {tool.label}
        </button>
      ))}

      <div className="tool-divider"></div>

      <button
        className={`tool-btn ${currentTool === 'hand' ? 'active' : ''}`}
        onClick={() => stateManager.setTool('hand')}
        title="Hand Tool (H) or Spacebar drag"
      >
        ✋
      </button>

      <button
        className={`tool-btn ${!state.showGuides ? 'active' : ''}`}
        onClick={() => stateManager.toggleGuides()}
        title="Toggle Preview / Guides Mode (W)"
      >
        W
      </button>
    </aside>
  );
}
