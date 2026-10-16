import { useState, useEffect, useRef } from 'preact/hooks';
import { stateManager, numberToSuperscript } from '../../state';
import { fontManager } from '../../fontManager';
import { PAGE_PRESETS, ProjectState, CanvasElement, TextElement, ImageElement, ShapeElement, TableElement, TableCell, ParagraphStyle, VectorPathElement } from '../../types';
import { MathInput } from '../common/MathInput';

interface PropertiesTabProps {
  state: ProjectState;
}

export function PropertiesTab({ state }: PropertiesTabProps) {
  const spread = stateManager.getActiveSpread();
  const selectedIds = state.selectedElementIds && state.selectedElementIds.length > 0
    ? state.selectedElementIds
    : (state.selectedElementId ? [state.selectedElementId] : []);
  const selectedElements = spread.elements.filter((el) => selectedIds.includes(el.id));



  if (selectedElements.length === 0) {
    return (
      <div className="empty-inspector">
        <div className="empty-icon">❖</div>
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
            <button className="align-tool-btn" onClick={() => stateManager.alignElements('left')} title="Align Left">⇤ Left</button>
            <button className="align-tool-btn" onClick={() => stateManager.alignElements('center')} title="Align Center">↔ Center</button>
            <button className="align-tool-btn" onClick={() => stateManager.alignElements('right')} title="Align Right">⇥ Right</button>
            <button className="align-tool-btn" onClick={() => stateManager.alignElements('top')} title="Align Top">↥ Top</button>
            <button className="align-tool-btn" onClick={() => stateManager.alignElements('middle')} title="Align Middle">↕ Middle</button>
            <button className="align-tool-btn" onClick={() => stateManager.alignElements('bottom')} title="Align Bottom">↧ Bottom</button>
          </div>

          {selectedElements.length >= 3 && (
            <>
              <div className="section-header">DISTRIBUTE SPACING</div>
              <div className="distribution-grid">
                <button className="align-tool-btn" onClick={() => stateManager.distributeElements('horizontal')} title="Distribute Horizontally">
                  ⫴ Horiz. Even
                </button>
                <button className="align-tool-btn" onClick={() => stateManager.distributeElements('vertical')} title="Distribute Vertically">
                  ⩕ Vert. Even
                </button>
              </div>
            </>
          )}

          <div className="section-header" style={{ marginTop: '12px' }}>GROUP ACTIONS</div>
          <div className="btn-group-sm" style={{ marginTop: '8px' }}>
            <button
              className="sm-btn danger-btn"
              onClick={() => stateManager.deleteSelectedElements()}
              title="Delete all unlocked elements in selection"
            >
              ✕ Delete All
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
          <button
            className={`lock-btn ${selectedEl.locked ? 'locked' : ''}`}
            onClick={() => stateManager.toggleLock([selectedEl.id])}
            title={selectedEl.locked ? 'Click to Unlock (Ctrl+L)' : 'Click to Lock (Ctrl+L)'}
          >
            {selectedEl.locked ? 'Unlock' : 'Lock'}
          </button>
        </div>

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
          <label>
            Opacity:
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              disabled={selectedEl.locked}
              value={selectedEl.opacity}
              onInput={(e) =>
                stateManager.updateElement(selectedEl.id, {
                  opacity: parseFloat((e.target as HTMLInputElement).value) || 1,
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
              ✕ Delete
            </button>
          </div>
        </div>
      </div>

      {selectedEl.type === 'text' && (
        <TextInspector element={selectedEl as TextElement} styles={state.paragraphStyles} state={state} />
      )}
      {selectedEl.type === 'image' && <ImageInspector element={selectedEl as ImageElement} />}
      {selectedEl.type === 'shape' && <ShapeInspector element={selectedEl as ShapeElement} />}
      {selectedEl.type === 'table' && <TableInspector element={selectedEl as TableElement} />}
      {selectedEl.type === 'path' && <VectorPathInspector element={selectedEl as VectorPathElement} />}
      {(selectedEl.type === 'image' || selectedEl.type === 'shape') && (
        <TextWrapInspector element={selectedEl} />
      )}
    </div>
  );
}

function TextInspector({
  element,
  styles,
  state,
}: {
  element: TextElement;
  styles: ParagraphStyle[];
  state: ProjectState;
}) {
  const [localText, setLocalText] = useState(element.text);
  const [fontSearch, setFontSearch] = useState('');
  const [fontCategory, setFontCategory] = useState<'all' | 'serif' | 'sans-serif' | 'display' | 'monospace' | 'handwriting'>('all');
  const [isFontHover, setIsFontHover] = useState(false);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const [, setFontVer] = useState(0);

  useEffect(() => {
    return fontManager.subscribe(() => setFontVer((v) => v + 1));
  }, []);

  useEffect(() => {
    setLocalText(element.text);
  }, [element.id, element.text]);

  const handleTextChange = (e: Event) => {
    const val = (e.target as HTMLTextAreaElement).value;
    setLocalText(val);
    stateManager.updateElement(element.id, { text: val });
  };

  return (
    <div className="inspector-section">
      <div className="section-header">TYPOGRAPHY</div>

      <label className="full-label" style={{ marginBottom: '8px' }}>
        Paragraph Style:
        <select
          value={element.paragraphStyleId || ''}
          onChange={(e) => {
            const val = (e.target as HTMLSelectElement).value;
            if (val) {
              stateManager.applyParagraphStyle(element.id, val);
            } else {
              stateManager.updateElement(element.id, { paragraphStyleId: undefined });
            }
          }}
        >
          <option value="">Custom / None</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {/* Extended Font Picker & Custom Dropzone */}
      <div className="font-picker-container" style={{ marginTop: '8px' }}>
        <input
          type="file"
          ref={fontFileRef}
          accept=".woff2,.ttf,.otf,.woff"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
              const buffer = await file.arrayBuffer();
              const name = await fontManager.registerFontBuffer(file.name, buffer);
              stateManager.updateElement(element.id, { fontFamily: name });
            }
            (e.target as HTMLInputElement).value = '';
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600 }}>Font Family</span>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
            {fontManager.isCustomFont(element.fontFamily)
              ? '★ Custom Font'
              : fontManager.isGoogleFont(element.fontFamily)
              ? '✦ Google Font'
              : 'System Font'}
          </span>
        </div>

        {/* Live Font Search */}
        <input
          type="text"
          placeholder="Search 1,600+ Google & custom fonts..."
          value={fontSearch}
          onInput={(e) => setFontSearch((e.target as HTMLInputElement).value)}
          style={{
            width: '100%',
            fontSize: '11px',
            padding: '4px 6px',
            marginBottom: '4px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-app)',
            color: 'var(--text-primary)',
          }}
        />

        {/* Category Filter Pills */}
        <div style={{ display: 'flex', gap: '3px', marginBottom: '6px', flexWrap: 'wrap' }}>
          {(['all', 'serif', 'sans-serif', 'display', 'monospace', 'handwriting'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFontCategory(cat)}
              style={{
                fontSize: '9px',
                padding: '2px 5px',
                borderRadius: '3px',
                border: '1px solid var(--border-color)',
                background: fontCategory === cat ? 'var(--accent, #0d99ff)' : 'transparent',
                color: fontCategory === cat ? '#ffffff' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {cat === 'all' ? 'All' : cat === 'sans-serif' ? 'Sans' : cat === 'monospace' ? 'Mono' : cat === 'handwriting' ? 'Script' : cat}
            </button>
          ))}
        </div>

        {/* Font Select */}
        {(() => {
          const filtered = fontManager.searchFonts(fontSearch, fontCategory);
          const customGroup = filtered.filter(f => f.source === 'custom');
          const googleGroup = filtered.filter(f => f.source === 'google');
          const systemGroup = filtered.filter(f => f.source === 'system');

          return (
            <select
              value={element.fontFamily}
              onChange={async (e) => {
                const val = (e.target as HTMLSelectElement).value;
                stateManager.updateElement(element.id, { fontFamily: val });
                await fontManager.loadGoogleFont(val);
              }}
              style={{ width: '100%', marginBottom: '6px' }}
            >
              {filtered.every(f => f.family !== element.fontFamily.split(',')[0].trim()) && (
                <option value={element.fontFamily}>
                  {element.fontFamily.split(',')[0]} (Current)
                </option>
              )}

              {customGroup.length > 0 && (
                <optgroup label="★ Custom Installed Fonts">
                  {customGroup.map(f => (
                    <option key={f.family} value={f.family}>
                      {f.family}
                    </option>
                  ))}
                </optgroup>
              )}

              <optgroup label="✦ Google Fonts">
                {googleGroup.map(f => (
                  <option key={f.family} value={`${f.family}, ${f.fallback}`}>
                    {f.family}
                  </option>
                ))}
              </optgroup>

              <optgroup label="System Fonts">
                {systemGroup.map(f => (
                  <option key={f.family} value={`${f.family}, ${f.fallback}`}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
            </select>
          );
        })()}

        {/* Font Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsFontHover(true);
          }}
          onDragLeave={() => setIsFontHover(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setIsFontHover(false);
            const file = e.dataTransfer?.files?.[0];
            if (file) {
              const buffer = await file.arrayBuffer();
              const name = await fontManager.registerFontBuffer(file.name, buffer);
              stateManager.updateElement(element.id, { fontFamily: name });
            }
          }}
          onClick={() => fontFileRef.current?.click()}
          style={{
            border: `1px dashed ${isFontHover ? 'var(--accent, #0d99ff)' : 'var(--border-color)'}`,
            background: isFontHover ? 'rgba(13, 153, 255, 0.08)' : 'var(--bg-app)',
            borderRadius: '4px',
            padding: '6px 8px',
            textAlign: 'center',
            cursor: 'pointer',
            fontSize: '10px',
            color: 'var(--text-secondary)',
            transition: 'all 0.15s ease',
          }}
          title="Click to browse or drag & drop .woff2, .ttf, or .otf font file directly"
        >
          {isFontHover ? '📥 Drop font file to install' : '🔤 Drop font file (.woff2, .ttf, .otf) or click'}
        </div>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Size:
          <input
            type="number"
            value={element.fontSizePt}
            min={6}
            max={144}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                fontSizePt: parseFloat((e.target as HTMLInputElement).value) || 12,
              })}
          />
          pt
        </label>
        <label>
          Leading:
          <input
            type="number"
            value={element.lineHeight}
            step={0.05}
            min={0.8}
            max={2.5}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                lineHeight: parseFloat((e.target as HTMLInputElement).value) || 1.3,
              })}
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Text Color:
          <input
            type="color"
            value={element.color || '#111111'}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                color: (e.target as HTMLInputElement).value,
              })}
          />
        </label>
        <label>
          Background:
          <input
            type="color"
            value={
              element.backgroundColor && element.backgroundColor !== 'transparent'
                ? element.backgroundColor
                : '#ffffff'
            }
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                backgroundColor: (e.target as HTMLInputElement).value,
              })}
          />
        </label>
      </div>

      <div className="align-buttons" style={{ marginTop: '10px' }}>
        {(['left', 'center', 'right', 'justify'] as const).map((align) => (
          <button
            key={align}
            className={`align-btn ${element.alignment === align ? 'active' : ''}`}
            onClick={() => stateManager.updateElement(element.id, { alignment: align })}
            title={`Align ${align}`}
          >
            {align.charAt(0).toUpperCase() + align.slice(1)}
          </button>
        ))}
      </div>

      <div className="input-grid-2" style={{ marginTop: '10px' }}>
        <label>
          Columns:
          <input
            type="number"
            value={element.columns || 1}
            min={1}
            max={4}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                columns: parseInt((e.target as HTMLInputElement).value, 10) || 1,
              })}
          />
        </label>
        <label>
          Gutter:
          <input
            type="number"
            value={element.columnGutterMm || 4}
            min={1}
            max={20}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                columnGutterMm: parseFloat((e.target as HTMLInputElement).value) || 4,
              })}
          />
          mm
        </label>
      </div>

      {element.columns > 1 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer', marginTop: '6px' }}>
          <input
            type="checkbox"
            checked={Boolean(element.balanceColumns)}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                balanceColumns: (e.target as HTMLInputElement).checked,
              })
            }
          />
          Balance Columns (Equalize lines)
        </label>
      )}

      <button
        className="sm-btn"
        style={{
          width: '100%',
          padding: '6px 10px',
          marginTop: '8px',
          marginBottom: '4px',
          backgroundColor: 'rgba(13, 153, 255, 0.12)',
          color: 'var(--accent, #0d99ff)',
          borderColor: 'rgba(13, 153, 255, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          fontWeight: 600,
        }}
        onClick={() => {
          const res = stateManager.copyfitTextFrame(element.id);
          if (res.adjustments.length > 0) {
            alert(`Copyfit applied:\n• ${res.adjustments.join('\n• ')}`);
          } else {
            alert('Text frame is already copyfit cleanly; no orphans or overflow detected.');
          }
        }}
        title="Auto Copyfit: bind orphan words with non-breaking spaces and micro-adjust tracking to eliminate overflow"
      >
        ✨ Auto Copyfit (Eliminate Overflow)
      </button>

      <div className="input-grid-2" style={{ marginTop: '10px' }}>
        <label>
          Drop Cap:
          <select
            value={element.dropCapLines || 0}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                dropCapLines: parseInt((e.target as HTMLSelectElement).value, 10),
              })}
          >
            <option value="0">None</option>
            <option value="2">2 Lines</option>
            <option value="3">3 Lines</option>
            <option value="4">4 Lines</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer', marginTop: '16px' }}>
          <input
            type="checkbox"
            checked={Boolean(element.snapToBaseline)}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                snapToBaseline: (e.target as HTMLInputElement).checked,
              })}
          />
          Snap Baseline
        </label>
      </div>

      <div style={{ marginTop: '12px', padding: '8px 10px', backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: '6px' }}>
          MICRO-TYPOGRAPHY & OPENTYPE
        </div>

        <div className="input-grid-2" style={{ marginBottom: '8px' }}>
          <label>
            Tracking:
            <input
              type="number"
              value={element.letterSpacingPt || 0}
              step={0.1}
              min={-2}
              max={10}
              onInput={(e) =>
                stateManager.updateElement(element.id, {
                  letterSpacingPt: parseFloat((e.target as HTMLInputElement).value) || 0,
                })}
            />
            pt
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer', marginTop: '16px' }}>
            <input
              type="checkbox"
              checked={Boolean(element.opticalMarginAlignment)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  opticalMarginAlignment: (e.target as HTMLInputElement).checked,
                })}
            />
            Optical Margin
          </label>
        </div>

        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          OpenType Features:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(element.openTypeFeatures?.ligatures)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  openTypeFeatures: {
                    ...(element.openTypeFeatures || {}),
                    ligatures: (e.target as HTMLInputElement).checked,
                  },
                })}
            />
            Ligatures (fi, fl)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(element.openTypeFeatures?.smallCaps)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  openTypeFeatures: {
                    ...(element.openTypeFeatures || {}),
                    smallCaps: (e.target as HTMLInputElement).checked,
                  },
                })}
            />
            Small Caps
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(element.openTypeFeatures?.oldStyleFigures)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  openTypeFeatures: {
                    ...(element.openTypeFeatures || {}),
                    oldStyleFigures: (e.target as HTMLInputElement).checked,
                  },
                })}
            />
            Old-Style Figures
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(element.openTypeFeatures?.fractions)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  openTypeFeatures: {
                    ...(element.openTypeFeatures || {}),
                    fractions: (e.target as HTMLInputElement).checked,
                  },
                })}
            />
            Fractions (½, ¾)
          </label>
        </div>
      </div>

      <div style={{ marginTop: '12px', padding: '8px 10px', backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: '4px' }}>
          STORY THREADING
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
          {element.prevFrameId && element.nextFrameId
            ? 'Mid-thread container'
            : element.nextFrameId
            ? 'Story Head (flows to next frame)'
            : element.prevFrameId
            ? 'Story Tail (receives overflow)'
            : 'Unthreaded frame'}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {element.nextFrameId || element.prevFrameId ? (
            <button
              className="sm-btn danger-btn"
              onClick={() => stateManager.unlinkTextFrame(element.id)}
            >
              Unlink Thread
            </button>
          ) : (
            <button
              className="sm-btn"
              style={{ backgroundColor: 'rgba(13, 153, 255, 0.15)', color: 'var(--accent-cyan)' }}
              onClick={() => stateManager.setLinkingFromFrame(element.id)}
            >
              + Link to Next Frame...
            </button>
          )}
        </div>
      </div>

      {/* Footnotes & Citations */}
      <div style={{ marginTop: '12px', padding: '8px 10px', backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent, #0d99ff)' }}>
            FOOTNOTES & CITATIONS
          </div>
          <button
            className="sm-btn"
            style={{ padding: '2px 6px', fontSize: '10px' }}
            onClick={() => {
              const note = prompt('Enter Footnote Reference Text:', 'Citation or footnote note');
              if (note !== null) {
                stateManager.insertFootnote(element.id, note);
              }
            }}
          >
            + Insert Footnote
          </button>
        </div>

        {stateManager.getFootnotesForElement(element.id).length === 0 ? (
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            No footnotes in this frame. Click "+ Insert Footnote" to append a superscript reference marker and reserve bottom footnote area.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
            {stateManager.getFootnotesForElement(element.id).map((fn) => (
              <div
                key={fn.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--bg-app)',
                  padding: '4px 6px',
                  borderRadius: '3px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '11px',
                    color: 'var(--accent, #0d99ff)',
                    minWidth: '16px',
                    textAlign: 'center',
                  }}
                >
                  {numberToSuperscript(fn.number)}
                </span>
                <input
                  type="text"
                  value={fn.text}
                  onInput={(e) => stateManager.updateFootnote(fn.id, { text: (e.target as HTMLInputElement).value })}
                  style={{
                    flex: 1,
                    fontSize: '11px',
                    padding: '2px 4px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  className="sm-btn danger-btn"
                  style={{ padding: '1px 5px', fontSize: '10px' }}
                  onClick={() => stateManager.deleteFootnote(fn.id)}
                  title="Delete Footnote"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footnote Formatting Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-color)', fontSize: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>Size:</span>
            <input
              type="number"
              style={{ width: '40px', padding: '1px 3px', fontSize: '10px' }}
              value={state.settings.footnoteSettings?.fontSizePt || 8}
              min={5}
              max={16}
              onInput={(e) =>
                stateManager.updateFootnoteSettings({
                  fontSizePt: parseFloat((e.target as HTMLInputElement).value) || 8,
                })
              }
            />
            <span>pt</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>Rule:</span>
            <input
              type="number"
              style={{ width: '40px', padding: '1px 3px', fontSize: '10px' }}
              value={state.settings.footnoteSettings?.separatorRuleWidthMm || 30}
              min={10}
              max={100}
              onInput={(e) =>
                stateManager.updateFootnoteSettings({
                  separatorRuleWidthMm: parseFloat((e.target as HTMLInputElement).value) || 30,
                })
              }
            />
            <span>mm</span>
          </label>
        </div>
      </div>

      <div style={{ marginTop: '10px' }}>
        <label className="full-label">
          Content Editor:
          <textarea
            rows={6}
            value={localText}
            onInput={handleTextChange}
          ></textarea>
        </label>
      </div>
    </div>
  );
}

function ImageInspector({ element }: { element: ImageElement }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (re) => {
        if (typeof re.target?.result === 'string') {
          stateManager.updateElement(element.id, { src: re.target.result });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="inspector-section">
      <div className="section-header">IMAGE FRAME</div>
      <button
        className="action-btn-primary"
        style={{ width: '100%', marginBottom: '8px' }}
        onClick={() => fileInputRef.current?.click()}
      >
        {element.src ? 'Replace Photo' : 'Upload Photo'}
      </button>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

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
          placeholder="Screen-reader description (PDF/UA Section 508)..."
          value={element.altText || ''}
          onInput={(e) =>
            stateManager.updateElement(element.id, {
              altText: (e.target as HTMLInputElement).value,
            })
          }
        />
      </label>

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
                fillColor: (e.target as HTMLInputElement).value,
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

function TextWrapInspector({ element }: { element: CanvasElement }) {
  const wrap = element.textWrap || { mode: 'none', standoffMm: 3 };

  const handleModeChange = (e: Event) => {
    const mode = (e.target as HTMLSelectElement).value as any;
    stateManager.updateElement(element.id, {
      textWrap: {
        mode,
        standoffMm: wrap.standoffMm ?? 3,
      },
    });
  };

  const handleStandoffChange = (e: Event) => {
    const standoffMm = parseFloat((e.target as HTMLInputElement).value) || 0;
    stateManager.updateElement(element.id, {
      textWrap: {
        mode: wrap.mode,
        standoffMm,
      },
    });
  };

  return (
    <div className="inspector-section">
      <div className="section-header">TEXT WRAP (RUNAROUND)</div>
      <label className="full-label">
        Wrap Mode:
        <select value={wrap.mode} onChange={handleModeChange}>
          <option value="none">None (No Text Wrap)</option>
          <option value="boundingBox">Around Bounding Box</option>
          <option value="contour">Around Contour / Shape</option>
        </select>
      </label>
      {wrap.mode !== 'none' && (
        <div className="input-grid-2" style={{ marginTop: '8px' }}>
          <label>
            Standoff:
            <input
              type="number"
              min={0}
              max={25}
              step={0.5}
              value={wrap.standoffMm ?? 3}
              onInput={handleStandoffChange}
            />
            mm
          </label>
          <span style={{ fontSize: '11px', color: '#888', alignSelf: 'center', lineHeight: '1.2' }}>
            Margin around obstacle pushing text lines
          </span>
        </div>
      )}
    </div>
  );
}

function TableInspector({ element }: { element: TableElement }) {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

  const handleRowsChange = (e: Event) => {
    const newRows = Math.max(1, Math.min(20, parseInt((e.target as HTMLInputElement).value, 10) || 1));
    if (newRows === element.rows) return;
    const newCells: TableCell[][] = [];
    for (let r = 0; r < newRows; r++) {
      if (r < element.rows) {
        newCells.push([...element.cells[r]]);
      } else {
        const rowArr: TableCell[] = [];
        for (let c = 0; c < element.cols; c++) {
          rowArr.push({ text: `R${r + 1}C${c + 1}`, align: 'left' });
        }
        newCells.push(rowArr);
      }
    }
    stateManager.updateElement(element.id, { rows: newRows, cells: newCells });
  };

  const handleColsChange = (e: Event) => {
    const newCols = Math.max(1, Math.min(10, parseInt((e.target as HTMLInputElement).value, 10) || 1));
    if (newCols === element.cols) return;
    const newCells: TableCell[][] = element.cells.map((rowArr, r) => {
      const nextRow = [...rowArr];
      while (nextRow.length < newCols) {
        nextRow.push({ text: `R${r + 1}C${nextRow.length + 1}`, align: 'left' });
      }
      return nextRow.slice(0, newCols);
    });
    stateManager.updateElement(element.id, { cols: newCols, cells: newCells });
  };

  const handleCellTextChange = (row: number, col: number, text: string) => {
    stateManager.updateTableCell(element.id, row, col, text);
  };

  const activeCell = selectedCell && element.cells[selectedCell.row] && element.cells[selectedCell.row][selectedCell.col]
    ? element.cells[selectedCell.row][selectedCell.col]
    : null;

  return (
    <div className="inspector-section">
      <div className="section-header">TABLE STRUCTURE</div>
      <div className="input-grid-2">
        <label>
          Rows:
          <input
            type="number"
            min={1}
            max={20}
            value={element.rows}
            disabled={element.locked}
            onChange={handleRowsChange}
          />
        </label>
        <label>
          Columns:
          <input
            type="number"
            min={1}
            max={10}
            value={element.cols}
            disabled={element.locked}
            onChange={handleColsChange}
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Header Row:
          <input
            type="checkbox"
            checked={element.headerRowCount > 0}
            disabled={element.locked}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                headerRowCount: (e.target as HTMLInputElement).checked ? 1 : 0,
              })
            }
          />
        </label>
        <label>
          Alt Row Fill:
          <input
            type="color"
            value={element.alternateRowColor || '#f9f9f9'}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                alternateRowColor: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Border Width:
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={element.borderWidthMm}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                borderWidthMm: parseFloat((e.target as HTMLInputElement).value) || 0,
              })
            }
          />
          mm
        </label>
        <label>
          Border Color:
          <input
            type="color"
            value={element.borderColor}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                borderColor: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Font Size:
          <input
            type="number"
            min={6}
            max={48}
            step={0.5}
            value={element.fontSizePt}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                fontSizePt: parseFloat((e.target as HTMLInputElement).value) || 9,
              })
            }
          />
          pt
        </label>
        <label>
          Padding:
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={element.cellPaddingMm}
            disabled={element.locked}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                cellPaddingMm: parseFloat((e.target as HTMLInputElement).value) || 1,
              })
            }
          />
          mm
        </label>
      </div>

      <div style={{ marginTop: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#aaa', marginBottom: '6px' }}>
          CELL MATRIX (CLICK CELL TO EDIT)
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${element.cols}, 1fr)`,
            gap: '2px',
            maxHeight: '160px',
            overflowY: 'auto',
            background: '#1a1a1a',
            padding: '4px',
            borderRadius: '4px',
            border: '1px solid #333',
          }}
        >
          {element.cells.map((rowArr, r) =>
            rowArr.map((cell, c) => {
              const isSelected = selectedCell?.row === r && selectedCell?.col === c;
              const isHdr = r < element.headerRowCount;
              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => setSelectedCell({ row: r, col: c })}
                  style={{
                    padding: '4px 6px',
                    fontSize: '10px',
                    background: isSelected
                      ? '#3b82f6'
                      : isHdr
                      ? '#333'
                      : r % 2 === 1
                      ? '#222'
                      : '#2a2a2a',
                    color: isSelected ? '#fff' : isHdr ? '#fbbf24' : '#e0e0e0',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    border: isSelected ? '1px solid #fff' : '1px solid #444',
                    borderRadius: '2px',
                  }}
                  title={`Row ${r + 1}, Col ${c + 1}: ${cell.text}`}
                >
                  {cell.text || '∅'}
                </div>
              );
            })
          )}
        </div>
      </div>

      {activeCell && selectedCell && (
        <div style={{ marginTop: '10px', background: '#252525', padding: '8px', borderRadius: '4px' }}>
          <div style={{ fontSize: '11px', color: '#93c5fd', marginBottom: '4px', fontWeight: 600 }}>
            Editing Cell [R{selectedCell.row + 1}, C{selectedCell.col + 1}]:
          </div>
          <input
            type="text"
            value={activeCell.text}
            disabled={element.locked}
            style={{ width: '100%', boxSizing: 'border-box' }}
            onInput={(e) =>
              handleCellTextChange(
                selectedCell.row,
                selectedCell.col,
                (e.target as HTMLInputElement).value
              )
            }
          />
          <div className="btn-group-sm" style={{ marginTop: '6px' }}>
            <button
              className={`sm-btn ${activeCell.align === 'left' || !activeCell.align ? 'active' : ''}`}
              onClick={() => {
                const newCells = element.cells.map((r, rIdx) =>
                  r.map((c, cIdx) =>
                    rIdx === selectedCell.row && cIdx === selectedCell.col ? { ...c, align: 'left' as const } : c
                  )
                );
                stateManager.updateElement(element.id, { cells: newCells });
              }}
            >
              Align L
            </button>
            <button
              className={`sm-btn ${activeCell.align === 'center' ? 'active' : ''}`}
              onClick={() => {
                const newCells = element.cells.map((r, rIdx) =>
                  r.map((c, cIdx) =>
                    rIdx === selectedCell.row && cIdx === selectedCell.col ? { ...c, align: 'center' as const } : c
                  )
                );
                stateManager.updateElement(element.id, { cells: newCells });
              }}
            >
              Align C
            </button>
            <button
              className={`sm-btn ${activeCell.align === 'right' ? 'active' : ''}`}
              onClick={() => {
                const newCells = element.cells.map((r, rIdx) =>
                  r.map((c, cIdx) =>
                    rIdx === selectedCell.row && cIdx === selectedCell.col ? { ...c, align: 'right' as const } : c
                  )
                );
                stateManager.updateElement(element.id, { cells: newCells });
              }}
            >
              Align R
            </button>
          </div>
        </div>
      )}
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
                fillColor: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={element.fillColor === 'transparent' || !element.fillColor}
            disabled={element.locked}
            onChange={(e) =>
              stateManager.updateElement(element.id, {
                fillColor: (e.target as HTMLInputElement).checked ? 'transparent' : '#e5e5e5',
              })
            }
          />
          Transparent Fill
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
