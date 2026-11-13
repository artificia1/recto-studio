/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import { stateManager, FindChangeQuery, FindResult } from '../state';
import { useModalFocus } from '../hooks/useModalFocus';
import './editorDialogs.css';

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
  const [findText, setFindText] = useState('');
  const [changeText, setChangeText] = useState('');
  const [isGrep, setIsGrep] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [paragraphStyleId, setParagraphStyleId] = useState('');
  const [characterStyleId, setCharacterStyleId] = useState('');
  const [scope, setScope] = useState<'document' | 'spread' | 'story'>('document');
  const [activeMatch, setActiveMatch] = useState<FindResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const findInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus(isOpen, dialogRef);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => findInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);
  if (!isOpen) return null;

  const getQuery = (): FindChangeQuery => ({
    findText,
    changeText,
    isGrep,
    caseSensitive,
    wholeWord,
    scope,
    paragraphStyleId: paragraphStyleId || undefined,
    characterStyleId: characterStyleId || undefined,
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

    try {
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
    } catch (reason) { setStatusMessage(reason instanceof Error ? reason.message : String(reason)); }
  };

  const handleChangeFind = () => {
    handleChange();
  };

  const handleChangeAll = () => {
    if (!findText.trim()) {
      setStatusMessage('Please enter text or pattern to replace.');
      return;
    }

    try {
      const result = stateManager.changeAll(getQuery());
      setActiveMatch(null);
      setStatusMessage(`Search complete. Replaced ${result.replacementsCount} occurrence(s) across ${result.elementsAffected} stories.`);
    } catch (reason) { setStatusMessage(reason instanceof Error ? reason.message : String(reason)); }
  };

  const handleGrepPresetSelect = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) {
      setFindText(val);
      setIsGrep(true);
    }
  };

  return (
    <div className="editor-dialog-backdrop find-change-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        className="modal-dialog editor-dialog find-change-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="find-change-title"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      >
        <header className="editor-dialog-header">
          <div className="find-change-title">
            <h2 id="find-change-title">Find / Change</h2>
            <span className="editor-dialog-tag" data-grep={isGrep}>{isGrep ? 'GREP Mode' : 'Text Mode'}</span>
          </div>
          <button type="button" className="editor-dialog-close" aria-label="Close Find / Change" onClick={onClose}>×</button>
        </header>

        <div className="editor-dialog-fields">
          <div className="editor-dialog-field">
            <div className="editor-dialog-field-heading">
              <label htmlFor="find-change-text">Find what</label>
              <select aria-label="GREP expression presets" onChange={handleGrepPresetSelect}>
                {GREP_PRESETS.map(preset => (
                  <option key={preset.label} value={preset.pattern}>{preset.label}</option>
                ))}
              </select>
            </div>
            <input
              ref={findInputRef}
              id="find-change-text"
              type="text"
              value={findText}
              onInput={event => setFindText(event.currentTarget.value)}
              onKeyDown={event => { if (event.key === 'Enter') handleFindNext(); }}
              placeholder={isGrep ? 'Regular expression pattern (e.g. \\b\\d+\\b)' : 'Text to find...'}
              className={isGrep ? 'find-change-grep-field' : undefined}
            />
          </div>

          <label className="editor-dialog-field">
            Change to
            <input
              type="text"
              value={changeText}
              onInput={event => setChangeText(event.currentTarget.value)}
              onKeyDown={event => { if (event.key === 'Enter') handleChange(); }}
              placeholder={isGrep ? 'Replacement or backreferences ($1, $2)' : 'Replacement text...'}
              className={isGrep ? 'find-change-grep-field' : undefined}
            />
          </label>

          <div className="find-change-options">
            <div className="find-change-options-group">
              <label>
                <input type="checkbox" checked={isGrep} onChange={event => setIsGrep(event.currentTarget.checked)} />
                GREP
              </label>
              <label>
                <input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.currentTarget.checked)} />
                Match Case
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={wholeWord}
                  disabled={isGrep}
                  onChange={event => setWholeWord(event.currentTarget.checked)}
                />
                Whole Word
              </label>
            </div>
            <label className="find-change-scope">
              Search
              <select value={scope} onChange={event => setScope(event.currentTarget.value as typeof scope)}>
                <option value="document">Entire Document</option>
                <option value="spread">Current Spread</option>
                <option value="story">Selected Story</option>
              </select>
            </label>
          </div>

          <div className="find-change-style-fields">
            <label className="editor-dialog-field">
              Paragraph style
              <select
                aria-label="Find paragraph style"
                value={paragraphStyleId}
                onChange={event => { setParagraphStyleId(event.currentTarget.value); setActiveMatch(null); }}
              >
                <option value="">Any</option>
                {stateManager.getState().paragraphStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
              </select>
            </label>
            <label className="editor-dialog-field">
              Character style
              <select
                aria-label="Find character style"
                value={characterStyleId}
                onChange={event => { setCharacterStyleId(event.currentTarget.value); setActiveMatch(null); }}
              >
                <option value="">Any</option>
                {stateManager.getState().characterStyles?.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
              </select>
            </label>
          </div>

          {statusMessage && <div className="editor-dialog-message" role="status">{statusMessage}</div>}
        </div>

        <footer className="editor-dialog-actions">
          <button type="button" className="action-btn" onClick={handleFindNext}>Find Next</button>
          <button type="button" className="action-btn" onClick={handleChange}>Change</button>
          <button type="button" className="action-btn" onClick={handleChangeFind}>Change / Find</button>
          <button type="button" className="action-btn-primary" onClick={handleChangeAll}>Change All</button>
        </footer>
      </section>
    </div>
  );
}
