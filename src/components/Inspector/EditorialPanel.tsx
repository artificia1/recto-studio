import { useMemo, useState } from 'preact/hooks';
import type { ProjectState } from '../../types';
import { stateManager } from '../../state';
import { editorialOutline, editorialStories, findPublicationPages } from '../../engine/editorialNavigation';
import { reviewPinPosition } from '../../engine/reviewPins';
import EditorialReviewPanel from './EditorialReviewPanel';

export default function EditorialPanel({ state }: { state: ProjectState }) {
  const [query, setQuery] = useState('');
  const [jump, setJump] = useState('');
  const [tab, setTab] = useState<'outline' | 'stories'>('outline');
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [note, setNote] = useState('');
  const [author, setAuthor] = useState('');
  const [editing, setEditing] = useState('');
  const [editText, setEditText] = useState('');
  const [message, setMessage] = useState('');
  const act = (action: () => void) => {
    try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  // Local review drafts must not repeatedly rebuild every manuscript in a long book.
  const outlineEntries = useMemo(() => editorialOutline(state), [state]);
  const storyEntries = useMemo(() => editorialStories(state), [state]);
  const term = query.trim().toLocaleLowerCase();
  const outline = outlineEntries.filter(heading => !term || `${heading.title} ${heading.label}`.toLocaleLowerCase().includes(term));
  const stories = storyEntries.filter(story => !term || `${story.title} ${story.text} ${story.label}`.toLocaleLowerCase().includes(term));
  const matches = findPublicationPages(state, jump);
  const comments = state.comments || [];
  const visible = comments.filter(comment => filter === 'all' || comment.resolved === (filter === 'resolved'));
  return <div className="editorial-panel">
    <EditorialReviewPanel state={state}/>
    <details className="publication-panel" open>
      <summary>Publication navigator</summary>
      <label>Go to page<input value={jump} placeholder="Printed label or physical number" onInput={event => setJump(event.currentTarget.value)}/></label>
      {jump.trim() && <div className="publication-actions">{matches.length ? matches.map(page => <button className="sm-btn" key={page.id} onClick={() => stateManager.setActiveSpread(page.spreadIndex)}>Page {page.label} · physical {page.pageNumber}</button>) : <p>No matching page.</p>}</div>}
      <label>Search publication<input type="search" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Chapter, story text or page label"/></label>
      <div className="publication-actions" role="group" aria-label="Navigation view">
        <button className="sm-btn" aria-pressed={tab === 'outline'} onClick={() => setTab('outline')}>Outline ({outline.length})</button>
        <button className="sm-btn" aria-pressed={tab === 'stories'} onClick={() => setTab('stories')}>Stories ({stories.length})</button>
      </div>
      <ul className="editorial-list" aria-label={tab === 'outline' ? 'Publication outline' : 'Publication stories'}>
        {tab === 'outline' ? outline.map((heading, index) => <li key={heading.paragraphId || `${heading.elementId}-${index}`}>
          <button className="editorial-jump" style={{ paddingLeft: `${8 + (heading.level - 1) * 10}px` }} onClick={() => {
            // The heading can live in a continuation frame rather than its story head.
            const spreadIndex = state.spreads.findIndex(spread => spread.pages.some(page => page.id === heading.pageId));
            const frame = state.spreads[spreadIndex]?.elements.find(element => element.type === 'text' && element.pageId === heading.pageId && (element.id === heading.elementId || stateManager.getStoryHead(element.id)?.id === heading.elementId));
            if (frame) stateManager.zoomToElement(frame.id);
          }}><span>{heading.title}</span><small>{heading.label}</small></button>
        </li>) : stories.map(story => <li key={story.id}><button className="editorial-jump" onClick={() => stateManager.zoomToElement(story.id)}><span>{story.title}<small>{story.words.toLocaleString()} words · {story.frames} {story.frames === 1 ? 'frame' : 'frames'}{story.generated ? ` · ${story.generated}` : ''}</small></span><small>{story.label}</small></button></li>)}
      </ul>
      {!(tab === 'outline' ? outline : stories).length && <p>{query ? 'No matches.' : tab === 'outline' ? 'Assign heading paragraph styles to build the outline.' : 'No text stories yet.'}</p>}
    </details>
    <details className="publication-panel">
      <summary>Review notes ({comments.filter(comment => !comment.resolved).length} open)</summary>
      <p>Review notes stay in the project and do not appear in publication exports. Canvas pins toggle their resolved state.</p>
      <label>Reviewer<input value={author} placeholder="Your name" maxLength={100} onInput={event => setAuthor(event.currentTarget.value)}/></label>
      <label>New review note<textarea rows={3} value={note} maxLength={10000} onInput={event => setNote(event.currentTarget.value)}/></label>
      <button className="sm-btn" disabled={!note.trim()} onClick={() => act(() => {
        const spread = state.spreads[state.activeSpreadIndex];
        const selected = spread.elements.find(element => element.id === state.selectedElementId);
        const pageIndex = selected ? Math.max(0, spread.pages.findIndex(page => page.id === selected.pageId)) : 0;
        stateManager.addComment(state.activeSpreadIndex, pageIndex * state.settings.widthMm + (selected?.x ?? state.settings.margins.insideMm), selected?.y ?? state.settings.margins.topMm, note, author || 'Reviewer');
        setNote('');
      })}>Add review note to active spread</button>
      <label>Show review notes<select value={filter} onChange={event => setFilter(event.currentTarget.value as typeof filter)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
      <ul className="editorial-list review-list">{visible.map(comment => {
        const position = reviewPinPosition(state, comment);
        return <li key={comment.id}>
        <div className="review-heading"><strong>{comment.author}</strong><small>{position ? `Spread ${position.spreadIndex + 1}` : `Proof page ${comment.proofPage || '?'} · Placement needed`} · {comment.resolved ? 'Resolved' : 'Open'}</small></div>
        {editing === comment.id ? <><label>Edit review note<textarea rows={3} maxLength={10000} value={editText} onInput={event => setEditText(event.currentTarget.value)}/></label><div className="publication-actions"><button className="sm-btn" onClick={() => act(() => { stateManager.updateComment(comment.id, editText); setEditing(''); })}>Save review note</button><button className="sm-btn" onClick={() => setEditing('')}>Cancel</button></div></> : <p className="review-text">{comment.text}</p>}
        <div className="publication-actions">
          {position ? <button className="sm-btn" onClick={() => stateManager.setActiveSpread(position.spreadIndex)}>Go to spread</button>
            : comment.proofPage && <button className="sm-btn" onClick={() => act(() => stateManager.placeProofNote(comment.id))}>Place on active page</button>}
          <button className="sm-btn" onClick={() => { setEditing(comment.id); setEditText(comment.text); }}>Edit</button>
          <button className="sm-btn" onClick={() => stateManager.resolveComment(comment.id)}>{comment.resolved ? 'Reopen' : 'Resolve'}</button>
          <button className="sm-btn" onClick={() => { if (window.confirm('Delete this review note?')) stateManager.deleteComment(comment.id); }}>Delete</button>
        </div>
      </li>})}</ul>
      {!visible.length && <p>No {filter === 'all' ? '' : filter} review notes.</p>}
    </details>
    <details className="publication-panel">
      <summary>Manuscript revisions ({(state.storyRevisions || []).filter(item => item.status === 'pending').length} pending)</summary>
      <p>Propose and compare edits in Story Editor. Pending proposals are excluded from publication exports.</p>
      <ul className="editorial-list review-list">{(state.storyRevisions || []).filter(item => item.status === 'pending').map(item => {
        const story = storyEntries.find(story => story.id === item.storyId);
        return <li key={item.id}><strong>{item.author}</strong><p>{story?.title || 'Original story no longer exists'}</p>{item.note && <p>{item.note}</p>}
          <div className="publication-actions">
            <button className="sm-btn" disabled={!story} onClick={() => { stateManager.zoomToElement(item.storyId); window.dispatchEvent(new CustomEvent('recto:open-story-editor')); }}>Review manuscript</button>
            <button className="sm-btn" onClick={() => act(() => stateManager.resolveStoryRevision(item.id, 'rejected'))}>Reject revision</button>
          </div>
        </li>;
      })}</ul>
      {(state.storyRevisions || []).some(item => item.status !== 'pending') && <button className="sm-btn" onClick={() => act(() => stateManager.removeResolvedStoryRevisions())}>Remove resolved revisions</button>}
    </details>
    {message && <p role="alert">{message}</p>}
  </div>;
}
