/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import { stateManager, FindChangeQuery, FindResult } from '../state';

interface FindChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GREP_PRESETS = [
  { label: 'Insert GREP Expression...', pattern: '' },
  { label: 'Any Digit (\\d+)', pattern: '\\d+' },
  { label: 'Multiple Spaces (\\s{2,})', pattern: '\\s{2,}' },
  { label: 'Trailing Whitespace (\\s+$)', pattern: '\\s+$' },
  { label: 'Email Address', pattern: '[\\w.-]+@[\\w.-]+\\.[a-z]{2,}' },
  { label: 'Curly / Straight Quotes', pattern: '["\']' },
  { label: 'Phone Number (US)', pattern: '\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b' },
  { label: 'Web URL', pattern: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*' },
];

export function FindChangeModal({ isOpen, onClose }: FindChangeModalProps) {
  if (!isOpen) return null;

  const [findText, setFindText] = useState('');
  const [changeText, setChangeText] = useState('');
  const [isGrep, setIsGrep] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<'document' | 'spread' | 'story'>('document');
  const [activeMatch, setActiveMatch] = useState<FindResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => findInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const getQuery = (): FindChangeQuery => ({
    findText,
    changeText,
    isGrep,
    caseSensitive,
    wholeWord,
    scope,
  });

  const handleFindNext = () => {
    if (!findText.trim()) {
      setStatusMessage('Please enter text or GREP pattern to find.');
      return;
    }

    const next = stateManager.findNext(
      getQuery(),
      activeMatch?.elementId,
      activeMatch ? activeMatch.index + activeMatch.length : undefined
    );

    if (next) {
      setActiveMatch(next);
      setStatusMessage(`Found match ${next.currentMatchIndex} of ${next.totalMatches}`);
    } else {
      setActiveMatch(null);
      setStatusMessage('No matching text found in specified scope.');
    }
  };

  const handleChange = () => {
    if (!activeMatch) {
      handleFindNext();
      return;
    }

    const success = stateManager.change(getQuery(), activeMatch);
    if (success) {
      setStatusMessage('Replaced 1 occurrence.');
      // Find next automatically after change
      const next = stateManager.findNext(
        getQuery(),
        activeMatch.elementId,
        activeMatch.index
      );
      setActiveMatch(next);
      if (next) {
        setStatusMessage(`Replaced. Next match ${next.currentMatchIndex} of ${next.totalMatches}`);
      }
    }
  };

  const handleChangeFind = () => {
    handleChange();
  };

  const handleChangeAll = () => {
    if (!findText.trim()) {
      setStatusMessage('Please enter text or pattern to replace.');
      return;
    }

    const result = stateManager.changeAll(getQuery());
    setActiveMatch(null);
    setStatusMessage(
      `Search complete. Replaced ${result.replacementsCount} occurrence(s) across ${result.elementsAffected} text frame(s).`
    );
  };

  const handleGrepPresetSelect = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) {
      setFindText(val);
      setIsGrep(true);
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
        background: 'rgba(0, 0, 0, 0.45)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#222226',
          border: '1px solid #3d3d42',
          borderRadius: '8px',
          width: '520px',
          maxWidth: '92vw',
          padding: '18px 22px',
          color: '#e6e6e6',
          boxShadow: '0 12px 35px rgba(0,0,0,0.65)',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid #333',
            paddingBottom: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>
              Find / Change
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '3px',
                background: isGrep ? 'rgba(230, 0, 126, 0.2)' : 'rgba(13, 153, 255, 0.2)',
                color: isGrep ? '#ff40a1' : '#0d99ff',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {isGrep ? 'GREP Mode' : 'Text Mode'}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ fontSize: '11px', color: '#aaa', fontWeight: 500 }}>Find what:</label>
              <select
                onChange={handleGrepPresetSelect}
                style={{
                  background: '#161618',
                  border: '1px solid #38383e',
                  color: '#0d99ff',
                  fontSize: '10px',
                  borderRadius: '3px',
                  padding: '1px 4px',
                  cursor: 'pointer',
                }}
              >
                {GREP_PRESETS.map((p) => (
                  <option key={p.label} value={p.pattern}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              ref={findInputRef}
              type="text"
              value={findText}
              onInput={(e) => setFindText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFindNext();
                if (e.key === 'Escape') onClose();
              }}
              placeholder={isGrep ? 'Regular expression pattern (e.g. \\b\\d+\\b)' : 'Text to find...'}
              style={{
                width: '100%',
                background: '#141416',
                border: '1px solid #38383e',
                borderRadius: '4px',
                color: '#fff',
                padding: '7px 10px',
                fontSize: '12px',
                fontFamily: isGrep ? 'monospace' : 'inherit',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#aaa', fontWeight: 500, marginBottom: '4px' }}>
              Change to:
            </label>
            <input
              type="text"
              value={changeText}
              onInput={(e) => setChangeText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleChange();
                if (e.key === 'Escape') onClose();
              }}
              placeholder={isGrep ? 'Replacement or backreferences ($1, $2)' : 'Replacement text...'}
              style={{
                width: '100%',
                background: '#141416',
                border: '1px solid #38383e',
                borderRadius: '4px',
                color: '#fff',
                padding: '7px 10px',
                fontSize: '12px',
                fontFamily: isGrep ? 'monospace' : 'inherit',
                outline: 'none',
              }}
            />
          </div>

          {/* Options & Scope */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '4px',
              padding: '10px 12px',
              background: '#19191d',
              borderRadius: '6px',
            }}
          >
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '11px' }}>
                <input
                  type="checkbox"
                  checked={isGrep}
                  onChange={(e) => setIsGrep((e.target as HTMLInputElement).checked)}
                />
                GREP
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '11px' }}>
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive((e.target as HTMLInputElement).checked)}
                />
                Match Case
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '11px' }}>
                <input
                  type="checkbox"
                  checked={wholeWord}
                  disabled={isGrep}
                  onChange={(e) => setWholeWord((e.target as HTMLInputElement).checked)}
                />
                Whole Word
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#888' }}>Search:</span>
              <select
                value={scope}
                onChange={(e) => setScope((e.target as HTMLSelectElement).value as any)}
                style={{
                  background: '#141416',
                  border: '1px solid #38383e',
                  color: '#e6e6e6',
                  fontSize: '11px',
                  borderRadius: '3px',
                  padding: '2px 6px',
                }}
              >
                <option value="document">Entire Document</option>
                <option value="spread">Current Spread</option>
                <option value="story">Selected Story</option>
              </select>
            </div>
          </div>

          {/* Status readout */}
          {statusMessage && (
            <div
              style={{
                fontSize: '11px',
                color: statusMessage.includes('No matching') ? '#f87171' : '#38bdf8',
                padding: '4px 6px',
                borderRadius: '3px',
                background: 'rgba(0,0,0,0.25)',
              }}
            >
              {statusMessage}
            </div>
          )}

          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '6px',
            }}
          >
            <button
              onClick={handleFindNext}
              style={{
                background: '#2a2a30',
                border: '1px solid #4a4a54',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              Find Next
            </button>
            <button
              onClick={handleChange}
              style={{
                background: '#2a2a30',
                border: '1px solid #4a4a54',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              Change
            </button>
            <button
              onClick={handleChangeFind}
              style={{
                background: '#2a2a30',
                border: '1px solid #4a4a54',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              Change / Find
            </button>
            <button
              onClick={handleChangeAll}
              style={{
                background: '#0d99ff',
                border: '1px solid #0d99ff',
                color: '#fff',
                padding: '6px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              Change All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
