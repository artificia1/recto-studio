import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import type { Spread } from '../../types';
import { pageLabel, type PublicationSection } from '../../engine/pageLabels';

export function PublicationPanel({ spread }: { spread: Spread }) {
  const [pageId, setPageId] = useState(spread.pages[0].id);
  const [chapter, setChapter] = useState('');
  const [rightHand, setRightHand] = useState(true);
  const [inset, setInset] = useState(25);
  const [message, setMessage] = useState('');
  const [header, setHeader] = useState('{{chapterTitle}}');
  const page = spread.pages.find(page => page.id === pageId) || spread.pages[0];
  const [section, setSection] = useState<PublicationSection>(page.section || { title: '', prefix: '', startNumber: 1, numbering: 'arabic' });
  function act(action: () => void, success: string) {
    try { action(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  const pages = stateManager.getState().spreads.flatMap(spread => spread.pages);
  const selectedHead = stateManager.getStoryHead(stateManager.getState().selectedElementId || '');
  return <div className="publication-panel">
    <details>
      <summary>Story pagination</summary>
      <label className="publication-check"><input type="checkbox" disabled={!selectedHead}
        checked={!!selectedHead?.autoExtendStory}
        onChange={event => act(() => stateManager.setStoryAutoExtend(selectedHead!.id, event.currentTarget.checked), 'Story pagination updated.')}/>
        Automatically add pages for selected story</label>
      <p>Select a story frame to enable. Edits and typography changes can add linked pages; facing pages are generated as pairs. Shortening a story retains existing pages.</p>
      {selectedHead?.autoPaginationError && <p role="alert">Automatic pagination paused: {selectedHead.autoPaginationError}</p>}
    </details>
    <details>
      <summary>Sections &amp; numbering</summary>
      <label>Starting page<select value={page.id} onChange={event => {
        const selected = spread.pages.find(page => page.id === event.currentTarget.value)!;
        setPageId(selected.id);
        setSection(selected.section || { title: '', prefix: '', startNumber: 1, numbering: 'arabic' });
        setMessage('');
      }}>{spread.pages.map(page => <option key={page.id} value={page.id}>Page {page.pageNumber} · {pageLabel(pages, page.id).label}</option>)}</select></label>
      <label>Section title<input value={section.title} onInput={event => setSection({ ...section, title: event.currentTarget.value })}/></label>
      <label>Start number<input type="number" min="1" max="1000000" value={section.startNumber} onInput={event => setSection({ ...section, startNumber: Number(event.currentTarget.value) })}/></label>
      <label>Numbering<select aria-label="Numbering" value={section.numbering} onChange={event => setSection({ ...section, numbering: event.currentTarget.value as PublicationSection['numbering'] })}>
        <option value="arabic">1, 2, 3</option><option value="roman-lower">i, ii, iii</option><option value="roman-upper">I, II, III</option>
      </select></label>
      <label>Prefix<input value={section.prefix} onInput={event => setSection({ ...section, prefix: event.currentTarget.value })}/></label>
      <div className="publication-actions">
        <button className="sm-btn" onClick={() => act(() => stateManager.setPageSection(page.id, section), 'Section applied. Printed page labels update automatically.')}>Apply section</button>
        <button className="sm-btn" disabled={!page.section} onClick={() => act(() => stateManager.setPageSection(page.id, null), 'Section removed.')}>Remove section</button>
      </div>
      <p>Master text supports {'{{page}}'}, {'{{chapterTitle}}'} and {'{{sectionTitle}}'}. Physical page positions stay unchanged.</p>
    </details>
    <details>
      <summary>New chapter opening</summary>
      <label>Chapter title<input value={chapter} onInput={event => setChapter(event.currentTarget.value)}/></label>
      <label>Opening inset (mm)<input type="number" min="0" value={inset} onInput={event => setInset(Number(event.currentTarget.value))}/></label>
      <label className="publication-check"><input type="checkbox" checked={rightHand} onChange={event => setRightHand(event.currentTarget.checked)}/> Start on a right-hand page</label>
      <button className="sm-btn" onClick={() => act(() => { stateManager.appendChapter(chapter, rightHand, inset); }, 'Chapter added.')}>Add chapter</button>
      <p>Appends a chapter with a heading and body paragraph. Facing-page documents receive a blank page when needed. Undo removes the entire addition.</p>
    </details>
    <details>
      <summary>Running header &amp; page number</summary>
      <label>Header text<input value={header} onInput={event => setHeader(event.currentTarget.value)}/></label>
      <button className="sm-btn" onClick={() => act(() => stateManager.setRunningHeader(spread.id, header), 'Running header and page number added to this spread’s master.')}>Apply to this spread</button>
      <p>Use {'{{chapterTitle}}'}, {'{{sectionTitle}}'}, or {'{{docTitle}}'}. A printed page number is added in the bottom margin. Assign the same master to other spreads to reuse it.</p>
    </details>
    {message && <p role="status">{message}</p>}
  </div>;
}
