import { useState, useEffect, useRef } from 'preact/hooks';
import { stateManager, numberToSuperscript } from '../../state';
import { fontManager } from '../../fontManager';
import { getAllFreeToneColors } from '../../engine/spotColors';
import type { ProjectState, TextElement, ParagraphStyle } from '../../types';
import { MathInput } from '../common/MathInput';
import { lazy, Suspense } from 'preact/compat';
const VariableFontPanel = lazy(() => import('./VariableFontPanel'));

export default function TextInspector({
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
  const [fontError, setFontError] = useState('');
  const importFont = async (file: File) => {
    setFontError('');
    try {
      const name = await fontManager.registerFontBuffer(file.name, await file.arrayBuffer());
      stateManager.saveImportedFonts();
      stateManager.updateElement(element.id, { fontFamily: name });
    } catch (error) {
      setFontError(error instanceof Error ? error.message : 'Unable to read this font.');
    }
  };
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
      {fontError && <p role="alert" style={{ color: '#ff7878', fontSize: '12px' }}>{fontError}</p>}
      <div className="font-picker-container" style={{ marginTop: '8px' }}>
        <input
          type="file"
          ref={fontFileRef}
          accept=".woff2,.ttf,.otf,.woff"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
              await importFont(file);
            }
            (e.target as HTMLInputElement).value = '';
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600 }}>Font Family</span>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
            {fontManager.isCustomFont(element.fontFamily)
              ? '[Custom Font]'
              : fontManager.isGoogleFont(element.fontFamily)
              ? '[Google Font]'
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

        <Suspense fallback={null}><VariableFontPanel key={`${element.id}:${element.fontFamily}`} element={element}/></Suspense>
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
                <optgroup label="Custom Installed Fonts">
                  {customGroup.map(f => (
                    <option key={f.family} value={f.family}>
                      {f.family}
                    </option>
                  ))}
                </optgroup>
              )}

              <optgroup label="Google Fonts">
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
            e.stopPropagation();
            setIsFontHover(false);
            const file = e.dataTransfer?.files?.[0];
            if (file) {
              await importFont(file);
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
          {isFontHover ? 'Drop font file to install' : 'Import font: TTF, OTF, WOFF, WOFF2'}
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

      <div className="input-field" style={{ marginTop: '8px' }}>
        <label>
          OpenSpot / FreeTone Spot Ink:
          <select
            value={element.spotColor || ''}
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginTop: '10px' }}>
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
        <label>
          Inset:
          <input
            type="number"
            value={element.paddingMm ?? 2}
            min={0}
            max={40}
            step={0.5}
            onInput={(e) =>
              stateManager.updateElement(element.id, {
                paddingMm: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0),
              })}
          />
          mm
        </label>
      </div>

      {element.columns > 1 && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(element.spanColumns)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  spanColumns: (e.target as HTMLInputElement).checked,
                })
              }
            />
            Span Columns (Full Width Headline)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(element.splitColumns && element.splitColumns > 1)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  splitColumns: (e.target as HTMLInputElement).checked ? 2 : 1,
                })
              }
            />
            Split Columns (Sub-columns)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' }}>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(element.columnRule?.enabled)}
              onChange={(e) =>
                stateManager.updateElement(element.id, {
                  columnRule: {
                    enabled: (e.target as HTMLInputElement).checked,
                    widthPt: element.columnRule?.widthPt || 0.5,
                    color: element.columnRule?.color || '#888888',
                    insetMm: element.columnRule?.insetMm || 0,
                  },
                })
              }
            />
            Column Rules (Vertical Dividers)
          </label>
        </div>
      )}

      <div style={{ marginTop: '8px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Vertical Align:</span>
        <div className="btn-group-joined" style={{ width: '100%' }}>
          {(['top', 'middle', 'bottom'] as const).map((vAlign) => (
            <button
              key={vAlign}
              className={`action-btn ${(element.verticalAlign || 'top') === vAlign ? 'active' : ''}`}
              style={{ flex: 1, textTransform: 'capitalize', fontSize: '10px' }}
              onClick={() => stateManager.updateElement(element.id, { verticalAlign: vAlign })}
            >
              {vAlign}
            </button>
          ))}
        </div>
      </div>

      <button
        className="sm-btn"
        style={{
          width: '100%',
          padding: '6px 10px',
          marginTop: '8px',
          backgroundColor: 'rgba(46, 196, 182, 0.15)',
          color: '#2ec4b6',
          border: '1px solid rgba(46, 196, 182, 0.35)',
          borderRadius: '4px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
        onClick={() => stateManager.fitFrameToContent(element.id)}
        title="Fit Frame Height to Content (Ctrl+Alt+C)"
      >
        Fit Frame to Content (Ctrl+Alt+C)
      </button>

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
        Auto Copyfit (Eliminate Overflow)
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Content Editor:</span>
          <span style={{ fontSize: '10px', color: '#8e8e93' }}>
            {localText ? localText.trim().split(/\s+/).filter(Boolean).length : 0} words · {localText.length} chars
          </span>
        </div>
        <textarea
          rows={6}
          readOnly={!!element.generated}
          value={localText}
          onInput={handleTextChange}
        ></textarea>
      </div>
    </div>
  );
}
