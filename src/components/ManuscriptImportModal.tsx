import { useRef, useState } from 'preact/hooks';
import type { IngestedStory } from '../contentImport';
import { mapManuscriptStyles } from '../contentImport';
import type { ProjectState, StoryContent, TextElement } from '../types';
import { StoryPreview } from './StoryPreview';
import { useModalFocus } from '../hooks/useModalFocus';
import type { ImportedNote } from '../contentImport';
import { stateManager } from '../state';
import { assembleManuscriptUpdate, compareManuscripts, manuscriptParagraphText, protectedHeadingIds } from '../engine/manuscriptUpdates';
import { captureLayout, compareLayouts } from '../engine/layoutChanges';
import { storyText } from '../engine/storyContent';
import { LayoutChangeSummary } from './LayoutChangeSummary';
import './manuscript.css';

export function ManuscriptImportModal({ manuscript, fileName, frame, state, onPlace, onUpdate, onClose }: {
  manuscript: IngestedStory; fileName: string; frame: TextElement; state: ProjectState;
  onPlace: (content: StoryContent) => void;
  onUpdate?: (content: StoryContent, notes: ImportedNote[]) => void;
  onClose: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => Object.fromEntries(
    (manuscript.sourceStyles || []).map(style => [style.name,
      state.paragraphStyles.some(s => s.id === style.suggestedStyleId) ? style.suggestedStyleId : state.paragraphStyles[0]?.id || ''])));
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ before: StoryContent; changes: ReturnType<typeof compareManuscripts>; revision: number }>();
  const [selected, setSelected] = useState(new Set<number>());
  const [layout, setLayout] = useState<ReturnType<typeof compareLayouts>>();
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(true, dialog);
  const content = mapManuscriptStyles(manuscript, mapping);
  return <div className="manuscript-overlay" onClick={onClose} onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  }}>
    <section ref={dialog} className="manuscript-dialog" role="dialog" aria-modal="true" aria-label="Import manuscript" onClick={e => e.stopPropagation()}>
      <header className="manuscript-header"><div><h2>Import manuscript</h2><p>{fileName} · {manuscript.wordCount.toLocaleString()} words · {content.paragraphs.length} paragraphs</p></div>
        <button className="sm-btn" onClick={onClose}>Cancel</button></header>
      <div className="manuscript-body">
        <aside className="manuscript-options"><h3>Map paragraph styles</h3><p>Choose how manuscript styles appear in this publication.</p>
          {(manuscript.sourceStyles || []).map(source => <label className="manuscript-style-map" key={source.name}>
            <span>{source.name} <small>({source.paragraphCount})</small></span>
            <select aria-label={`Map ${source.name}`} disabled={!!review} value={mapping[source.name]} onChange={e => setMapping({ ...mapping, [source.name]: e.currentTarget.value })}>
              {!state.paragraphStyles.length && <option value="">Frame default</option>}
              {state.paragraphStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
            </select></label>)}
          {!!manuscript.warnings?.length && <div className="manuscript-warnings"><h3>Review after import</h3><ul>{manuscript.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
          {!!manuscript.notes?.length && <details><summary>Imported notes ({manuscript.notes.length})</summary><ol>{manuscript.notes.map(note => <li key={note.id}><strong>{note.kind === 'endnote' ? 'Endnote' : 'Footnote'}</strong><p>{note.text || '[Missing note body]'}</p></li>)}</ol></details>}
        </aside>
        {review ? <div className="manuscript-preview" aria-label="Manuscript changes">
          <h3>Review manuscript changes</h3>
          {!review.changes.length && <p>The manuscript text and note bodies match the current story.</p>}
          {review.changes.map((change, index) => <section key={index} className="revision-draft">
            <label><input type="checkbox" checked={selected.has(index)} onChange={event => {
              const next = new Set(selected);
              if (event.currentTarget.checked) next.add(index);
              else next.delete(index);
              setSelected(next);
              setLayout(undefined);
            }}/>{change.conflict ? 'Replace this section and its affected anchors' : 'Apply this change'} · Paragraph {change.start + 1}</label>
            {change.conflict && <p role="status">This section contains or is targeted by a note, reference, or index marker. Leave it unchecked to keep the current section.</p>}
            <div className="revision-comparison">
              <div><small>Current</small><pre>{manuscriptParagraphText(review.before.paragraphs.slice(change.start, change.end)) || '(Insertion)'}</pre></div>
              <div><small>Revised</small><pre>{manuscriptParagraphText(change.paragraphs) || '(Deletion)'}</pre></div>
            </div>
          </section>)}
          {layout && <><p>Preview uses the current frame chain. Automatic pagination runs when you apply the changes.</p>
            <LayoutChangeSummary result={layout}/></>}
        </div> : <StoryPreview content={content} frame={frame} state={state} />}
      </div>
      <footer className="manuscript-footer"><div><p>{review ? 'Checked changes apply together in one undo step.' : 'Place manuscript replaces the entire story. Review changes to merge selected passages.'}</p>{error && <p role="alert">{error}</p>}</div>
        {review ? <div className="publication-actions">
          <button className="sm-btn" onClick={() => { setReview(undefined); setLayout(undefined); setError(''); }}>Back to style mapping</button>
          <button className="sm-btn" disabled={!selected.size} onClick={() => {
            try {
              if (review.revision !== stateManager.getDocumentRevision()) throw new Error('The document changed. Open a fresh manuscript preview.');
              const result = assembleManuscriptUpdate(review.before, review.changes, selected, manuscript.notes || []);
              const head = stateManager.getStoryHead(frame.id);
              if (!head) throw new Error('The story frame is no longer available.');
              const original = stateManager.getState();
              const draft = structuredClone(original);
              const target = draft.spreads.flatMap(spread => spread.elements).find(element => element.id === head.id);
              if (target?.type !== 'text') throw new Error('The story frame is no longer available.');
              const noteIds = (story: StoryContent) => new Set(story.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.noteId)));
              const before = noteIds(review.before), after = noteIds(result.content);
              draft.settings.footnotes = [...(draft.settings.footnotes || []).filter(note => !before.has(note.id) || after.has(note.id)),
                ...result.notes.map(note => ({ ...note, number: 1, anchorVersion: 1 as const, elementId: head.id, pageId: head.pageId }))];
              target.storyContent = result.content;
              target.rawStoryText = storyText(result.content);
              setLayout(compareLayouts(captureLayout(original), captureLayout(draft)));
              setError('');
            } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          }}>Preview layout changes</button>
          <button className="action-btn" disabled={!selected.size} onClick={() => {
            try {
              const result = assembleManuscriptUpdate(review.before, review.changes, selected, manuscript.notes || []);
              onUpdate?.(result.content, result.notes);
            } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          }}>Apply selected changes</button>
        </div> : <div className="publication-actions">
          {onUpdate && <button className="sm-btn" onClick={() => {
            const before = structuredClone(stateManager.getStoryContent(frame.id));
            const changes = compareManuscripts(before, content, state.settings.footnotes || [], manuscript.notes || [], protectedHeadingIds(state));
            setSelected(new Set(changes.flatMap((change, index) => change.conflict ? [] : [index])));
            setReview({ before, changes, revision: stateManager.getDocumentRevision() });
            setError('');
          }}>Review manuscript changes</button>}
          <button className="action-btn" onClick={() => { try { onPlace(content); } catch (e) { setError(e instanceof Error ? e.message : 'Could not place manuscript.'); } }}>Place manuscript</button>
        </div>}</footer>
    </section>
  </div>;
}
