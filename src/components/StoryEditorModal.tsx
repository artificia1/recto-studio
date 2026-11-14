/**
 * Recto Studio — Story Focus / Distraction-Free Typewriter Editor (Ctrl+Alt+Y)
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useEffect, useRef } from 'preact/hooks';
import { ProjectState, StoryContent, TextElement } from '../types';
import { stateManager } from '../state';
import { sliceStory, storyText } from '../engine/storyContent';
import { StoryPreview } from './StoryPreview';
import { useModalFocus } from '../hooks/useModalFocus';
import './manuscript.css';
import { StoryReferenceTools } from './StoryReferenceTools';
import { StoryRevisionsPanel } from './StoryRevisionsPanel';
import { manuscriptEditRange } from '../engine/manuscriptUpdates';

interface StoryEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: ProjectState;
}

export function StoryEditorModal({ isOpen, onClose, state }: StoryEditorModalProps) {
  const textElements = state.spreads.flatMap(spread => spread.elements).filter((el): el is TextElement => el.type === 'text' && !el.prevFrameId);
  const selectedTextEl = stateManager.getStoryHead(state.selectedElementId || '') || textElements[0];

  const [currentElementId, setCurrentElementId] = useState<string>(selectedTextEl?.id || '');
  const activeEl = textElements.find((el) => el.id === currentElementId) || selectedTextEl;
  const [editorText, setEditorText] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(16);
  const [spellcheck, setSpellcheck] = useState(true);
  const [tracking, setTracking] = useState<{ id: string; before: StoryContent }>();
  const [reviewer, setReviewer] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(isOpen, dialogRef);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const captureSelection = () => {
    const input = textareaRef.current;
    if (input) setSelection({ start: input.selectionStart, end: input.selectionEnd });
  };
  const [styleName, setStyleName] = useState('');
  const [error, setError] = useState('');
  const [layingOut, setLayingOut] = useState(false);
  const pending = useRef<{ id: string; text: string; session: number; revision: number;
    timer: ReturnType<typeof setTimeout>; controller: AbortController }>();
  const content = stateManager.getStoryContent(activeEl?.id || '');
  const trackedText = tracking && storyText(tracking.before);
  const trackedEdit = trackedText !== undefined ? manuscriptEditRange(trackedText, editorText) : null;
  const discardDraft = () => !trackedEdit || confirm('Discard the unsaved tracked edit?');
  const cancelLayout = () => {
    const edit = pending.current;
    if (edit) {
      clearTimeout(edit.timer);
      edit.controller.abort();
      pending.current = undefined;
    }
    return edit;
  };
  const reportError = (id: string, reason: unknown) => {
    setEditorText(storyText(stateManager.getStoryContent(id)));
    setError(reason instanceof Error ? reason.message : 'Could not edit story.');
  };
  const flushLayout = () => {
    const edit = cancelLayout();
    if (!edit) return;
    setLayingOut(false);
    if (edit.session !== stateManager.getDocumentSession() || edit.revision !== stateManager.getDocumentRevision()) {
      throw new Error('The document changed during layout. Review the latest manuscript before applying this edit.');
    }
    stateManager.setStoryText(edit.id, edit.text);
  };
  const closeEditor = () => {
    if (!discardDraft()) return;
    try { flushLayout(); onClose(); }
    catch (reason) { if (activeEl) reportError(activeEl.id, reason); }
  };
  const activeParagraph = storyText(content).slice(0, selection.start).split('\n').length - 1;
  const selectedContent = sliceStory(content, selection.start, selection.end);
  const selectedRun = selectedContent.paragraphs[0]?.runs[0];
  const named = state.characterStyles?.find(style => style.id === selectedRun?.characterStyleId);
  const marks = { ...named, ...selectedRun };
  const restoreSelection = () => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(selection.start, selection.end);
  };
  const apply = (action: () => void) => {
    try { flushLayout(); action(); setError(''); restoreSelection(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not edit story.'); }
  };

  useEffect(() => () => { cancelLayout(); }, [isOpen, stateManager.getDocumentSession()]);
  useEffect(() => {
    if (isOpen) { setCurrentElementId(selectedTextEl?.id || ''); setSelection({ start: 0, end: 0 }); setTracking(undefined); }
  }, [isOpen]);
  useEffect(() => {
    if (isOpen && activeEl && !tracking && !pending.current) {
      setEditorText(storyText(stateManager.getStoryContent(activeEl.id)));
    }
  }, [isOpen, activeEl?.id, activeEl?.text, activeEl?.rawStoryText, tracking]);
  if (!isOpen) return null;

  const words = editorText.trim() ? editorText.trim().split(/\s+/).filter(Boolean).length : 0;
  const chars = editorText.length;
  const paragraphs = editorText.trim() ? editorText.trim().split(/\n+/).filter(Boolean).length : 0;
  const readingTimeMin = Math.max(1, Math.ceil(words / 225));

  const handleTextChange = (newText: string) => {
    setEditorText(newText);
    if (tracking || !activeEl) return;
    const previous = cancelLayout();
    const { id, rawStoryText, storyContent, nextFrameId, autoExtendStory } = activeEl;
    if (previous && (previous.session !== stateManager.getDocumentSession() || previous.revision !== stateManager.getDocumentRevision())) {
      setLayingOut(false);
      reportError(id, new Error('The document changed during layout. Review the latest manuscript before applying this edit.'));
      return;
    }
    if (!nextFrameId || !storyContent || autoExtendStory || state.settings.footnotes?.length ||
      Math.max(newText.length, rawStoryText?.length || 0) < 8000 || typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
      setLayingOut(false);
      try { stateManager.setStoryText(id, newText); setError(''); }
      catch (reason) { reportError(id, reason); }
      return;
    }
    const controller = new AbortController();
    setLayingOut(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const edit = pending.current;
        if (!edit || edit.controller !== controller) return;
        if (edit.session !== stateManager.getDocumentSession() || edit.revision !== stateManager.getDocumentRevision()) {
          throw new Error('The document changed during layout. Review the latest manuscript before applying this edit.');
        }
        await stateManager.setStoryTextInBackground(id, newText, controller.signal);
        if (!controller.signal.aborted) setEditorText(storyText(stateManager.getStoryContent(id)));
      } catch (reason) {
        if (!controller.signal.aborted) reportError(id, reason);
      } finally {
        if (pending.current?.controller === controller) {
          pending.current = undefined;
          setLayingOut(false);
        }
      }
    }, 150);
    pending.current = { id, text: newText, session: stateManager.getDocumentSession(),
      revision: stateManager.getDocumentRevision(), controller, timer };
  };

  return (
    <div
      className="story-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Story Editor"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeEditor();
        }
      }}
      onClick={closeEditor}
    >
      <div
        className="modal-dialog manuscript-dialog story-editor-dialog"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="story-editor-header">
          <div className="story-editor-heading">
            <h2>Story Editor</h2>
            {textElements.length > 1 && (
              <select
                aria-label="Choose story"
                value={currentElementId}
                onChange={event => {
                  if (!discardDraft()) { event.currentTarget.value = activeEl?.id || ''; return; }
                  setTracking(undefined);
                  setCurrentElementId(event.currentTarget.value);
                }}
              >
                {textElements.map((el, i) => (
                  <option key={el.id} value={el.id}>
                    Story {i + 1}: {(el.rawStoryText ?? el.text).slice(0, 24) || 'Empty'}...
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="story-editor-size" role="group" aria-label="Editor text size">
            <button type="button" className="sm-btn" aria-label="Decrease editor text size"
              onClick={() => setFontSize(Math.max(12, fontSize - 2))}>−</button>
            <span>{fontSize}px</span>
            <button type="button" className="sm-btn" aria-label="Increase editor text size"
              onClick={() => setFontSize(Math.min(32, fontSize + 2))}>+</button>
          </div>
          <button type="button" className="modal-close-btn" title="Close Story Editor (Esc)"
            aria-label="Close Story Editor" onClick={closeEditor}>×</button>
        </header>

        {activeEl && !activeEl.generated && <div className="story-format-bar">
          <label><input type="checkbox" checked={!!tracking} onChange={event => {
            if (event.currentTarget.checked) setTracking({ id: activeEl.id, before: structuredClone(content) });
            else if (discardDraft()) setTracking(undefined);
            else event.currentTarget.checked = true;
          }}/>Track manuscript edits</label>
          {tracking && <>
            <label>Reviewer <input value={reviewer} maxLength={100} onInput={event => setReviewer(event.currentTarget.value)}/></label>
            <button className="sm-btn" disabled={!trackedEdit || !reviewer.trim() || activeEl.id !== tracking.id} onClick={() => {
              if (!trackedEdit) return;
              try {
                stateManager.proposeStoryRevision(tracking.id, tracking.before, trackedEdit.start, trackedEdit.end, trackedEdit.replacement, reviewer);
                setEditorText(trackedText!);
                setTracking(undefined);
                setError('');
              } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
            }}>Save tracked edit for review</button>
          </>}
        </div>}
        {!tracking && <div className="story-format-bar">
          <label><input type="checkbox" checked={spellcheck} onChange={event => setSpellcheck(event.currentTarget.checked)}/>Spellcheck</label>
          <label>Paragraph <select aria-label="Paragraph style" disabled={!activeEl} value={selectedContent.paragraphs[0]?.styleId || ''}
            onChange={e => activeEl && apply(() => stateManager.styleStoryRange(activeEl.id, selection.start, selection.end, e.currentTarget.value))}>
            <option value="" disabled>Frame default</option>
            {state.paragraphStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
          </select></label>
          {(['bold', 'italic', 'underline'] as const).map(mark => <button key={mark} className="sm-btn"
            aria-label={mark[0].toUpperCase() + mark.slice(1)} aria-pressed={!!marks[mark]}
            disabled={!activeEl || selection.start === selection.end}
            onMouseDown={e => e.preventDefault()} onClick={() => activeEl && apply(() => stateManager.formatStoryRange(activeEl.id, selection.start, selection.end, { [mark]: !marks[mark] }))}>
            {mark === 'bold' ? <b>B</b> : mark === 'italic' ? <i>I</i> : <u>U</u>}
          </button>)}
          <label>Character <select aria-label="Character style" value={selectedRun?.characterStyleId || ''}
            disabled={!activeEl || selection.start === selection.end} onChange={e => activeEl && apply(() => stateManager.formatStoryRange(activeEl.id, selection.start, selection.end,
              { characterStyleId: e.currentTarget.value || undefined, bold: undefined, italic: undefined, underline: undefined }))}>
            <option value="">None</option>{state.characterStyles?.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
          </select></label>
          <input aria-label="New character style name" placeholder="Character style name" value={styleName} onInput={e => setStyleName(e.currentTarget.value)} style={{ width: '145px' }} />
          <button className="sm-btn" disabled={!activeEl || !styleName.trim() || selection.start === selection.end} onClick={() => activeEl && apply(() => {
            const id = `character-${Date.now()}`;
            stateManager.createCharacterStyle({ id, name: styleName.trim(), bold: !!marks.bold, italic: !!marks.italic, underline: !!marks.underline });
            stateManager.formatStoryRange(activeEl.id, selection.start, selection.end, { characterStyleId: id, bold: undefined, italic: undefined, underline: undefined });
            setStyleName('');
          })}>Save style</button>
        </div>}
        {error && <p role="alert" style={{ padding: '8px 20px' }}>{error}</p>}
        {activeEl && !activeEl.generated && !tracking && !!state.conditions?.length && <label className="story-format-bar">Edition of paragraph at cursor <select aria-label="Paragraph edition"
          value={content.paragraphs[activeParagraph]?.conditionId || ''} onChange={event => {
            const conditionId = event.currentTarget.value || undefined;
            apply(() => stateManager.setStoryContent(activeEl.id, { ...content, paragraphs: content.paragraphs.map((paragraph, index) => index === activeParagraph ? { ...paragraph, conditionId } : paragraph) }));
          }}><option value="">All editions</option>{state.conditions.map(condition => <option key={condition.id} value={condition.id}>{condition.name}</option>)}</select></label>}
        {activeEl && !activeEl.generated && !tracking && <StoryReferenceTools frameId={activeEl.id} start={selection.start} end={selection.end} apply={apply}/>}
        {activeEl && !activeEl.generated && <StoryRevisionsPanel key={activeEl.id} frameId={activeEl.id} state={state} start={selection.start} end={selection.end}/>}
        {activeEl?.generated && <p style={{ padding: '8px 20px' }}>This list updates automatically. Use Pages to make it static before editing its manuscript.</p>}
        {!activeEl && <p style={{ padding: '16px' }}>Select or create a text frame to edit a story.</p>}
        <div className="manuscript-body">
          <textarea
            ref={textareaRef}
            aria-label="Story manuscript"
            spellcheck={spellcheck}
            lang={state.settings.language || 'en-US'}
            readOnly={!!activeEl?.generated}
            className="story-editor-text"
            disabled={!activeEl}
            value={editorText}
            onSelect={captureSelection}
            onKeyUp={captureSelection}
            onMouseUp={captureSelection}
            onBlur={() => {
              try { flushLayout(); }
              catch (reason) { if (activeEl) reportError(activeEl.id, reason); }
              captureSelection();
              stateManager.finishUndoGroup();
            }}
            onInput={event => handleTextChange(event.currentTarget.value)}
            placeholder="Write manuscript story here... Canvas updates in real time."
            style={{
              fontSize: `${fontSize}px`,
              fontFamily: activeEl?.fontFamily ? `${activeEl.fontFamily}, Georgia, serif` : 'Georgia, serif',
            }}
          />
          {activeEl && (tracking ? <div className="manuscript-preview story-tracked-preview" aria-label="Tracked changes preview">
            <p>Tracked text stays out of the layout until you accept its proposal.</p>
            {trackedEdit && <p className="story-tracked-text">
              {trackedText!.slice(Math.max(0, trackedEdit.start - 80), trackedEdit.start)}
              <del>{trackedText!.slice(trackedEdit.start, trackedEdit.end)}</del>
              <ins>{trackedEdit.replacement}</ins>
              {trackedText!.slice(trackedEdit.end, trackedEdit.end + 80)}
            </p>}
          </div> : <StoryPreview content={content} frame={activeEl} state={state} />)}
        </div>

        <footer className="story-editor-footer">
          <div className="story-editor-stats">
            <span><b>{words}</b> words</span>
            <span><b>{chars}</b> characters</span>
            <span><b>{paragraphs}</b> paragraphs</span>
            <span>~<b>{readingTimeMin}</b> min read</span>
          </div>
          {activeEl && !activeEl.generated && <span role="status">{tracking ? 'Tracking draft' : layingOut ? 'Updating layout…' : 'Live canvas sync'}</span>}
        </footer>
      </div>
    </div>
  );
}
