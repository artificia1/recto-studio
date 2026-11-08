import { useState } from 'preact/hooks';
import { documentFontUsage } from '../../engine/documentFonts';
import { fontManager } from '../../fontManager';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';

export default function DocumentFontsPanel({ state }: { state: ProjectState }) {
  const usage = documentFontUsage(state);
  const [source, setSource] = useState(''), [target, setTarget] = useState(''), [message, setMessage] = useState('');
  return <details className="publication-panel"><summary>Document fonts &amp; replacement</summary>
    <p>Font references are not proof that a font is installed or available for PDF. Import a font file you are licensed to use. Replacement changes line breaks; review overset afterward. No Adobe Fonts activation or font-file extraction is performed.</p>
    <ul className="editorial-list">{usage.map(item => <li key={item.family}><p>{item.family} · {item.count} references · {fontManager.getFont(item.family) ? 'font file loaded' : 'font file unavailable; substitution risk'}</p></li>)}</ul>
    <label>Replace document font<select aria-label="Replace document font" value={source} onChange={event => setSource(event.currentTarget.value)}><option value="">Choose source</option>{usage.map(item => <option key={item.family}>{item.family}</option>)}</select></label>
    <label>Replacement font file<input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={async event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return;
      try { const family = await fontManager.registerFontBuffer(file.name, await file.arrayBuffer()); stateManager.saveImportedFonts(); setTarget(family); setMessage('Font loaded. Review the replacement selection.'); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }}/></label>
    <label>Use loaded font<select aria-label="Use loaded font" value={target} onChange={event => setTarget(event.currentTarget.value)}><option value="">Choose replacement</option>{fontManager.getCustomFonts().map(font => <option key={font.family}>{font.family}</option>)}</select></label>
    <div className="publication-actions"><button className="sm-btn" disabled={!source || !target} onClick={() => {
      try { stateManager.replaceDocumentFont(source, target); const overset = stateManager.runPreflightCheck().filter(issue => issue.code === 'OVERSET_TEXT').length; setMessage(`Font references replaced. ${overset} overset frames in the document; review preflight. Undo restores the previous font choices.`); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }}>Replace font throughout document</button></div>
    {message && <p role="status">{message}</p>}
  </details>;
}
