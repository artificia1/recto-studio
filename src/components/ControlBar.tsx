/**
 * Papercut Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { ProjectState, TextElement, ImageElement, ShapeElement, TableElement, VectorPathElement, ImageFitMode } from '../types';
import { stateManager } from '../state';

interface ControlBarProps {
  state: ProjectState;
}

export function ControlBar({ state }: ControlBarProps) {
  const activeSpread = stateManager.getActiveSpread();
  const selectedId = state.selectedElementId;
  const selectedEl = selectedId ? activeSpread.elements.find((el) => el.id === selectedId) : null;

  // Render Image Controls
  if (selectedEl && selectedEl.type === 'image') {
    const img = selectedEl as ImageElement;
    return (
      <div className="control-bar" role="toolbar" aria-label="Contextual Image Controls">
        <span className="control-bar-pill pill-active">Image Frame</span>
        
        <div className="control-bar-group">
          <span className="control-bar-label">X:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '56px' }}
            value={Math.round(img.x * 10) / 10}
            step="0.5"
            onInput={(e) =>
              stateManager.updateElement(img.id, { x: parseFloat((e.target as HTMLInputElement).value) || 0 })
            }
          />
          <span className="control-bar-label">mm</span>
        </div>

        <div className="control-bar-group">
          <span className="control-bar-label">Y:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '56px' }}
            value={Math.round(img.y * 10) / 10}
            step="0.5"
            onInput={(e) =>
              stateManager.updateElement(img.id, { y: parseFloat((e.target as HTMLInputElement).value) || 0 })
            }
          />
          <span className="control-bar-label">mm</span>
        </div>

        <div className="control-bar-divider" />

        <div className="control-bar-group">
          <span className="control-bar-label">W:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '56px' }}
            value={Math.round(img.width * 10) / 10}
            step="0.5"
            min="1"
            onInput={(e) =>
              stateManager.updateElement(img.id, { width: Math.max(1, parseFloat((e.target as HTMLInputElement).value) || 1) })
            }
          />
          <span className="control-bar-label">mm</span>
        </div>

        <div className="control-bar-group">
          <span className="control-bar-label">H:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '56px' }}
            value={Math.round(img.height * 10) / 10}
            step="0.5"
            min="1"
            onInput={(e) =>
              stateManager.updateElement(img.id, { height: Math.max(1, parseFloat((e.target as HTMLInputElement).value) || 1) })
            }
          />
          <span className="control-bar-label">mm</span>
        </div>

        <div className="control-bar-group">
          <span className="control-bar-label">∠:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '48px' }}
            value={img.rotation || 0}
            step="1"
            onInput={(e) =>
              stateManager.updateElement(img.id, { rotation: parseFloat((e.target as HTMLInputElement).value) || 0 })
            }
          />
          <span className="control-bar-label">°</span>
        </div>

        <div className="control-bar-divider" />

        {/* 5 InDesign Fitting Mode Buttons */}
        <div className="control-bar-group" title="InDesign Frame Fitting Modes">
          <span className="control-bar-label" style={{ marginRight: '2px' }}>Fitting:</span>
          
          <button
            className={`control-bar-btn ${img.fitMode === 'fill' ? 'active' : ''}`}
            onClick={() => stateManager.applyImageFitMode('fill', img.id)}
            title="Fill Frame Proportionally (Ctrl+Alt+Shift+C)"
          >
            <span>⤢</span> Fill
          </button>

          <button
            className={`control-bar-btn ${img.fitMode === 'fit' ? 'active' : ''}`}
            onClick={() => stateManager.applyImageFitMode('fit', img.id)}
            title="Fit Content Proportionally (Ctrl+Alt+Shift+E)"
          >
            <span>⊡</span> Fit
          </button>

          <button
            className={`control-bar-btn ${img.fitMode === 'frameToContent' ? 'active' : ''}`}
            onClick={() => stateManager.applyImageFitMode('frameToContent', img.id)}
            title="Fit Frame to Content (Ctrl+Alt+C)"
          >
            <span>⊞</span> Frame→Content
          </button>

          <button
            className={`control-bar-btn ${img.fitMode === 'contentToFrame' || img.fitMode === 'stretch' ? 'active' : ''}`}
            onClick={() => stateManager.applyImageFitMode('contentToFrame', img.id)}
            title="Fit Content to Frame (Ctrl+Alt+E)"
          >
            <span>⤧</span> Stretch
          </button>

          <button
            className={`control-bar-btn ${img.fitMode === 'center' ? 'active' : ''}`}
            onClick={() => stateManager.applyImageFitMode('center', img.id)}
            title="Center Content (Ctrl+Shift+E)"
          >
            <span>⊹</span> Center
          </button>
        </div>
      </div>
    );
  }

  // Render Text Controls
  if (selectedEl && selectedEl.type === 'text') {
    const txt = selectedEl as TextElement;
    return (
      <div className="control-bar" role="toolbar" aria-label="Contextual Text Controls">
        <span className="control-bar-pill pill-active">Text Frame</span>

        <div className="control-bar-group">
          <select
            className="control-bar-select"
            value={txt.fontFamily}
            onChange={(e) =>
              stateManager.updateElement(txt.id, { fontFamily: (e.target as HTMLSelectElement).value })
            }
          >
            <option value="Inter, sans-serif">Inter</option>
            <option value="Merriweather, Georgia, serif">Merriweather</option>
            <option value="Playfair Display, Georgia, serif">Playfair Display</option>
            <option value="JetBrains Mono, monospace">JetBrains Mono</option>
            <option value="Space Grotesk, sans-serif">Space Grotesk</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="Helvetica, Arial, sans-serif">Helvetica</option>
          </select>
        </div>

        <div className="control-bar-divider" />

        <div className="control-bar-group">
          <span className="control-bar-label">Size:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '48px' }}
            value={txt.fontSizePt}
            min="4"
            max="144"
            step="0.5"
            onInput={(e) =>
              stateManager.updateElement(txt.id, { fontSizePt: Math.max(4, parseFloat((e.target as HTMLInputElement).value) || 12) })
            }
          />
          <span className="control-bar-label">pt</span>
        </div>

        <div className="control-bar-group">
          <span className="control-bar-label">Leading:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '48px' }}
            value={txt.lineHeight}
            min="0.5"
            max="3"
            step="0.05"
            onInput={(e) =>
              stateManager.updateElement(txt.id, { lineHeight: Math.max(0.5, parseFloat((e.target as HTMLInputElement).value) || 1.2) })
            }
          />
        </div>

        <div className="control-bar-group">
          <span className="control-bar-label">Tracking:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '48px' }}
            value={txt.letterSpacingPt || 0}
            step="0.1"
            onInput={(e) =>
              stateManager.updateElement(txt.id, { letterSpacingPt: parseFloat((e.target as HTMLInputElement).value) || 0 })
            }
          />
          <span className="control-bar-label">pt</span>
        </div>

        <div className="control-bar-divider" />

        {/* Alignment Buttons */}
        <div className="control-bar-group">
          <button
            className={`control-bar-btn ${txt.alignment === 'left' ? 'active' : ''}`}
            onClick={() => stateManager.updateElement(txt.id, { alignment: 'left' })}
            title="Align Left"
          >
            ⇤
          </button>
          <button
            className={`control-bar-btn ${txt.alignment === 'center' ? 'active' : ''}`}
            onClick={() => stateManager.updateElement(txt.id, { alignment: 'center' })}
            title="Align Center"
          >
            ↔
          </button>
          <button
            className={`control-bar-btn ${txt.alignment === 'right' ? 'active' : ''}`}
            onClick={() => stateManager.updateElement(txt.id, { alignment: 'right' })}
            title="Align Right"
          >
            ⇥
          </button>
          <button
            className={`control-bar-btn ${txt.alignment === 'justify' ? 'active' : ''}`}
            onClick={() => stateManager.updateElement(txt.id, { alignment: 'justify' })}
            title="Justify"
          >
            ⫶
          </button>
        </div>

        <div className="control-bar-divider" />

        <div className="control-bar-group">
          <span className="control-bar-label">Cols:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '40px' }}
            value={txt.columns || 1}
            min="1"
            max="6"
            onInput={(e) =>
              stateManager.updateElement(txt.id, { columns: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1) })
            }
          />
        </div>

        <div className="control-bar-group">
          <span className="control-bar-label">Gutter:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '44px' }}
            value={txt.columnGutterMm || 4}
            min="0"
            step="0.5"
            onInput={(e) =>
              stateManager.updateElement(txt.id, { columnGutterMm: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 4) })
            }
          />
          <span className="control-bar-label">mm</span>
        </div>

        <div className="control-bar-divider" />

        <div className="control-bar-group">
          <button
            className="control-bar-btn"
            onClick={() => {
              const note = prompt('Enter Footnote Reference Text:', 'Citation or footnote note');
              if (note !== null) {
                stateManager.insertFootnote(txt.id, note);
              }
            }}
            title="Insert Footnote (Anchors superscript note to this text frame)"
            style={{ fontWeight: 600, color: '#93c5fd' }}
          >
            ¹+ Footnote
          </button>
          {txt.columns > 1 && (
            <button
              className={`control-bar-btn ${txt.balanceColumns ? 'active' : ''}`}
              onClick={() => stateManager.updateElement(txt.id, { balanceColumns: !txt.balanceColumns })}
              title="Toggle Balance Columns (Equalize line counts across columns)"
            >
              ⚖ Balance
            </button>
          )}
          <button
            className="control-bar-btn"
            onClick={() => {
              const res = stateManager.copyfitTextFrame(txt.id);
              if (res.adjustments.length > 0) {
                alert(`Copyfit applied:\n• ${res.adjustments.join('\n• ')}`);
              } else {
                alert('Text frame is already copyfit cleanly.');
              }
            }}
            title="Auto Copyfit: bind orphan words & micro-adjust tracking to fit frame"
          >
            ✨ Copyfit
          </button>
        </div>
      </div>
    );
  }

  // Render Shape Controls
  if (selectedEl && selectedEl.type === 'shape') {
    const shp = selectedEl as ShapeElement;
    return (
      <div className="control-bar" role="toolbar" aria-label="Contextual Shape Controls">
        <span className="control-bar-pill pill-active">Shape ({shp.shapeKind})</span>
        <div className="control-bar-group">
          <span className="control-bar-label">W:</span>
          <span className="control-bar-val">{Math.round(shp.width)}mm</span>
          <span className="control-bar-label" style={{ marginLeft: '6px' }}>H:</span>
          <span className="control-bar-val">{Math.round(shp.height)}mm</span>
        </div>
        <div className="control-bar-divider" />
        <div className="control-bar-group">
          <span className="control-bar-label">Fill:</span>
          <input
            type="color"
            style={{ width: '22px', height: '20px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            value={shp.fillColor || '#cccccc'}
            onChange={(e) =>
              stateManager.updateElement(shp.id, { fillColor: (e.target as HTMLInputElement).value })
            }
          />
        </div>
        <div className="control-bar-group">
          <span className="control-bar-label">Stroke:</span>
          <input
            type="color"
            style={{ width: '22px', height: '20px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            value={shp.strokeColor || '#000000'}
            onChange={(e) =>
              stateManager.updateElement(shp.id, { strokeColor: (e.target as HTMLInputElement).value })
            }
          />
        </div>
        <div className="control-bar-group">
          <span className="control-bar-label">Weight:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '44px' }}
            value={shp.strokeWidthMm}
            min="0"
            step="0.2"
            onInput={(e) =>
              stateManager.updateElement(shp.id, { strokeWidthMm: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })
            }
          />
          <span className="control-bar-label">mm</span>
        </div>
      </div>
    );
  }

  // Render Table Controls
  if (selectedEl && selectedEl.type === 'table') {
    const tbl = selectedEl as TableElement;
    return (
      <div className="control-bar" role="toolbar" aria-label="Contextual Table Controls">
        <span className="control-bar-pill pill-active">Dynamic Table</span>
        <div className="control-bar-group">
          <span className="control-bar-label">Rows:</span>
          <span className="control-bar-val">{tbl.rows}</span>
          <span className="control-bar-label" style={{ marginLeft: '6px' }}>Cols:</span>
          <span className="control-bar-val">{tbl.cols}</span>
        </div>
        <div className="control-bar-divider" />
        <div className="control-bar-group">
          <span className="control-bar-label">Cell Padding:</span>
          <input
            type="number"
            className="control-bar-input"
            style={{ width: '44px' }}
            value={tbl.cellPaddingMm || 1.5}
            min="0"
            step="0.5"
            onInput={(e) =>
              stateManager.updateElement(tbl.id, { cellPaddingMm: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })
            }
          />
          <span className="control-bar-label">mm</span>
        </div>
      </div>
    );
  }

  // Render Path Controls
  if (selectedEl && selectedEl.type === 'path') {
    const path = selectedEl as VectorPathElement;
    return (
      <div className="control-bar" role="toolbar" aria-label="Contextual Path Controls">
        <span className="control-bar-pill pill-active">Vector Path</span>
        <div className="control-bar-group">
          <span className="control-bar-label">Nodes:</span>
          <span className="control-bar-val">{path.nodes.length}</span>
          <span className="control-bar-label" style={{ marginLeft: '6px' }}>State:</span>
          <span className="control-bar-val">{path.closed ? 'Closed' : 'Open'}</span>
        </div>
      </div>
    );
  }

  // Default: No Element Selected -> Show Document Geometry, Spread Count, Bleed & Margins
  const margins = state.settings.margins;
  return (
    <div className="control-bar" role="toolbar" aria-label="Document Overview Controls">
      <span className="control-bar-pill">Document</span>

      <div className="control-bar-group">
        <span className="control-bar-label">Page Size:</span>
        <span className="control-bar-val">
          {state.settings.preset} ({Math.round(state.settings.widthMm)} × {Math.round(state.settings.heightMm)} mm)
        </span>
      </div>

      <div className="control-bar-divider" />

      <div className="control-bar-group">
        <span className="control-bar-label">Spreads:</span>
        <span className="control-bar-val">
          {state.spreads.length} ({state.settings.facingPages ? 'Facing' : 'Single'})
        </span>
      </div>

      <div className="control-bar-divider" />

      <div className="control-bar-group">
        <span className="control-bar-label">Bleed:</span>
        <span className="control-bar-val">{state.settings.bleedMm} mm</span>
      </div>

      <div className="control-bar-divider" />

      <div className="control-bar-group">
        <span className="control-bar-label">Margins:</span>
        <span className="control-bar-val">
          T: {margins.topMm} · B: {margins.bottomMm} · In: {margins.insideMm} · Out: {margins.outsideMm} mm
        </span>
      </div>
    </div>
  );
}
