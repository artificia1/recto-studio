import { useRef, useState } from 'preact/hooks';
import type { IngestedStory } from '../contentImport';
import { mapManuscriptStyles } from '../contentImport';
import type { ProjectState, StoryContent, TextElement } from '../types';
import { StoryPreview } from './StoryPreview';
import { useModalFocus } from '../hooks/useModalFocus';
import './manuscript.css';

export function ManuscriptImportModal({ manuscript, fileName, frame, state, onPlace, onClose }: {
  manuscript: IngestedStory; fileName: string; frame: TextElement; state: ProjectState;
  onPlace: (content: StoryContent) => void; onClose: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => Object.fromEntries(
    (manuscript.sourceStyles || []).map(style => [style.name,
      state.paragraphStyles.some(s => s.id === style.suggestedStyleId) ? style.suggestedStyleId : state.paragraphStyles[0]?.id || ''])));
  const [error, setError] = useState('');
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
            <select aria-label={`Map ${source.name}`} value={mapping[source.name]} onChange={e => setMapping({ ...mapping, [source.name]: e.currentTarget.value })}>
              {!state.paragraphStyles.length && <option value="">Frame default</option>}
              {state.paragraphStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
            </select></label>)}
          {!!manuscript.warnings?.length && <div className="manuscript-warnings"><h3>Review after import</h3><ul>{manuscript.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
        </aside>
        <StoryPreview content={content} frame={frame} state={state} />
      </div>
      <footer className="manuscript-footer"><div><p>Replaces the selected frame’s entire story, including linked frames. You can undo this action.</p>{error && <p role="alert">{error}</p>}</div>
        <button className="action-btn" onClick={() => { try { onPlace(content); } catch (e) { setError(e instanceof Error ? e.message : 'Could not place manuscript.'); } }}>Place manuscript</button></footer>
    </section>
  </div>;
}
