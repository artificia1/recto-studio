import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import { fontManager } from '../../fontManager';
import { ProjectState, ParagraphStyle, GrepStyleRule } from '../../types';

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

                <div className="grep-styles-section" style={{ marginTop: '14px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--accent-cyan)' }}>
                      GREP STYLES (REGEX FORMATTING)
                    </span>
                    <button
                      className="sm-btn"
                      style={{ fontSize: '10px', padding: '2px 6px' }}
                      onClick={() =>
                        stateManager.addGrepStyleRule(style.id, {
                          pattern: '\\b\\d+\\b',
                          bold: true,
                          color: '#0d99ff',
                        })
                      }
                      title="Add a new regex pattern styling rule"
                    >
                      + Add GREP Rule
                    </button>
                  </div>

                  <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: '0 0 8px 0', lineHeight: 1.3 }}>
                    Automatically format matched words, dates, prices, or acronyms inside this paragraph style.
                  </p>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    <button
                      className="sm-btn"
                      style={{ fontSize: '9px', padding: '2px 5px' }}
                      onClick={() =>
                        stateManager.addGrepStyleRule(style.id, {
                          pattern: '\\b\\d{4}\\b',
                          bold: true,
                          color: '#e63946',
                        })
                      }
                      title="Auto-style 4-digit years (e.g. 2026, 1984)"
                    >
                      + Years (\b\d4\b)
                    </button>
                    <button
                      className="sm-btn"
                      style={{ fontSize: '9px', padding: '2px 5px' }}
                      onClick={() =>
                        stateManager.addGrepStyleRule(style.id, {
                          pattern: '\\$[\\d,.]+',
                          bold: true,
                          color: '#10b981',
                        })
                      }
                      title="Auto-style currency ($1,250.00)"
                    >
                      + Currency (\$...)
                    </button>
                    <button
                      className="sm-btn"
                      style={{ fontSize: '9px', padding: '2px 5px' }}
                      onClick={() =>
                        stateManager.addGrepStyleRule(style.id, {
                          pattern: '\\b[A-Z]{2,}\\b',
                          bold: true,
                          color: '#8b5cf6',
                        })
                      }
                      title="Auto-style All-Caps Acronyms (e.g. NASA, PDF, DTP)"
                    >
                      + Acronyms (\b[A-Z]+\b)
                    </button>
                  </div>

                  {(!style.grepStyles || style.grepStyles.length === 0) ? (
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '4px 0' }}>
                      No GREP rules active. Click a preset above or "+ Add GREP Rule".
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {style.grepStyles.map((rule) => (
                        <div
                          key={rule.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            padding: '4px 6px',
                          }}
                        >
                          <input
                            type="text"
                            value={rule.pattern}
                            placeholder="Regex (e.g. \b\d{4}\b)"
                            style={{
                              flex: 1,
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              padding: '2px 4px',
                              backgroundColor: 'var(--bg-panel)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '3px',
                            }}
                            onInput={(e) =>
                              stateManager.updateGrepStyleRule(style.id, rule.id, {
                                pattern: (e.target as HTMLInputElement).value,
                              })
                            }
                          />

                          <div style={{ display: 'flex', gap: '2px' }}>
                            <button
                              className={`sm-btn ${rule.bold ? 'active' : ''}`}
                              style={{
                                fontWeight: 'bold',
                                padding: '2px 6px',
                                minWidth: '22px',
                                backgroundColor: rule.bold ? 'var(--accent-cyan)' : 'transparent',
                                color: rule.bold ? '#111' : 'var(--text-primary)',
                              }}
                              onClick={() =>
                                stateManager.updateGrepStyleRule(style.id, rule.id, {
                                  bold: !rule.bold,
                                })
                              }
                              title="Toggle Bold"
                            >
                              B
                            </button>
                            <button
                              className={`sm-btn ${rule.italic ? 'active' : ''}`}
                              style={{
                                fontStyle: 'italic',
                                padding: '2px 6px',
                                minWidth: '22px',
                                backgroundColor: rule.italic ? 'var(--accent-cyan)' : 'transparent',
                                color: rule.italic ? '#111' : 'var(--text-primary)',
                              }}
                              onClick={() =>
                                stateManager.updateGrepStyleRule(style.id, rule.id, {
                                  italic: !rule.italic,
                                })
                              }
                              title="Toggle Italic"
                            >
                              I
                            </button>
                            <button
                              className={`sm-btn ${rule.underline ? 'active' : ''}`}
                              style={{
                                textDecoration: 'underline',
                                padding: '2px 6px',
                                minWidth: '22px',
                                backgroundColor: rule.underline ? 'var(--accent-cyan)' : 'transparent',
                                color: rule.underline ? '#111' : 'var(--text-primary)',
                              }}
                              onClick={() =>
                                stateManager.updateGrepStyleRule(style.id, rule.id, {
                                  underline: !rule.underline,
                                })
                              }
                              title="Toggle Underline"
                            >
                              U
                            </button>
                          </div>

                          <input
                            type="color"
                            value={rule.color || style.color || '#0d99ff'}
                            style={{
                              width: '24px',
                              height: '24px',
                              padding: 0,
                              border: 'none',
                              cursor: 'pointer',
                              borderRadius: '3px',
                            }}
                            title="Match Color"
                            onInput={(e) =>
                              stateManager.updateGrepStyleRule(style.id, rule.id, {
                                color: (e.target as HTMLInputElement).value,
                              })
                            }
                          />

                          <button
                            className="sm-btn danger-btn"
                            style={{ padding: '2px 6px', fontSize: '10px' }}
                            onClick={() => stateManager.removeGrepStyleRule(style.id, rule.id)}
                            title="Delete GREP rule"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
