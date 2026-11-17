import { useState } from 'preact/hooks';
import { documentFontUsage, elementUsesFont, primaryFont, visitDocumentFonts } from '../../engine/documentFonts';
import { reflowStoryState, storyHeads } from '../../engine/publicationReferences';
import { reviewPreflightChange } from '../../engine/preflightReview';
import { PreflightChangeSummary } from '../PreflightChangeSummary';
import { captureLayout, compareLayouts } from '../../engine/layoutChanges';
import { LayoutChangeSummary } from '../LayoutChangeSummary';
import { fontManager } from '../../fontManager';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';
import { FONT_FILES, useFontFileImport } from '../common/useFontFileImport';
import { LocalFontPicker } from '../common/LocalFontPicker';
import { findLocalFont, listLocalFonts, loadLocalFont, localFontsSupported } from '../../engine/localFonts';

export default function DocumentFontsPanel({ state }: { state: ProjectState }) {
  const usage = documentFontUsage(state);
  const [source, setSource] = useState(''), [target, setTarget] = useState(''), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ revision: number; pages: number[]; result: ReturnType<typeof reviewPreflightChange>;
    layout: ReturnType<typeof compareLayouts> }>();
  const { importFile, choice, error, busy } = useFontFileImport(family => {
    stateManager.saveImportedFonts(); setTarget(family); setPreview(undefined); setMessage('Font loaded. Review the replacement selection.');
  });
  const [finding, setFinding] = useState('');
  // A document font that is not loaded, looked up among the fonts installed on this computer.
  const findOnComputer = async (family: string) => {
    setFinding(family); setMessage('');
    try {
      const face = findLocalFont(await listLocalFonts(), family);
      if (!face) {
        setMessage(`"${family.split(",")[0].trim()}" is not installed on this computer. Choose another installed font or import its file.`);
        return;
      }
      const loaded = await loadLocalFont(face);
      stateManager.saveImportedFonts();
      setPreview(undefined);
      if (primaryFont(loaded) === primaryFont(family)) {
        // Registered under the very name the document uses: every reference now finds it.
        setSource(''); setTarget('');
        setMessage(`Found ${face.fullName} on this computer and loaded it. The document already refers to it by this name, so nothing needs replacing.`);
      } else {
        setSource(family); setTarget(loaded);
        setMessage(`Found ${face.fullName} on this computer and loaded it as "${loaded}". Preview, then replace it throughout the document.`);
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFinding('');
    }
  };
  return <details className="publication-panel"><summary>Document fonts &amp; replacement</summary>
    <p>Font references are not proof that a font is installed or available for PDF. Import a font file you are licensed to use. Replacement changes line breaks; review overset afterward. No Adobe Fonts activation or font-file extraction is performed.</p>
    <ul className="editorial-list">{usage.map(item => <li key={item.family}><p>{item.family} · {item.count} references · {fontManager.getFont(item.family) ? 'font file loaded' : 'font file unavailable; substitution risk'}</p>
      {!fontManager.getFont(item.family) && localFontsSupported() && <button type="button" className="sm-btn" disabled={!!finding}
        aria-label={`Find ${item.family} on this computer`} onClick={() => void findOnComputer(item.family)}>
        {finding === item.family ? 'Looking…' : 'Find on this computer'}</button>}</li>)}</ul>
    <label>Replace document font<select aria-label="Replace document font" value={source} onChange={event => { setSource(event.currentTarget.value); setPreview(undefined); }}><option value="">Choose source</option>{usage.map(item => <option key={item.family}>{item.family}</option>)}</select></label>
    <label>Replacement font file<input type="file" accept={FONT_FILES} disabled={busy} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return;
      setMessage(''); void importFile(file);
    }}/></label>
    {choice}
    <LocalFontPicker label="Choose a font on this computer…" onLoaded={family => {
      stateManager.saveImportedFonts(); setTarget(family); setPreview(undefined); setMessage('Font loaded. Review the replacement selection.');
    }}/>
    {error && <p role="alert">{error}</p>}
    <label>Use loaded font<select aria-label="Use loaded font" value={target} onChange={event => { setTarget(event.currentTarget.value); setPreview(undefined); }}><option value="">Choose replacement</option>{fontManager.getCustomFonts().map(font => <option key={font.family}>{font.family}</option>)}</select></label>
    <div className="publication-actions">
      <button className="sm-btn" disabled={!source || !target} onClick={() => {
        try {
          const original = stateManager.getState();
          const pages = original.spreads.flatMap(spread => spread.pages.filter(page => spread.elements.some(element =>
            element.pageId === page.id && elementUsesFont(original, element, source))).map(page => page.pageNumber));
          const snapshot = structuredClone(original);
          visitDocumentFonts(snapshot, owner => {
            if (owner.fontFamily && primaryFont(owner.fontFamily) === primaryFont(source)) owner.fontFamily = target;
          });
          for (const head of storyHeads(snapshot)) reflowStoryState(snapshot, head.id);
          setPreview({ revision: stateManager.getDocumentRevision(), pages, layout: compareLayouts(captureLayout(original), captureLayout(snapshot)),
            result: reviewPreflightChange(stateManager.runPreflightCheck(), stateManager.runPreflightCheck(snapshot)) });
          setMessage('');
        } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      }}>Preview font replacement</button>
      <button className="sm-btn" disabled={!source || !target} onClick={() => {
      try {
        if (preview && preview.revision !== stateManager.getDocumentRevision()) throw new Error('The document changed. Preview the font replacement again.');
        stateManager.replaceDocumentFont(source, target); setPreview(undefined);
        const overset = stateManager.runPreflightCheck().filter(issue => issue.code === 'OVERSET_TEXT').length;
        setMessage(`Font references replaced. ${overset} overset frames in the document; review preflight. Undo restores the previous font choices.`);
      }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }}>Replace font throughout document</button></div>
    {preview && <><p>{preview.pages.length ? `Affected document pages: ${preview.pages.join(', ')}.` : 'The font is used in styles or parent artwork.'} Preview uses the current frames.</p>
      <LayoutChangeSummary result={preview.layout} onNavigate={id => stateManager.zoomToElement(id)}/>
      <PreflightChangeSummary result={preview.result}/></>}
    {message && <p role="status">{message}</p>}
  </details>;
}
