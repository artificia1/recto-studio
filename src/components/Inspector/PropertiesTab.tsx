import { useState, useEffect, useRef } from 'preact/hooks';
import { stateManager, numberToSuperscript } from '../../state';
import { fontManager } from '../../fontManager';
import { PAGE_PRESETS, ProjectState, CanvasElement, TextElement, ImageElement, ShapeElement, TableElement, ParagraphStyle, VectorPathElement } from '../../types';
import { MathInput } from '../common/MathInput';
import { getAllFreeToneColors } from '../../engine/spotColors';
import { shapeToPath } from '../../engine/vectorPath';
import { lazy, Suspense } from 'preact/compat';
const TableInspector = lazy(() => import('./TableInspector'));
const TextInspector = lazy(() => import('./TextInspector'));
const TextWrapInspector = lazy(() => import('./TextWrapInspector'));
const GradientInspector = lazy(() => import('./GradientInspector'));

interface PropertiesTabProps {
  state: ProjectState;
}

export function PropertiesTab({ state }: PropertiesTabProps) {
  const [spacing, setSpacing] = useState(4.5);
  const [arrangeError, setArrangeError] = useState('');
  const runArrangement = (action: () => void) => {
    try { action(); setArrangeError(''); } catch (error) { setArrangeError(error instanceof Error ? error.message : String(error)); }
  };
  const spread = stateManager.getActiveSpread();
  const selectedIds = state.selectedElementIds && state.selectedElementIds.length > 0
    ? state.selectedElementIds
    : (state.selectedElementId ? [state.selectedElementId] : []);
  const selectedElements = spread.elements.filter((el) => selectedIds.includes(el.id));



  if (selectedElements.length === 0) {
    return (
      <div className="empty-inspector">
        <div className="empty-icon"></div>
        <div className="empty-title">No Element Selected</div>
        <p className="empty-desc">
          Click any text frame, image, or shape on the spread to inspect its typography and geometry. Press <kbd>T</kbd> to draw text or <kbd>F</kbd> for an image frame. Drag across the spread to marquee-select multiple objects.
        </p>

        <div className="doc-summary-card">
          <div className="card-title">DOCUMENT SUMMARY</div>
          <div className="summary-row">
            <span>Page Preset:</span>
            <b>{PAGE_PRESETS[state.settings.preset]?.name || 'Custom'}</b>
          </div>
          <div className="summary-row">
            <span>Trim Dimensions:</span>
            <b>{state.settings.widthMm} × {state.settings.heightMm} mm</b>
          </div>
          <div className="summary-row">
            <span>Facing Pages:</span>
            <b>{state.settings.facingPages ? 'Yes (Spreads)' : 'No'}</b>
          </div>
          <div className="summary-row">
            <span>Bleed Allowance:</span>
            <b>{state.settings.bleedMm} mm</b>
          </div>
          <div className="summary-row">
            <span>Column Grid:</span>
            <b>{state.settings.columnCount} cols ({state.settings.columnGutterMm}mm gutter)</b>
          </div>
        </div>
      </div>
    );
  }

  // Multi-element selection mode
  if (selectedElements.length > 1) {
    const allLocked = selectedElements.every((el) => el.locked);
    return (
      <div className="properties-tab-root">
        <div className="inspector-section">
          <div className="multi-sel-header">
            <div className="section-header" style={{ marginBottom: 0 }}>
              SELECTION ({selectedElements.length} ITEMS)
            </div>
            <button
              className={`lock-btn ${allLocked ? 'locked' : ''}`}
              onClick={() => stateManager.toggleLock(selectedIds)}
              title="Toggle Lock for all selected items (Ctrl+L)"
            >
              {allLocked ? 'Unlock' : 'Lock'}
            </button>
          </div>

          <div className="section-subtitle">
            Publishing alignment and distribution across active spread.
          </div>

          <div className="section-header">ALIGN OBJECTS</div>
          <div className="alignment-grid">
            <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.alignElements('left'))} title="Align Left">⇤ Left</button>
            <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.alignElements('center'))} title="Align Center">↔ Center</button>
            <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.alignElements('right'))} title="Align Right">⇥ Right</button>
            <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.alignElements('top'))} title="Align Top">↥ Top</button>
            <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.alignElements('middle'))} title="Align Middle">↕ Middle</button>
            <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.alignElements('bottom'))} title="Align Bottom">↧ Bottom</button>
          </div>

          {selectedElements.length >= 3 && (
            <>
              <div className="section-header">DISTRIBUTE SPACING</div>
              <div className="distribution-grid">
                <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.distributeElements('horizontal'))} title="Distribute Horizontally">
                  ⫴ Horiz. Even
                </button>
                <button className="align-tool-btn" onClick={() => runArrangement(() => stateManager.distributeElements('vertical'))} title="Distribute Vertically">
                  ⩕ Vert. Even
                </button>
              </div>
            </>
          )}

          <label>Exact spacing (mm)<input aria-label="Exact spacing (mm)" type="number" min={0} max={2500} step={0.1} value={spacing} onInput={event => setSpacing(Number(event.currentTarget.value))}/></label>
          <div className="publication-actions">
            <button className="sm-btn" onClick={() => runArrangement(() => stateManager.distributeElements('horizontal', spacing))}>Set horizontal gap</button>
            <button className="sm-btn" onClick={() => runArrangement(() => stateManager.distributeElements('vertical', spacing))}>Set vertical gap</button>
            <button className="sm-btn" onClick={() => runArrangement(() => stateManager.groupSelection())}>Group objects</button>
            <button className="sm-btn" onClick={() => runArrangement(() => stateManager.ungroupSelection())}>Ungroup objects</button>
          </div>
          {arrangeError && <p role="alert">{arrangeError}</p>}
          <div className="section-header" style={{ marginTop: '12px' }}>GROUP ACTIONS</div>
          <div className="btn-group-sm" style={{ marginTop: '8px' }}>
            <button
              className="sm-btn danger-btn"
              onClick={() => stateManager.deleteSelectedElements()}
              title="Delete all unlocked elements in selection"
            >
              Delete All
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Single element selection
  const selectedEl = selectedElements[0];
  return (
    <div className="properties-tab-root">
      <div className="inspector-section">
        <div className="multi-sel-header">
          <div className="section-header" style={{ marginBottom: 0 }}>GEOMETRY & TRANSFORM</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className={`lock-btn ${selectedEl.editorialOnly ? 'locked' : ''}`}
              onClick={() => stateManager.toggleEditorialLock([selectedEl.id])}
              style={{
                backgroundColor: selectedEl.editorialOnly ? '#7e22ce' : undefined,
                color: selectedEl.editorialOnly ? '#ffffff' : undefined,
              }}
              title={selectedEl.editorialOnly ? 'Unlock Editorial Frame (Ctrl+Alt+L)' : 'Lock Frame Geometry for Copywriters (Ctrl+Alt+L)'}
            >
              {selectedEl.editorialOnly ? 'Editorial: Locked' : 'Editorial Lock'}
            </button>
            <button
              className={`lock-btn ${selectedEl.locked ? 'locked' : ''}`}
              onClick={() => stateManager.toggleLock([selectedEl.id])}
              title={selectedEl.locked ? 'Click to Unlock (Ctrl+L)' : 'Click to Lock (Ctrl+L)'}
            >
              {selectedEl.locked ? 'Unlock' : 'Lock'}
            </button>
          </div>
        </div>

        {selectedEl.editorialOnly && (
          <div className="lock-banner" style={{ background: '#581c87', borderColor: '#a855f7' }}>
            <span>Editorial Lock: Copywriters can edit text, layout is protected</span>
            <button
              className="sm-btn"
              onClick={() => stateManager.toggleEditorialLock([selectedEl.id])}
            >
              Unlock
            </button>
          </div>
        )}

        {selectedEl.locked && (
          <div className="lock-banner">
            <span>Element is locked</span>
            <button
              className="sm-btn"
              onClick={() => stateManager.toggleLock([selectedEl.id])}
            >
              Unlock
            </button>
          </div>
        )}

        {selectedEl.isOverridden && (
          <div
            className="override-master-banner"
            style={{
              background: 'rgba(13, 153, 255, 0.12)',
              border: '1px solid #0d99ff',
              borderRadius: '4px',
              padding: '6px 8px',
              marginBottom: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              color: '#0d99ff',
            }}
          >
            <span>Overridden Master Item</span>
            <button
              className="sm-btn"
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                background: '#222',
                border: '1px solid #444',
                color: '#fff',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
              onClick={() => {
                const spread = stateManager.getActiveSpread();
                if (selectedEl.masterSourceId) {
                  stateManager.restoreMasterElement(spread.id, selectedEl.masterSourceId);
                }
              }}
              title="Restore this frame to inherit dynamically from Master Spread"
            >
              Restore to Master
            </button>
          </div>
        )}

        <label className="full-label">Reading order (EPUB)<input type="number" min={1} step={1} value={selectedEl.readingOrder ?? ''} placeholder="Automatic by position"
          onChange={event => stateManager.updateElement(selectedEl.id, { readingOrder: event.currentTarget.value ? Math.max(1, Number(event.currentTarget.value)) : undefined })}/></label>
        <div className="input-grid-2">
          <label>
            X:
            <MathInput
              value={selectedEl.x}
              disabled={selectedEl.locked}
              step={1}
              onChange={(val) => stateManager.updateElement(selectedEl.id, { x: val })}
            />
            mm
          </label>
          <label>
            Y:
            <MathInput
              value={selectedEl.y}
              disabled={selectedEl.locked}
              step={1}
              onChange={(val) => stateManager.updateElement(selectedEl.id, { y: val })}
            />
            mm
          </label>
          <label>
            W:
            <MathInput
              value={selectedEl.width}
              disabled={selectedEl.locked}
              step={1}
              min={5}
              onChange={(val) => stateManager.updateElement(selectedEl.id, { width: Math.max(5, val) })}
            />
            mm
          </label>
          <label>
            H:
            <MathInput
              value={selectedEl.height}
              disabled={selectedEl.locked}
              step={1}
              min={5}
              onChange={(val) => stateManager.updateElement(selectedEl.id, { height: Math.max(5, val) })}
            />
            mm
          </label>
        </div>
        <div className="input-grid-2" style={{ marginTop: '8px' }}>
          <label>Object blend<select aria-label="Object blend" value={selectedEl.blendMode || 'normal'} disabled={selectedEl.locked} onChange={event => stateManager.updateElement(selectedEl.id, { blendMode: event.currentTarget.value as 'normal' | 'multiply' | 'screen' | 'overlay' })}>
            <option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option>
          </select></label>
          <label>
            Opacity:
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              disabled={selectedEl.locked}
              value={selectedEl.opacity}
              onInput={(e) =>
                stateManager.updateElement(selectedEl.id, {
                  opacity: Number((e.target as HTMLInputElement).value),
                })}
            />
          </label>
          <div className="btn-group-sm">
            <button
              className="sm-btn"
              disabled={selectedEl.locked}
              onClick={() => stateManager.changeElementOrder(selectedEl.id, 'front')}
              title="Bring to Front"
            >
              ↑ Front
            </button>
            <button
              className="sm-btn"
              disabled={selectedEl.locked}
              onClick={() => stateManager.changeElementOrder(selectedEl.id, 'back')}
              title="Send to Back"
            >
              ↓ Back
            </button>
            <button
              className="sm-btn danger-btn"
              disabled={selectedEl.locked}
              onClick={() => stateManager.deleteElement(selectedEl.id)}
              title="Delete Element"
            >
              Delete
            </button>
          </div>
        </div>

        <div style={{ marginTop: '8px', padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
            <span>Drop Shadow</span>
            <input
              type="checkbox"
              checked={Boolean(selectedEl.shadow)}
              onChange={(e) =>
                stateManager.updateElement(selectedEl.id, {
                  shadow: (e.target as HTMLInputElement).checked
                    ? { color: 'rgba(0, 0, 0, 0.4)', blurMm: 3, offsetX: 1.5, offsetY: 2 }
                    : undefined,
                })
              }
            />
          </label>
          {selectedEl.shadow && (
            <div className="input-grid-2" style={{ marginTop: '6px' }}>
              <label>
                Blur:
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={selectedEl.shadow.blurMm || 3}
                  onInput={(e) =>
                    stateManager.updateElement(selectedEl.id, {
                      shadow: { ...selectedEl.shadow!, blurMm: parseFloat((e.target as HTMLInputElement).value) || 3 },
                    })
                  }
                />
                mm
              </label>
              <label>
                Offset:
                <input
                  type="number"
                  min={-20}
                  max={20}
                  value={selectedEl.shadow.offsetY || 2}
                  onInput={(e) => {
                    const off = parseFloat((e.target as HTMLInputElement).value) || 2;
                    stateManager.updateElement(selectedEl.id, {
                      shadow: { ...selectedEl.shadow!, offsetX: off * 0.75, offsetY: off },
                    });
                  }}
                />
                mm
              </label>
            </div>
          )}
        </div>

        {/* Anchored Object Status */}
        <div style={{ marginTop: '8px', padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 600 }}>
            <span>Anchored Object</span>
            {selectedEl.anchor ? (
              <button
                type="button"
                className="sm-btn danger-btn"
                style={{ fontSize: '10px', padding: '1px 6px' }}
                onClick={() => stateManager.unanchorElement(selectedEl.id)}
              >
                Release Anchor
              </button>
            ) : (
              <span style={{ fontSize: '10px', color: '#888' }}>Unanchored</span>
            )}
          </div>
          {selectedEl.anchor && (
            <div style={{ fontSize: '10px', color: '#0d99ff', marginTop: '4px' }}>
              Anchored to Frame: {selectedEl.anchor.parentTextId}
            </div>
          )}
        </div>

        {/* Object Style Selector */}
        <div style={{ marginTop: '8px' }}>
          <label className="full-label" style={{ marginBottom: '4px', fontSize: '11px', fontWeight: 600 }}>
            Object Style:
            <select
              value={selectedEl.objectStyleId || ''}
              onChange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                if (val) {
                  stateManager.applyObjectStyle(selectedEl.id, val);
                } else {
                  stateManager.updateElement(selectedEl.id, { objectStyleId: undefined });
                }
              }}
              style={{ width: '100%', marginTop: '2px', fontSize: '11px' }}
            >
              <option value="">[None] / Custom</option>
              {(state.objectStyles || []).map((os) => (
                <option key={os.id} value={os.id}>
                  {os.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Interactive PDF Form Field */}
        <div style={{ marginTop: '8px', padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
            <span>AcroForm Interactive Field</span>
            <input
              type="checkbox"
              checked={Boolean(selectedEl.interactiveField)}
              onChange={(e) => {
                const checked = (e.target as HTMLInputElement).checked;
                stateManager.updateElement(selectedEl.id, {
                  interactiveField: checked
                    ? { type: 'text', fieldName: `field_${selectedEl.id.replace(/[^a-zA-Z0-9]/g, '_')}` }
                    : undefined,
                });
              }}
            />
          </label>
          {selectedEl.interactiveField && (
            <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <label>
                  Type:
                  <select
                    value={selectedEl.interactiveField.type}
                    onChange={(e) => {
                      stateManager.updateElement(selectedEl.id, {
                        interactiveField: {
                          ...selectedEl.interactiveField!,
                          type: (e.target as HTMLSelectElement).value as any,
                        },
                      });
                    }}
                    style={{ fontSize: '10px', padding: '2px' }}
                  >
                    <option value="text">Text Field</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="button">Button</option>
                  </select>
                </label>
                <label>
                  Field Name:
                  <input
                    type="text"
                    value={selectedEl.interactiveField.fieldName}
                    onChange={(e) => {
                      stateManager.updateElement(selectedEl.id, {
                        interactiveField: {
                          ...selectedEl.interactiveField!,
                          fieldName: (e.target as HTMLInputElement).value,
                        },
                      });
                    }}
                    style={{ fontSize: '10px', padding: '2px' }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedEl.type === 'text' && (
        <Suspense fallback={<p role="status">Loading text controls…</p>}><TextInspector element={selectedEl as TextElement} styles={state.paragraphStyles} state={state} /></Suspense>
      )}
      {selectedEl.type === 'image' && <ImageInspector element={selectedEl as ImageElement} />}
      {selectedEl.type === 'shape' && <ShapeInspector element={selectedEl as ShapeElement} />}
      {selectedEl.type === 'shape' && <div className="inspector-section"><button className="sm-btn"
        disabled={selectedEl.locked || !!selectedEl.spotColor || !!state.layers.find(layer => layer.id === selectedEl.layerId)?.locked}
        onClick={() => stateManager.updateElement(selectedEl.id, shapeToPath(selectedEl))}>Convert to editable path</button></div>}
      {selectedEl.type === 'table' && <Suspense fallback={<p role="status">Loading table controls…</p>}><TableInspector element={selectedEl as TableElement} /></Suspense>}
      {selectedEl.type === 'path' && <VectorPathInspector element={selectedEl as VectorPathElement} />}
      {((selectedEl.type === 'shape' && selectedEl.shapeKind !== 'line') || (selectedEl.type === 'path' && selectedEl.closed)) &&
        <Suspense fallback={null}><GradientInspector key={selectedEl.id} element={selectedEl}
          disabled={selectedEl.locked || !!selectedEl.spotColor || !!state.layers.find(layer => layer.id === selectedEl.layerId)?.locked} /></Suspense>}
      <Suspense fallback={<p role="status">Loading wrap controls…</p>}><TextWrapInspector element={selectedEl} /></Suspense>
    </div>
  );
}


function ImageInspector({ element }: { element: ImageElement }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      const isPsd = file.name.toLowerCase().endsWith('.psd') || file.name.toLowerCase().endsWith('.psb');
      if (isPsd) {
        const reader = new FileReader();
        reader.onload = (re) => {
          if (re.target?.result instanceof ArrayBuffer) {
            stateManager.loadPsdForElement(element.id, re.target.result, file.name);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = async (re) => {
          if (typeof re.target?.result === 'string') {
            await stateManager.registerImageAsset(element.id, re.target.result, file.name);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div className="inspector-section">
      <div className="section-header">{element.equation ? 'EQUATION' : 'IMAGE FRAME'}</div>
      {element.equation && <button className="action-btn-primary" style={{ width: '100%', marginBottom: '8px' }}
        disabled={element.locked} onClick={() => window.dispatchEvent(new Event('recto:edit-equation'))}>Edit equation…</button>}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 6px',
          background: '#252526',
          borderRadius: '3px',
          marginBottom: '8px',
          fontSize: '10px',
          color: '#888',
        }}
      >
        <span>{element.equation ? 'Math artwork:' : 'Memory Pipeline:'}</span>
        <span style={{ color: '#0d99ff', fontWeight: 600 }}>{element.equation ? 'Scalable vector SVG' : '72 DPI Proxy · 300 DPI Stream'}</span>
      </div>
      <button
        className="action-btn-primary"
        style={{ width: '100%', marginBottom: '8px' }}
        onClick={() => fileInputRef.current?.click()}
      >
        {element.src ? (element.isPsd ? 'Replace PSD File' : 'Replace Photo') : 'Upload Photo or PSD'}
      </button>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*,.psd,.psb"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {element.isPsd && element.psdLayers && element.psdLayers.length > 0 && (
        <div
          className="psd-layers-box"
          style={{
            marginTop: '8px',
            marginBottom: '10px',
            padding: '8px',
            background: 'var(--panel-bg-dark, rgba(0,0,0,0.25))',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Photoshop Layers ({element.psdLayers.length})
            </span>
            <span style={{ fontSize: '9px', color: '#0d99ff', fontWeight: 600 }}>Active PSD</span>
          </div>
          <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {element.psdLayers.map((l) => (
              <label
                key={l.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: '3px',
                }}
              >
                <input
                  type="checkbox"
                  checked={l.visible}
                  onChange={(e) =>
                    stateManager.togglePsdLayer(element.id, l.id, (e.target as HTMLInputElement).checked)
                  }
                />
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    opacity: l.visible ? 1 : 0.45,
                  }}
                >
                  {l.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="full-label" style={{ marginTop: '8px' }}>
        Fitting Mode:
        <select
          value={element.fitMode || 'fill'}
          onChange={(e) =>
            stateManager.applyImageFitMode(
              (e.target as HTMLSelectElement).value as any,
              element.id
            )
          }
        >
          <option value="fill">Fill Frame Proportionally (Ctrl+Alt+Shift+C)</option>
          <option value="fit">Fit Content Proportionally (Ctrl+Alt+Shift+E)</option>
          <option value="frameToContent">Fit Frame to Content (Ctrl+Alt+C)</option>
          <option value="contentToFrame">Fit Content to Frame (Ctrl+Alt+E)</option>
          <option value="center">Center Content (Ctrl+Shift+E)</option>
        </select>
      </label>

      <label className="full-label" style={{ marginTop: '8px' }}>
        Alt Text (Accessibility):
        <input
          type="text"
          placeholder="Image description for accessible content..."
          value={element.altText || ''}
          onInput={(e) =>
            stateManager.updateElement(element.id, {
              altText: (e.target as HTMLInputElement).value,
            })
          }
        />
      </label>

      {element.fitMode === 'fill' && <div className="publication-panel"><strong>Image focal point</strong><p>Keep the chosen subject near the frame’s center while cropping.</p>
        {(['x', 'y'] as const).map(axis => <label key={axis}>{axis === 'x' ? 'Horizontal' : 'Vertical'} ({Math.round((element.focalPoint?.[axis] ?? 0.5) * 100)}%)
          <input aria-label={`Image focal ${axis}`} type="range" min={0} max={1} step={0.01} value={element.focalPoint?.[axis] ?? 0.5} onChange={event => stateManager.updateElement(element.id, { focalPoint: { x: element.focalPoint?.x ?? 0.5, y: element.focalPoint?.y ?? 0.5, [axis]: Number(event.currentTarget.value) } })}/>
        </label>)}
        <button className="sm-btn" onClick={() => stateManager.updateElement(element.id, { focalPoint: { x: 0.5, y: 0.5 } })}>Center focal point</button>
      </div>}
      <label style={{ display: 'flex', gap: '6px', marginTop: '8px' }}><input type="checkbox" checked={!!element.decorative}
        onChange={event => stateManager.updateElement(element.id, { decorative: event.currentTarget.checked })}/> Decorative image (empty alternative text in EPUB)</label>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Border:
          <input
            type="number"
            value={element.borderWidthMm}
            min={0}
            max={10}
            step={0.2}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                borderWidthMm: parseFloat((e.target as HTMLInputElement).value) || 0,
              })}
          />
          mm
        </label>
        <label>
          Border Color:
          <input
            type="color"
            value={element.borderColor || '#111111'}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                borderColor: (e.target as HTMLInputElement).value,
              })}
          />
        </label>
      </div>
    </div>
  );
}

function ShapeInspector({ element }: { element: ShapeElement }) {
  return (
    <div className="inspector-section">
      <div className="section-header">SHAPE & STROKE</div>
      <div className="input-grid-2">
        <label>
          Fill Color:
          <input
            type="color"
            value={element.fillColor || '#e5e5e5'}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                fillColor: (e.target as HTMLInputElement).value, fillGradient: undefined,
              })}
          />
        </label>
        <label>
          Stroke Color:
          <input
            type="color"
            value={element.strokeColor || '#111111'}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                strokeColor: (e.target as HTMLInputElement).value,
              })}
          />
        </label>
      </div>
      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Stroke Width:
          <input
            type="number"
            value={element.strokeWidthMm}
            min={0}
            max={10}
            step={0.2}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                strokeWidthMm: parseFloat((e.target as HTMLInputElement).value) || 0,
              })}
          />
          mm
        </label>
        <label>
          Stroke Style:
          <select
            value={element.strokeDash}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                strokeDash: (e.target as HTMLSelectElement).value as any,
              })}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
        </label>
      </div>
    </div>
  );
}


function VectorPathInspector({ element }: { element: VectorPathElement }) {
  const textOnPath = element.textOnPath || {
    text: '',
    fontSizePt: 14,
    fontFamily: 'Playfair Display, serif',
    color: '#111111',
    align: 'left' as const,
    startOffsetMm: 0,
  };

  return (
    <div className="inspector-section">
      <div className="section-header">VECTOR PATH</div>
      <div className="input-grid-2">
        <label>
          Stroke Width:
          <input
            type="number"
            min={0}
            max={20}
            step={0.1}
            value={element.strokeWidthMm}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                strokeWidthMm: parseFloat((e.target as HTMLInputElement).value) || 0,
              })
            }
          />
          mm
        </label>
        <label>
          Stroke Color:
          <input
            type="color"
            value={element.strokeColor || '#111111'}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                strokeColor: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Fill Color:
          <input
            type="color"
            value={element.fillColor && element.fillColor !== 'transparent' ? element.fillColor : '#ffffff'}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                fillColor: (e.target as HTMLInputElement).value, fillGradient: undefined,
              })
            }
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={!element.fillGradient && (element.fillColor === 'transparent' || !element.fillColor)}
            disabled={element.locked}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                fillColor: (e.target as HTMLInputElement).checked ? 'transparent' : '#e5e5e5', fillGradient: undefined,
              })
            }
          />
          Transparent Fill
        </label>
      </div>

      <div className="input-field" style={{ marginTop: '8px' }}>
        <label>
          OpenSpot / FreeTone Spot Ink:
          <select
            value={element.spotColor || ''}
            disabled={element.locked}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              stateManager.updateElement(element.id, {
                spotColor: val || undefined,
              });
            }}
          >
            <option value="">None (Standard Process CMYK / RGB)</option>
            {getAllFreeToneColors().map((spot) => (
              <option key={spot.name} value={spot.name}>
                {spot.name} ({spot.category})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Stroke Cap:
          <select
            value={element.strokeCap || 'round'}
            disabled={element.locked}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                strokeCap: (e.target as HTMLSelectElement).value as any,
              })
            }
          >
            <option value="round">Round</option>
            <option value="butt">Butt</option>
            <option value="square">Square</option>
          </select>
        </label>
        <label>
          Stroke Join:
          <select
            value={element.strokeJoin || 'round'}
            disabled={element.locked}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                strokeJoin: (e.target as HTMLSelectElement).value as any,
              })
            }
          >
            <option value="round">Round</option>
            <option value="miter">Miter</option>
            <option value="bevel">Bevel</option>
          </select>
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={element.closed}
            disabled={element.locked}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                closed: (e.target as HTMLInputElement).checked,
              })
            }
          />
          Closed Path
        </label>
        <label>
          Style:
          <select
            value={element.strokeDash || 'solid'}
            disabled={element.locked}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                strokeDash: (e.target as HTMLSelectElement).value as 'solid' | 'dashed',
              })
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
        Anchor Nodes: {element.nodes.length} points
      </div>

      <div className="section-header" style={{ marginTop: '14px' }}>
        TEXT-ON-A-PATH
      </div>
      <label className="full-label">
        Curved Text:
        <input
          type="text"
          placeholder="e.g. THE INDEPENDENT CHRONICLE"
          value={element.textOnPath?.text || ''}
          disabled={element.locked}
          onInput={(e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val.trim()) {
              stateManager.updateElement(element.id, {
                textOnPath: {
                  ...textOnPath,
                  text: val,
                },
              });
            } else {
              stateManager.updateElement(element.id, {
                textOnPath: undefined,
              });
            }
          }}
        />
      </label>

      {element.textOnPath?.text && (
        <>
          <div className="input-grid-2" style={{ marginTop: '8px' }}>
            <label>
              Font Size:
              <input
                type="number"
                min={6}
                max={72}
                step={1}
                value={textOnPath.fontSizePt}
                disabled={element.locked}
                onInput={(e) =>
                  stateManager.updateElement(element.id, {
                    textOnPath: {
                      ...textOnPath,
                      fontSizePt: parseFloat((e.target as HTMLInputElement).value) || 12,
                    },
                  })
                }
              />
              pt
            </label>
            <label>
              Text Color:
              <input
                type="color"
                value={textOnPath.color || '#111111'}
                disabled={element.locked}
                onInput={(e) =>
                  stateManager.updateElement(element.id, {
                    textOnPath: {
                      ...textOnPath,
                      color: (e.target as HTMLInputElement).value,
                    },
                  })
                }
              />
            </label>
          </div>

          <div className="input-grid-2" style={{ marginTop: '8px' }}>
            <label>
              Alignment:
              <select
                value={textOnPath.align}
                disabled={element.locked}
                onChange={(e) =>
                  stateManager.updateElement(element.id, {
                    textOnPath: {
                      ...textOnPath,
                      align: (e.target as HTMLSelectElement).value as any,
                    },
                  })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label>
              Start Offset:
              <input
                type="number"
                step={1}
                value={textOnPath.startOffsetMm}
                disabled={element.locked}
                onInput={(e) =>
                  stateManager.updateElement(element.id, {
                    textOnPath: {
                      ...textOnPath,
                      startOffsetMm: parseFloat((e.target as HTMLInputElement).value) || 0,
                    },
                  })
                }
              />
              mm
            </label>
          </div>
        </>
      )}
    </div>
  );
}
