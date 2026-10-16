import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import { ProjectState, Layer } from '../../types';

interface LayersTabProps {
  state: ProjectState;
}

export function LayersTab({ state }: LayersTabProps) {
  const layers = stateManager.getLayers(); // Sorted top-to-bottom (order descending)
  const activeSpread = stateManager.getActiveSpread();
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  const selectedElements = (activeSpread?.elements || []).filter(el =>
    state.selectedElementIds && state.selectedElementIds.length > 0
      ? state.selectedElementIds.includes(el.id)
      : state.selectedElementId === el.id
  );

  const handleCreateLayer = () => {
    stateManager.createLayer();
  };

  const handleToggleVisible = (e: MouseEvent, layer: Layer) => {
    e.stopPropagation();
    stateManager.updateLayer(layer.id, { visible: !layer.visible });
  };

  const handleToggleLocked = (e: MouseEvent, layer: Layer) => {
    e.stopPropagation();
    stateManager.updateLayer(layer.id, { locked: !layer.locked });
  };

  const handleColorChange = (layer: Layer, colorHex: string) => {
    stateManager.updateLayer(layer.id, { colorHex });
  };

  const handleMoveUp = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    if (index <= 0) return;
    // In top-to-bottom list, moving 'up' in stack means increasing order
    const currentList = [...layers];
    const item = currentList[index];
    currentList.splice(index, 1);
    currentList.splice(index - 1, 0, item);
    // currentList is descending order (top to bottom).
    // Let's reassign orders from 0 at the bottom to N-1 at the top.
    const reversed = [...currentList].reverse();
    stateManager.reorderLayers(reversed.map(l => l.id));
  };

  const handleMoveDown = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    if (index >= layers.length - 1) return;
    const currentList = [...layers];
    const item = currentList[index];
    currentList.splice(index, 1);
    currentList.splice(index + 1, 0, item);
    const reversed = [...currentList].reverse();
    stateManager.reorderLayers(reversed.map(l => l.id));
  };

  const handleDelete = (e: MouseEvent, layerId: string) => {
    e.stopPropagation();
    if (layers.length <= 1) return;
    stateManager.deleteLayer(layerId);
  };

  const handleStartRename = (layer: Layer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  };

  const handleSaveRename = (layerId: string) => {
    if (editingName.trim()) {
      stateManager.updateLayer(layerId, { name: editingName.trim() });
    }
    setEditingLayerId(null);
  };

  const handleAssignSelectedToLayer = (layerId: string) => {
    for (const el of selectedElements) {
      stateManager.setElementLayer(el.id, layerId);
    }
  };

  // Pre-calculate count of elements per layer on active spread
  const elementCountByLayer: Record<string, number> = {};
  for (const el of activeSpread?.elements || []) {
    const lId = el.layerId || 'layer-1';
    elementCountByLayer[lId] = (elementCountByLayer[lId] || 0) + 1;
  }

  return (
    <div className="layers-panel" style={{ padding: '4px 0' }}>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Layers ({layers.length})
          </span>
        </div>
        <button
          className="btn-primary"
          style={{
            fontSize: '10px',
            padding: '3px 8px',
            cursor: 'pointer',
            borderRadius: '4px',
            fontWeight: 600,
          }}
          onClick={handleCreateLayer}
          title="Create New Layer"
        >
          + New Layer
        </button>
      </div>

      {/* Selected Element Quick Layer Assignment */}
      {selectedElements.length > 0 && (
        <div
          style={{
            marginBottom: '10px',
            padding: '8px',
            background: 'var(--bg-app)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            fontSize: '11px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Selected ({selectedElements.length}) Layer:
            </span>
            <select
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '3px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-panel)',
                color: 'var(--text-primary)',
              }}
              value={selectedElements[0]?.layerId || 'layer-1'}
              onChange={(e) => handleAssignSelectedToLayer((e.target as HTMLSelectElement).value)}
            >
              {layers.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Layers List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {layers.map((layer, index) => {
          const isActive = state.activeLayerId === layer.id;
          const count = elementCountByLayer[layer.id] || 0;
          const isEditing = editingLayerId === layer.id;

          return (
            <div
              key={layer.id}
              onClick={() => stateManager.setActiveLayer(layer.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: '5px',
                border: `1px solid ${isActive ? layer.colorHex : 'var(--border-color)'}`,
                background: isActive ? 'rgba(255, 255, 255, 0.04)' : 'var(--bg-panel)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
            >
              {/* Left Color Indicator Strip */}
              <div
                style={{
                  width: '8px',
                  height: '24px',
                  borderRadius: '2px',
                  backgroundColor: layer.colorHex,
                  flexShrink: 0,
                  position: 'relative',
                }}
                title={`Layer Color: ${layer.colorHex}`}
              >
                <input
                  type="color"
                  value={layer.colorHex}
                  onChange={(e) => handleColorChange(layer, (e.target as HTMLInputElement).value)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                  }}
                  title="Click to change layer color"
                />
              </div>

              {/* Visibility Eye Toggle */}
              <button
                onClick={(e) => handleToggleVisible(e, layer)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  fontSize: '12px',
                  color: layer.visible ? 'var(--text-primary)' : 'var(--text-muted, #666)',
                  opacity: layer.visible ? 1 : 0.4,
                  lineHeight: 1,
                }}
                title={layer.visible ? 'Hide Layer' : 'Show Layer'}
              >
                {layer.visible ? '◉' : '○'}
              </button>

              {/* Lock Toggle */}
              <button
                onClick={(e) => handleToggleLocked(e, layer)}
                style={{
                  background: layer.locked ? '#f59e0b' : 'transparent',
                  border: layer.locked ? '1px solid #f59e0b' : '1px solid var(--border-color)',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  padding: '2px 5px',
                  fontSize: '10px',
                  fontWeight: 600,
                  color: layer.locked ? '#111111' : 'var(--text-muted, #888)',
                  lineHeight: 1.2,
                }}
                title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
              >
                {layer.locked ? 'Unlock' : 'Lock'}
              </button>

              {/* Layer Name / Renaming */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingName}
                    autoFocus
                    onBlur={() => handleSaveRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(layer.id);
                      if (e.key === 'Escape') setEditingLayerId(null);
                    }}
                    onChange={(e) => setEditingName((e.target as HTMLInputElement).value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      fontSize: '11px',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      border: '1px solid var(--accent)',
                      background: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                    }}
                  />
                ) : (
                  <div
                    onDblClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(layer);
                    }}
                    style={{
                      fontSize: '11px',
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title="Double-click to rename"
                  >
                    {layer.name}
                  </div>
                )}
              </div>

              {/* Element count badge */}
              <span
                style={{
                  fontSize: '9px',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-app)',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  border: '1px solid var(--border-color)',
                  flexShrink: 0,
                }}
                title={`${count} element(s) on current spread`}
              >
                {count}
              </span>

              {/* Reordering Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexShrink: 0 }}>
                <button
                  onClick={(e) => handleMoveUp(e, index)}
                  disabled={index === 0}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: index === 0 ? 'default' : 'pointer',
                    padding: '0 2px',
                    fontSize: '8px',
                    lineHeight: 1,
                    opacity: index === 0 ? 0.2 : 0.8,
                    color: 'var(--text-primary)',
                  }}
                  title="Move Layer Up"
                >
                  ▲
                </button>
                <button
                  onClick={(e) => handleMoveDown(e, index)}
                  disabled={index === layers.length - 1}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: index === layers.length - 1 ? 'default' : 'pointer',
                    padding: '0 2px',
                    fontSize: '8px',
                    lineHeight: 1,
                    opacity: index === layers.length - 1 ? 0.2 : 0.8,
                    color: 'var(--text-primary)',
                  }}
                  title="Move Layer Down"
                >
                  ▼
                </button>
              </div>

              {/* Delete Layer button */}
              <button
                onClick={(e) => handleDelete(e, layer.id)}
                disabled={layers.length <= 1}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: layers.length <= 1 ? 'default' : 'pointer',
                  padding: '2px 4px',
                  fontSize: '11px',
                  opacity: layers.length <= 1 ? 0.2 : 0.6,
                  color: '#ef4444',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
                title={layers.length <= 1 ? 'Cannot delete only remaining layer' : 'Delete Layer'}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
