import { useState } from 'preact/hooks';
import { stateManager } from '../state';
import { publicationHeadings } from '../engine/publicationReferences';
import { authoritySuggestions, type AuthoritySuggestion } from '../engine/authoritySuggestions';
import { storyText } from '../engine/storyContent';
import { publicationCaptions } from '../engine/publicationCaptions';

export function StoryReferenceTools({ frameId, start, end, apply }: { frameId: string; start: number; end: number; apply: (action: () => void) => void }) {
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'footnote' | 'endnote'>('footnote');
  const [target, setTarget] = useState('0');
  const [captionTarget, setCaptionTarget] = useState('');
  const [topic, setTopic] = useState('');
  const [authorityCategory, setAuthorityCategory] = useState<'cases' | 'statutes' | 'treatises'>('cases');
  const [citation, setCitation] = useState('');
  const [suggestions, setSuggestions] = useState<AuthoritySuggestion[]>([]);
  const [scannedText, setScannedText] = useState('');
  const headings = publicationHeadings(stateManager.getState());
  const captions = publicationCaptions(stateManager.getState());
  return <details className="story-reference-tools"><summary>Notes, references &amp; index markers</summary>
    <div className="publication-panel">
      <label>Note text<input type="text" value={note} onInput={event => setNote(event.currentTarget.value)} placeholder="Citation or explanation"/></label>
      <label>Note placement<select value={kind} onChange={event => setKind(event.currentTarget.value as typeof kind)}><option value="footnote">Footnote</option><option value="endnote">Endnote</option></select></label>
      <button className="sm-btn" disabled={!note.trim()} onMouseDown={event => event.preventDefault()} onClick={() => apply(() => {
        stateManager.insertFootnote(frameId, note.trim(), start, kind); setNote('');
      })}>Insert note at cursor</button>
      <label>Reference heading<select value={target} onChange={event => setTarget(event.currentTarget.value)}>
        {headings.map((heading, index) => <option value={String(index)} key={`${heading.elementId}-${heading.paragraphId}`}>{heading.title} · {heading.label}</option>)}
      </select></label>
      <button className="sm-btn" disabled={!headings[Number(target)]} onMouseDown={event => event.preventDefault()} onClick={() => apply(() => {
        const heading = headings[Number(target)]; stateManager.insertStoryReference(frameId, start, end, heading.elementId, heading.paragraphId);
      })}>Insert live page reference</button>
      {!!captions.length && <><label>Figure or table reference<select aria-label="Figure or table reference" value={captionTarget} onChange={event => setCaptionTarget(event.currentTarget.value)}>
        <option value="">Choose a caption</option>{captions.map(caption => <option key={caption.id} value={caption.id}>{caption.label} · {caption.title}</option>)}
      </select></label>
      <button className="sm-btn" disabled={!captions.some(caption => caption.id === captionTarget)} onMouseDown={event => event.preventDefault()}
        onClick={() => apply(() => stateManager.insertStoryReference(frameId, start, end, captionTarget, undefined, 'caption'))}>Insert live caption reference</button></>}
      <label>Index topic<input type="text" value={topic} onInput={event => setTopic(event.currentTarget.value)} placeholder="Leave blank to use selected text"/></label>
      <button className="sm-btn" disabled={end <= start} onMouseDown={event => event.preventDefault()} onClick={() => apply(() => {
        const selected = stateManager.getStoryContent(frameId).paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n').slice(start, end);
        stateManager.markStoryIndex(frameId, start, end, topic.trim() || selected);
      })}>Mark selected text for index</button>
      <label>Authority category<select value={authorityCategory} onChange={event => setAuthorityCategory(event.currentTarget.value as typeof authorityCategory)}><option value="cases">Cases</option><option value="statutes">Statutes</option><option value="treatises">Treatises</option></select></label>
      <label>Canonical authority citation<input value={citation} placeholder="Leave blank to use the selected citation" maxLength={2000} onInput={event => setCitation(event.currentTarget.value)}/></label>
      <button className="sm-btn" disabled={end <= start} onMouseDown={event => event.preventDefault()} onClick={() => apply(() => {
        const selected = stateManager.getStoryContent(frameId).paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n').slice(start, end);
        stateManager.markStoryIndex(frameId, start, end, citation.trim() || selected, '', authorityCategory);
      })}>Mark selected citation as authority</button>
      <p>Use the same canonical citation for short forms of one authority. Create the Table of Authorities in Pages. Marks are reviewed editorial choices, not verified legal citations.</p>
      <button className="sm-btn" onClick={() => {
        const content = stateManager.getStoryContent(frameId);
        setScannedText(storyText(content)); setSuggestions(authoritySuggestions(content));
      }}>Find citation suggestions in this story</button>
      <p>Limited US case/statute patterns; up to 200 suggestions in the first million characters. Review names, category and short forms. Treatises and other citation systems use manual marks.</p>
      {suggestions.map(suggestion => <div className="reference-note" key={`${suggestion.start}-${suggestion.end}`}>
        <p>{suggestion.category}: {suggestion.text}</p>
        <button className="sm-btn" onMouseDown={event => event.preventDefault()} onClick={() => apply(() => {
          if (storyText(stateManager.getStoryContent(frameId)) !== scannedText) throw new Error('The manuscript changed. Scan for suggestions again.');
          stateManager.markStoryIndex(frameId, suggestion.start, suggestion.end, citation.trim() || suggestion.text, '', suggestion.category);
          setSuggestions(previous => previous.filter(item => item !== suggestion));
        })}>Mark reviewed suggestion</button>
      </div>)}
      <p>Notes attach to the cursor position. References and index entries follow their targets as pages change. Manage notes and generated lists in Pages.</p>
    </div>
  </details>;
}
