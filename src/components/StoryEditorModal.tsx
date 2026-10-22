/**
 * Recto Studio — Story Focus / Distraction-Free Typewriter Editor (Ctrl+Y)
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useEffect } from 'preact/hooks';
import { ProjectState, TextElement } from '../types';
import { stateManager } from '../state';

interface StoryEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: ProjectState;
}

export function StoryEditorModal({ isOpen, onClose, state }: StoryEditorModalProps) {
  if (!isOpen) return null;

  const spread = stateManager.getActiveSpread();
  const textElements = spread.elements.filter((el): el is TextElement => el.type === 'text');
  const selectedTextEl = textElements.find((el) => el.id === state.selectedElementId) || textElements[0];

  const [currentElementId, setCurrentElementId] = useState<string>(selectedTextEl?.id || '');
  const activeEl = textElements.find((el) => el.id === currentElementId) || selectedTextEl;
  const [editorText, setEditorText] = useState<string>(activeEl?.text || '');
  const [fontSize, setFontSize] = useState<number>(16);

  useEffect(() => {
    if (activeEl) {
      setEditorText(activeEl.text || '');
      setCurrentElementId(activeEl.id);
    }
  }, [activeEl?.id]);

  const words = editorText.trim() ? editorText.trim().split(/\s+/).filter(Boolean).length : 0;
  const chars = editorText.length;
  const paragraphs = editorText.trim() ? editorText.trim().split(/\n+/).filter(Boolean).length : 0;
  const readingTimeMin = Math.max(1, Math.ceil(words / 225));

  const handleTextChange = (newText: string) => {
    setEditorText(newText);
    if (activeEl) {
      stateManager.updateElement(activeEl.id, { text: newText });
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
        backgroundColor: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(5px)',
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
          width: '840px',
          maxWidth: '92vw',
          height: '84vh',
          backgroundColor: '#18181c',
          borderRadius: '8px',
          border: '1px solid #38383e',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #2d2d34',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#141417',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#ffffff', letterSpacing: '0.5px' }}>
              STORY EDITOR (CTRL+Y)
            </span>
            {textElements.length > 1 && (
              <select
                value={currentElementId}
                onChange={(e) => setCurrentElementId((e.target as HTMLSelectElement).value)}
                style={{
                  background: '#23232a',
                  border: '1px solid #38383e',
                  color: '#e0e0e0',
                  fontSize: '11px',
                  borderRadius: '4px',
                  padding: '3px 8px',
                }}
              >
                {textElements.map((el, i) => (
                  <option key={el.id} value={el.id}>
                    Frame {i + 1}: {el.text.slice(0, 24) || 'Empty'}...
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#8e8e93' }}>
              <span>Font:</span>
              <button
                onClick={() => setFontSize(Math.max(12, fontSize - 2))}
                style={{ background: '#23232a', border: '1px solid #38383e', color: '#fff', borderRadius: '3px', padding: '1px 6px', cursor: 'pointer' }}
              >
                -
              </button>
              <span style={{ minWidth: '22px', textAlign: 'center' }}>{fontSize}</span>
              <button
                onClick={() => setFontSize(Math.min(32, fontSize + 2))}
                style={{ background: '#23232a', border: '1px solid #38383e', color: '#fff', borderRadius: '3px', padding: '1px 6px', cursor: 'pointer' }}
              >
                +
              </button>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8e8e93',
                fontSize: '16px',
                cursor: 'pointer',
                padding: '2px 6px',
              }}
              title="Close Story Editor (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Text Area */}
        <div style={{ flex: 1, padding: '24px 32px', display: 'flex', flexDirection: 'column', backgroundColor: '#18181c' }}>
          <textarea
            value={editorText}
            onInput={(e) => handleTextChange((e.target as HTMLTextAreaElement).value)}
            placeholder="Write manuscript story here... Canvas updates in real time."
            style={{
              flex: 1,
              width: '100%',
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: '#f0f0f2',
              fontSize: `${fontSize}px`,
              lineHeight: 1.65,
              fontFamily: activeEl?.fontFamily ? `${activeEl.fontFamily}, Georgia, serif` : 'Georgia, serif',
            }}
          />
        </div>

        {/* Footer Stats */}
        <div
          style={{
            padding: '10px 20px',
            borderTop: '1px solid #2d2d34',
            backgroundColor: '#141417',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            color: '#8e8e93',
          }}
        >
          <div style={{ display: 'flex', gap: '14px' }}>
            <span><b>{words}</b> words</span>
            <span>•</span>
            <span><b>{chars}</b> characters</span>
            <span>•</span>
            <span><b>{paragraphs}</b> paragraphs</span>
            <span>•</span>
            <span>~<b>{readingTimeMin}</b> min read</span>
          </div>
          <span style={{ color: '#2ec4b6' }}>● Live Canvas Sync Active</span>
        </div>
      </div>
    </div>
  );
}
