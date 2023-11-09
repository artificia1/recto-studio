import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import { fontManager } from '../../fontManager';
import { ProjectState, ParagraphStyle } from '../../types';

interface StylesTabProps {
  state: ProjectState;
}

export function StylesTab({ state }: StylesTabProps) {
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);

  const activeSpread = state.spreads[state.activeSpreadIndex] || state.spreads[0];
  const selectedEl = activeSpread?.elements.find((el) => el.id === state.selectedElementId);
  const isTextSelected = selectedEl?.type === 'text';

  const handleCreateStyle = () => {
    const newId = `style-${Date.now()}`;
    const newStyle: ParagraphStyle = {
      id: newId,
      name: `Custom Style ${state.paragraphStyles.length + 1}`,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePt: 11,
      lineHeight: 1.4,
      letterSpacingPt: 0,
      color: '#222222',
      alignment: 'left',
      snapToBaseline: true,
      dropCapLines: 0,
    };
    stateManager.createParagraphStyle(newStyle);
    setEditingStyleId(newId);
  };

  return (
    <div className="styles-tab-view">
      <div className="styles-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div className="section-header" style={{ margin: 0 }}>PARAGRAPH STYLES</div>
        <button
          className="sm-btn"
          style={{ backgroundColor: 'var(--accent-cyan)', color: '#111', fontWeight: 600, border: 'none' }}
          onClick={handleCreateStyle}
        >
          + New Style
        </button>
      </div>

      <div className="styles-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {state.paragraphStyles.map((style) => {
          const isEditing = editingStyleId === style.id;
          const isAppliedToSelected = isTextSelected && (selectedEl as any).paragraphStyleId === style.id;

          if (isEditing) {
            return (
              <div
                key={style.id}
                className="style-editor-card"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--accent-cyan)',
                  borderRadius: '6px',
                  padding: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-cyan)' }}>EDIT STYLE</span>
                  <button
                    className="sm-btn"
                    onClick={() => setEditingStyleId(null)}
                  >
                    Done
                  </button>
                </div>

                <label className="full-label" style={{ marginBottom: '8px' }}>
                  Style Name:
                  <input
                    type="text"
                    value={style.name}
                    onInput={(e) =>
                      stateManager.updateParagraphStyle(style.id, {
                        name: (e.target as HTMLInputElement).value || 'Untitled Style',
                      })}
                  />
                </label>

                <label className="full-label" style={{ marginBottom: '8px' }}>
                  Font Family:
                  <select
                    value={style.fontFamily}
                    onChange={async (e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      stateManager.updateParagraphStyle(style.id, { fontFamily: val });
                      await fontManager.loadGoogleFont(val);
                    }}
                  >
                    {fontManager.getAvailableFonts().map((f) => (
                      <option key={f.family} value={f.source === 'custom' ? f.family : `${f.family}, ${f.fallback}`}>
                        {f.family} ({f.category})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="full-label" style={{ marginBottom: '8px' }}>
                  PDF Tag (Accessibility):
                  <select
                    value={style.pdfTag || 'P'}
                    onChange={(e) =>
                      stateManager.updateParagraphStyle(style.id, {
                        pdfTag: (e.target as HTMLSelectElement).value as any,
                      })
                    }
                  >
                    <option value="Title">Title (Document Title)</option>
                    <option value="H1">H1 (Major Heading)</option>
                    <option value="H2">H2 (Subheading Level 2)</option>
                    <option value="H3">H3 (Subheading Level 3)</option>
                    <option value="H4">H4 (Subheading Level 4)</option>
                    <option value="P">P (Paragraph / Body Text)</option>
                    <option value="BlockQuote">BlockQuote (Pullquote / Callout)</option>
                    <option value="Caption">Caption (Figure / Photo Caption)</option>
                    <option value="Div">Div (Generic Block)</option>
                  </select>
                </label>

                <div className="input-grid-2" style={{ marginBottom: '8px' }}>
                  <label>
                    Size (pt):
                    <input
                      type="number"
                      value={style.fontSizePt}
                      min={6}
                      max={96}
                      onInput={(e) =>
                        stateManager.updateParagraphStyle(style.id, {
                          fontSizePt: parseFloat((e.target as HTMLInputElement).value) || 12,
                        })}
                    />
                  </label>
                  <label>
                    Leading:
                    <input
                      type="number"
                      value={style.lineHeight}
                      step={0.05}
                      min={0.8}
                      max={2.5}
                      onInput={(e) =>
                        stateManager.updateParagraphStyle(style.id, {
                          lineHeight: parseFloat((e.target as HTMLInputElement).value) || 1.3,
                        })}
                    />
                  </label>
                </div>

                <div className="input-grid-2" style={{ marginBottom: '8px' }}>
                  <label>
                    Color:
                    <input
                      type="color"
                      value={style.color}
                      onInput={(e) =>
                        stateManager.updateParagraphStyle(style.id, {
                          color: (e.target as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label>
                    Drop Cap:
                    <select
                      value={style.dropCapLines || 0}
                      onChange={(e) =>
                        stateManager.updateParagraphStyle(style.id, {
                          dropCapLines: parseInt((e.target as HTMLSelectElement).value, 10),
                        })}
                    >
                      <option value="0">Disabled</option>
                      <option value="2">2 Lines</option>
                      <option value="3">3 Lines</option>
                      <option value="4">4 Lines</option>
                    </select>
                  </label>
                </div>

                <div className="align-buttons" style={{ marginBottom: '10px' }}>
                  {(['left', 'center', 'right', 'justify'] as const).map((align) => (
                    <button
                      key={align}
                      className={`align-btn ${style.alignment === align ? 'active' : ''}`}
                      onClick={() => stateManager.updateParagraphStyle(style.id, { alignment: align })}
                    >
                      {align.charAt(0).toUpperCase() + align.slice(1)}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(style.snapToBaseline)}
                      onChange={(e) =>
                        stateManager.updateParagraphStyle(style.id, {
                          snapToBaseline: (e.target as HTMLInputElement).checked,
                        })}
                    />
                    Snap to Document Baseline Grid
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(style.opticalMarginAlignment)}
                      onChange={(e) =>
                        stateManager.updateParagraphStyle(style.id, {
                          opticalMarginAlignment: (e.target as HTMLInputElement).checked,
                        })}
                    />
                    Optical Margin Alignment (Hanging Punctuation)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(style.openTypeFeatures?.ligatures)}
                      onChange={(e) =>
                        stateManager.updateParagraphStyle(style.id, {
                          openTypeFeatures: {
                            ...(style.openTypeFeatures || {}),
                            ligatures: (e.target as HTMLInputElement).checked,
                          },
                        })}
                    />
                    Standard Ligatures (fi, fl, ffi)
                  </label>
                </div>
              </div>
            );
          }

          return (
            <div
              key={style.id}
              className="style-item-card"
              style={{
                backgroundColor: isAppliedToSelected ? 'rgba(13, 153, 255, 0.12)' : 'var(--bg-input)',
                border: `1px solid ${isAppliedToSelected ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                borderRadius: '6px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {style.name}
                  {style.pdfTag && (
                    <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', padding: '1px 4px', borderRadius: '3px', fontFamily: 'monospace' }}>
                      &lt;{style.pdfTag}&gt;
                    </span>
                  )}
                  {isAppliedToSelected && (
                    <span style={{ fontSize: '9px', background: 'var(--accent-cyan)', color: '#111', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                      ACTIVE
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="sm-btn"
                    disabled={!isTextSelected}
                    onClick={() => {
                      if (selectedEl) {
                        stateManager.applyParagraphStyle(selectedEl.id, style.id);
                      }
                    }}
                    title={isTextSelected ? 'Apply to selected text frame' : 'Select a text frame to apply'}
                  >
                    Apply
                  </button>
                  <button
                    className="sm-btn"
                    onClick={() => setEditingStyleId(style.id)}
                  >
                    Edit
                  </button>
                  {state.paragraphStyles.length > 1 && (
                    <button
                      className="sm-btn danger-btn"
                      onClick={() => stateManager.deleteParagraphStyle(style.id)}
                      title="Delete Style"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                {style.fontFamily.split(',')[0]} · {style.fontSizePt}pt / {style.lineHeight} · {style.alignment}
              </div>

              <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                {style.snapToBaseline && (
                  <span style={{ fontSize: '9px', background: '#3a86ff22', color: '#3a86ff', padding: '1px 5px', borderRadius: '3px' }}>
                    Baseline Snap
                  </span>
                )}
                {Boolean(style.dropCapLines && style.dropCapLines >= 2) && (
                  <span style={{ fontSize: '9px', background: '#b5179e22', color: '#b5179e', padding: '1px 5px', borderRadius: '3px' }}>
                    Drop Cap: {style.dropCapLines} lines
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
