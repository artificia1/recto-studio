/**
 * Recto Studio — Publishing Automation & Scripting Panel
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState } from 'preact/hooks';
import { stateManager } from '../state';
import { TextElement } from '../types';

interface ScriptsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface BuiltInScript {
  id: string;
  name: string;
  description: string;
  execute: () => string;
}

export function ScriptsModal({ isOpen, onClose }: ScriptsModalProps) {
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [customCode, setCustomCode] = useState('// JavaScript script runner\n// Available: stateManager\nconst state = stateManager.getState();\nalert("Document has " + state.spreads.length + " spreads");');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  if (!isOpen) return null;

  const builtInScripts: BuiltInScript[] = [
    {
      id: 'smart-quotes',
      name: 'Smart Typographic Curly Quotes',
      description: 'Converts all straight quotes (" and \') to typographic curly quotes (“ ” ‘ ’).',
      execute: () => {
        let count = 0;
        const state = stateManager.getState();
        for (const spread of state.spreads) {
          for (const el of spread.elements) {
            if (el.type === 'text') {
              const txtEl = el as TextElement;
              const original = txtEl.text || '';
              const cleaned = original
                .replace(/"(\b[^"]+?\b)"/g, '“$1”')
                .replace(/'(\b[^']+?\b)'/g, '‘$1’')
                .replace(/(\w)'(\w)/g, '$1’$2');
              if (cleaned !== original) {
                stateManager.updateElement(el.id, { text: cleaned });
                count++;
              }
            }
          }
        }
        return `Processed smart quotes across ${count} text frames.`;
      },
    },
    {
      id: 'clean-whitespace',
      name: 'Remove Double Spaces & Orphan Tabs',
      description: 'Cleans up excessive spaces, double tabs, and trailing line whitespace.',
      execute: () => {
        let count = 0;
        const state = stateManager.getState();
        for (const spread of state.spreads) {
          for (const el of spread.elements) {
            if (el.type === 'text') {
              const txtEl = el as TextElement;
              const original = txtEl.text || '';
              const cleaned = original
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n\s*\n\s*\n/g, '\n\n')
                .trim();
              if (cleaned !== original) {
                stateManager.updateElement(el.id, { text: cleaned });
                count++;
              }
            }
          }
        }
        return `Normalized whitespace in ${count} frames.`;
      },
    },
    {
      id: 'fit-all-frames',
      name: 'Fit All Text Frames to Content',
      description: 'Auto-adjusts the height of all text frames across all spreads to clear overset text.',
      execute: () => {
        let count = 0;
        const state = stateManager.getState();
        for (const spread of state.spreads) {
          for (const el of spread.elements) {
            if (el.type === 'text') {
              stateManager.fitFrameToContent(el.id);
              count++;
            }
          }
        }
        return `Auto-fitted ${count} text frames across all spreads.`;
      },
    },
    {
      id: 'auto-number-figures',
      name: 'Auto-Number Figure Captions',
      description: 'Scans all captions and ensures sequential numbering ("Figure 1", "Figure 2"...).',
      execute: () => {
        let figureNum = 1;
        const state = stateManager.getState();
        for (const spread of state.spreads) {
          for (const el of spread.elements) {
            if (el.type === 'text') {
              const txtEl = el as TextElement;
              if (/^figure\b/i.test(txtEl.text.trim())) {
                const rest = txtEl.text.trim().replace(/^figure\s*\d*[:.-]?\s*/i, '');
                stateManager.updateElement(el.id, {
                  text: `Figure ${figureNum}: ${rest}`,
                });
                figureNum++;
              }
            }
          }
        }
        return `Numbered ${figureNum - 1} figures sequentially.`;
      },
    },
  ];

  const handleRunBuiltIn = (script: BuiltInScript) => {
    try {
      const msg = script.execute();
      setStatusMsg(msg);
    } catch (e: any) {
      setStatusMsg(`Error: ${e?.message || 'Script execution failed'}`);
    }
  };

  const handleRunCustom = async () => {
    setIsRunning(true);
    try {
      const { evaluateScript } = await import('../state/scriptRunner');
      const result = evaluateScript(customCode, stateManager.getState());
      const count = stateManager.applyScriptUpdates(result.updates);
      setStatusMsg([...result.messages, `Applied ${count} updates.`].join('\n'));
    } catch (error) {
      setStatusMsg(`No changes applied. ${error instanceof Error ? error.message : 'Script failed.'}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(3px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '520px',
          backgroundColor: '#18181c',
          borderRadius: '8px',
          border: '1px solid #38383e',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #2d2d34', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>
              SCRIPTS & AUTOMATION PANEL
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '10.5px', color: '#8e8e93' }}>
              Run built-in prepress actions or execute custom JavaScript automation
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8e8e93',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid #2d2d34', backgroundColor: '#131316' }}>
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            style={{
              flex: 1,
              padding: '8px',
              fontSize: '11px',
              fontWeight: 600,
              border: 'none',
              borderBottom: activeTab === 'presets' ? '2px solid #0d99ff' : 'none',
              backgroundColor: activeTab === 'presets' ? '#18181c' : 'transparent',
              color: activeTab === 'presets' ? '#ffffff' : '#8e8e93',
              cursor: 'pointer',
            }}
          >
            Built-in Scripts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('custom')}
            style={{
              flex: 1,
              padding: '8px',
              fontSize: '11px',
              fontWeight: 600,
              border: 'none',
              borderBottom: activeTab === 'custom' ? '2px solid #0d99ff' : 'none',
              backgroundColor: activeTab === 'custom' ? '#18181c' : 'transparent',
              color: activeTab === 'custom' ? '#ffffff' : '#8e8e93',
              cursor: 'pointer',
            }}
          >
            Restricted JavaScript
          </button>
        </div>

        <div style={{ padding: '16px 20px', maxHeight: '360px', overflowY: 'auto' }}>
          {statusMsg && (
            <div style={{ padding: '8px 12px', backgroundColor: '#0d99ff1a', border: '1px solid #0d99ff44', borderRadius: '4px', color: '#0d99ff', fontSize: '11px', marginBottom: '12px' }}>
              {statusMsg}
            </div>
          )}

          {activeTab === 'presets' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {builtInScripts.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#202025',
                    border: '1px solid #303038',
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#f0f0f5' }}>{s.name}</div>
                    <div style={{ fontSize: '10px', color: '#8e8e95', marginTop: '2px' }}>{s.description}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRunBuiltIn(s)}
                    style={{
                      padding: '5px 12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      backgroundColor: '#2b2b33',
                      border: '1px solid #454550',
                      color: '#ffffff',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Run
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: '11px', color: '#a0a0a8', margin: 0 }}>
                Read with stateManager.getState(); edit with stateManager.updateElement(id, updates).
                Supports variables, if, for…of, and basic arithmetic. No files, network, DOM, or arbitrary functions.
                Changes apply together and can be undone.
              </p>
              <textarea
                value={customCode}
                onInput={(e) => setCustomCode((e.target as HTMLTextAreaElement).value)}
                style={{
                  width: '100%',
                  height: '180px',
                  backgroundColor: '#121215',
                  border: '1px solid #303038',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  padding: '10px',
                  outline: 'none',
                  resize: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleRunCustom}
                disabled={isRunning}
                style={{
                  alignSelf: 'flex-end',
                  padding: '6px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: '#0d99ff',
                  border: 'none',
                  color: '#ffffff',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {isRunning ? 'Running…' : 'Execute Script'}
              </button>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #2d2d34', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#131316' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: '11px',
              backgroundColor: '#232328',
              border: '1px solid #3c3c44',
              color: '#d1d1d6',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
