import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';

export default function ReferencesPanel({ state }: { state: ProjectState }) {
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState('');
  const [text, setText] = useState('');
  const [targetPage, setTargetPage] = useState('');
  const [entryQuery, setEntryQuery] = useState('');
  const markedEntries = (state.indexEntries || []).filter(entry => `${entry.topic} ${entry.authorityCategory || 'index'}`.toLocaleLowerCase().includes(entryQuery.trim().toLocaleLowerCase()));
  const act = (action: () => void, message = 'Publication updated.') => {
    try { action(); setMessage(message); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const head = stateManager.getStoryHead(state.selectedElementId || '');
  const createList = (kind: 'toc' | 'index' | 'endnotes' | 'authorities') => act(() => {
    const spread = targetPage ? state.spreads.find(spread => spread.pages.some(page => page.id === targetPage)) : undefined;
    if (targetPage && (!spread || spread.elements.some(element => element.pageId === targetPage))) throw new Error('Choose an empty page or add a new page at the end.');
    stateManager.createPublicationList(kind, targetPage || undefined); setTargetPage('');
  });
  return <details className="publication-panel"><summary>Contents, notes &amp; references</summary>
    <p>Add notes and reference markers at the manuscript cursor in the Story Editor. Generated lists refresh after edits, page changes and section numbering.</p>
    <label>Publication language<input type="text" value={state.settings.language || 'en'} placeholder="en, de, fr, en-US" onChange={event => act(() => {
      const language = event.currentTarget.value.trim();
      if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) throw new Error('Enter a language code such as en or en-US.');
      stateManager.updateSettings({ language });
    })}/></label>
    <label>Author<input type="text" value={state.settings.author || ''} onChange={event => stateManager.updateSettings({ author: event.currentTarget.value })}/></label>
    <label>New list location<select value={targetPage} onChange={event => setTargetPage(event.currentTarget.value)}>
      <option value="">New page at end</option>
      {state.spreads.flatMap(spread => spread.pages.filter(page => !spread.elements.some(element => element.pageId === page.id)).map(page => <option key={page.id} value={page.id}>Empty page {page.pageNumber}</option>))}
    </select></label>
    <div className="publication-actions">
      <button className="sm-btn" onClick={() => createList('toc')}>Create or update contents</button>
      <button className="sm-btn" onClick={() => createList('index')}>Create or update index</button>
      <button className="sm-btn" onClick={() => createList('endnotes')}>Create or update endnotes</button>
      <button className="sm-btn" onClick={() => createList('authorities')}>Create or update authorities</button>
      <button className="sm-btn" onClick={() => act(() => stateManager.refreshPublicationReferences())}>Refresh references</button>
    </div>
    {head?.generated && <button className="sm-btn" onClick={() => act(() => stateManager.makePublicationListStatic(head.id), 'List is now ordinary editable text and will no longer refresh.')}>Make selected list static</button>}
    <details><summary>Marked text references</summary>
      <p>Unmark removes an authority or index marker while keeping the manuscript text.</p>
      <label>Search marked text references<input value={entryQuery} onInput={event => setEntryQuery(event.currentTarget.value)}/></label>
      <p>Showing {Math.min(100, markedEntries.length)} of {markedEntries.length} matches. Refine the search to find an entry.</p>
      <div className="editorial-list">{markedEntries.slice(0, 100).map(entry => <div className="reference-note" key={entry.id}>
        <strong>{entry.authorityCategory || 'Index'}</strong><p>{entry.topic} · physical page {entry.pageNumber}</p>
        <button className="sm-btn" onClick={() => entry.elementId && stateManager.zoomToElement(entry.elementId)}>Go to citation</button>
        <button className="sm-btn" onClick={() => act(() => stateManager.removeIndexMark(entry.id))}>{entry.authorityCategory ? 'Unmark citation' : 'Unmark index entry'}</button>
      </div>)}</div>
    </details>
    <label>Note numbering<select value={state.settings.footnoteSettings?.scope || 'document'} onChange={event => act(() => stateManager.updateFootnoteSettings({ scope: event.currentTarget.value as 'document' | 'section' | 'page' }))}>
      <option value="document">Continuous</option><option value="section">Restart by section</option><option value="page">Restart by page</option>
    </select></label>
    {(state.settings.footnotes || []).map(note => <div className="reference-note" key={note.id}>
      <strong>{note.kind === 'endnote' ? 'Endnote' : 'Footnote'} {note.number}</strong>
      {editing === note.id ? <><label>Note body<textarea aria-label={`Edit note ${note.number}`} rows={3} value={text} onInput={event => setText(event.currentTarget.value)}/></label>
        <button className="sm-btn" onClick={() => act(() => { stateManager.updateFootnote(note.id, { text }); setEditing(''); })}>Save note</button>
        <button className="sm-btn" onClick={() => setEditing('')}>Cancel edit</button></> : <><p>{note.text}</p>
        <button className="sm-btn" onClick={() => { setEditing(note.id); setText(note.text); }}>Edit note</button></>}
      <button className="sm-btn" onClick={() => act(() => { stateManager.updateFootnote(note.id, { kind: note.kind === 'endnote' ? 'footnote' : 'endnote' }); })}>Convert to {note.kind === 'endnote' ? 'footnote' : 'endnote'}</button>
      <button className="sm-btn" disabled={!note.elementId} onClick={() => note.elementId && stateManager.zoomToElement(note.elementId)}>Go to reference</button>
      <button className="sm-btn" onClick={() => act(() => stateManager.deleteFootnote(note.id))}>Delete note</button>
    </div>)}
    {state.publicationError && <p role="alert">{state.publicationError}</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
