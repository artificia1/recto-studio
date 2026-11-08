import { useState } from 'preact/hooks';
import type { ProjectState, StoryContent } from '../types';
import { stateManager } from '../state';
import { storyText } from '../engine/storyContent';
import { revisionIsStale } from '../engine/storyRevisions';

export function StoryRevisionsPanel({ frameId, state, start, end }: { frameId: string; state: ProjectState; start: number; end: number }) {
  const [draft, setDraft] = useState<{ before: StoryContent; start: number; end: number } | null>(null);
  const [replacement, setReplacement] = useState('');
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const revisions = (state.storyRevisions || []).filter(item => item.storyId === frameId);
  const [expanded, setExpanded] = useState(() => revisions.some(item => item.status === 'pending'));
  const act = (action: () => void) => { try { action(); setMessage(''); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } };
  return <details className="story-revisions" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Proposed revisions ({revisions.filter(item => item.status === 'pending').length} pending)</summary>
    <p>Select a passage in the manuscript, or position the cursor to propose an insertion. Proposals stay out of canvas and exports until accepted.</p>
    <button className="sm-btn" disabled={!!draft} onClick={() => act(() => {
      const before = structuredClone(stateManager.getStoryContent(frameId));
      setDraft({ before, start, end }); setReplacement(storyText(before).slice(start, end));
    })}>Draft edit at selection</button>
    {draft && <div className="revision-draft">
      <label>Reviewer<input aria-label="Revision reviewer" value={author} maxLength={100} onInput={event => setAuthor(event.currentTarget.value)}/></label>
      <label>Original passage<pre>{storyText(draft.before).slice(draft.start, draft.end) || '(Insertion)'}</pre></label>
      <label>Proposed passage<textarea aria-label="Proposed passage" value={replacement} maxLength={200000} rows={3} onInput={event => setReplacement(event.currentTarget.value)}/></label>
      <label>Review note<input value={note} maxLength={2000} onInput={event => setNote(event.currentTarget.value)}/></label>
      <div className="publication-actions"><button className="sm-btn" disabled={!author.trim()} onClick={() => act(() => { stateManager.proposeStoryRevision(frameId, draft.before, draft.start, draft.end, replacement, author, note); setDraft(null); setNote(''); })}>Submit revision</button>
        <button className="sm-btn" onClick={() => setDraft(null)}>Discard draft</button></div>
    </div>}
    <label className="revision-check"><input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.currentTarget.checked)}/>Show accepted and rejected revisions</label>
    <ul>{revisions.filter(item => showResolved || item.status === 'pending').map(item => {
      const stale = item.status === 'pending' && revisionIsStale(item, stateManager.getStoryContent(frameId));
      return <li key={item.id}><strong>{item.author} · {item.status}</strong>{item.note && <p>{item.note}</p>}
        <div className="revision-comparison"><div><small>Original</small><pre>{storyText(item.before).slice(item.start, item.end) || '(Insertion)'}</pre></div><div><small>Proposed</small><pre>{item.replacement || '(Deletion)'}</pre></div></div>
        {stale && <p role="status">The manuscript changed. This proposal needs to be drafted again before acceptance.</p>}
        {item.status === 'pending' && <div className="publication-actions"><button className="sm-btn" disabled={stale} onClick={() => act(() => stateManager.resolveStoryRevision(item.id, 'accepted'))}>Accept revision</button><button className="sm-btn" onClick={() => act(() => stateManager.resolveStoryRevision(item.id, 'rejected'))}>Reject revision</button></div>}
      </li>;
    })}</ul>
    {showResolved && revisions.some(item => item.status !== 'pending') && <button className="sm-btn" onClick={() => act(() => stateManager.removeResolvedStoryRevisions())}>Remove resolved revisions from document</button>}
    {message && <p role="alert">{message}</p>}
  </details>;
}
