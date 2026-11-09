import { useRef, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import type { ProjectState } from '../../types';
import { INITIAL_STATE, stateManager } from '../../state';
import { parseProject } from '../../state/projectValidation';
import { bookEngine } from '../../engine/bookEngine';
import { assembleBook } from '../../engine/bookAssembly';
import { publicationHeadings, publicationSnapshot } from '../../engine/publicationReferences';
import { publicationPreflight } from '../../engine/publicationPreflight';
import { documentFontUsage } from '../../engine/documentFonts';
import { PDF_PRESETS, type PdfPreset } from '../../export/presets';
import { savePublicationFile } from '../../desktop';
import { checkPrinterProfile, type PrinterProfile } from '../../engine/printerProfiles';
import PrinterProfilesPanel from './PrinterProfilesPanel';

interface Chapter { name: string; state: ProjectState; recto: boolean }
const ProofReviewDialog = lazy(() => import('../ProofReviewDialog'));

export default function ProductionPanel({ state }: { state: ProjectState }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [title, setTitle] = useState('Untitled Book');
  const [preset, setPreset] = useState<PdfPreset>('screen');
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [printer, setPrinter] = useState<PrinterProfile>();
  const [message, setMessage] = useState('');
  const [editionName, setEditionName] = useState('');
  const selected = state.spreads[state.activeSpreadIndex]?.elements.find(element => element.id === state.selectedElementId);
  const canTag = selected && !selected.locked && !state.layers.find(layer => layer.id === selected.layerId)?.locked &&
    !((selected.type === 'text' || selected.type === 'table') && (selected.prevFrameId || selected.nextFrameId));
  const [trapping, setTrapping] = useState(false), [trapWidth, setTrapWidth] = useState(0.144);
  const request = useRef(0);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(''); try { await action(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const book = () => bookEngine.createBook(title, chapters.map(chapter => ({ title: chapter.state.settings.title || chapter.name, filePath: chapter.name, forceRectoOpening: chapter.recto })));
  const load = (name: string) => { const chapter = chapters.find(item => item.name === name); if (!chapter) throw new Error(`Missing chapter ${name}`); return chapter.state; };
  const safeName = (title || 'publication').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 100) || 'publication';
  const options = PDF_PRESETS[preset].options;
  const exportOptions = { ...options, ...(trapping ? { trapping: { widthPt: trapWidth, tacLimit: printer?.maxInk } } : {}) };
  const printerIssues = (snapshot: ProjectState) => printer ? checkPrinterProfile(printer, snapshot, options.includeBleed) : [];
  const printerWarnings = (snapshot: ProjectState) => {
    const issues = printerIssues(snapshot);
    const describe = (issue: (typeof issues)[number]) => issue.page ? `Page ${issue.page}: ${issue.message}` : issue.message;
    const errors = issues.filter(issue => issue.severity === 'error');
    if (errors.length) throw new Error(errors.slice(0, 8).map(describe).join(' ') + (errors.length > 8 ? ' See the publication report for more issues.' : ''));
    return issues.slice(0, 8).map(describe);
  };
  return <details className="publication-panel">
    <summary>Production & books</summary>
    <button className="sm-btn" onClick={() => setReviewOpen(true)}>Compare proofs</button>
    {reviewOpen && <Suspense fallback={<p role="status">Loading proof tools…</p>}><ProofReviewDialog onClose={() => setReviewOpen(false)}/></Suspense>}
    <details><summary>Publication editions</summary>
      <p>Choose which editions to include when exporting the current document. Assign an edition to a selected object here or to a paragraph in Story Editor.</p>
      {(state.conditions || []).map(condition => <label className="publication-check" key={condition.id}>
        <input type="checkbox" checked={condition.visible} onChange={() => stateManager.toggleCondition(condition.id)}/>{condition.name}
      </label>)}
      <label>New edition name<input maxLength={80} value={editionName} onInput={event => setEditionName(event.currentTarget.value)}/></label>
      <button className="sm-btn" disabled={!editionName.trim() || state.conditions?.some(condition => condition.name.toLowerCase() === editionName.trim().toLowerCase())}
        onClick={() => { stateManager.addCondition(editionName.trim()); setEditionName(''); }}>Add edition</button>
      {canTag && selected && <label>Selected object edition<select aria-label="Selected object edition" value={selected.conditionId || ''}
        onChange={event => stateManager.updateElement(selected.id, { conditionId: event.currentTarget.value || undefined })}>
        <option value="">All editions</option>{(state.conditions || []).map(condition => <option key={condition.id} value={condition.id}>{condition.name}</option>)}
      </select></label>}
    </details>
    <label>PDF preset<select value={preset} onChange={event => setPreset(event.currentTarget.value as PdfPreset)}>{Object.entries(PDF_PRESETS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
    <p>{PDF_PRESETS[preset].description} PDF presets do not certify PDF/X, PDF/A or PDF/UA conformance.</p>
    <PrinterProfilesPanel state={state} includeBleed={options.includeBleed} selected={printer} onSelect={setPrinter}/>
    <details><summary>Process-colour trapping</summary>
      <label className="publication-check"><input type="checkbox" checked={trapping} onChange={event => setTrapping(event.currentTarget.checked)}/>Spread lighter opaque fills into adjacent darker fills</label>
      <label>Trap width (pt)<input aria-label="Trap width in points" type="number" min={0.001} max={2} step={0.001} value={trapWidth} onChange={event => setTrapWidth(Number(event.currentTarget.value))}/></label>
      <p>Export-only vector traps for closed process-colour fills without visible strokes. Text, photographs, stroked or transparent artwork and spot inks require printer trapping. Confirm the trap width with your printer; 0.144 pt is a starting value, not a press guarantee.</p>
    </details>
    <div className="publication-actions">
      <button className="sm-btn" disabled={busy} onClick={() => run(async () => {
        const snapshot = structuredClone(stateManager.getState());
        const warnings = printer ? printerWarnings(publicationSnapshot(snapshot)) : [];
        const { exportDocumentToPdf } = await import('../../export/pdfExport');
        await exportDocumentToPdf(snapshot, { ...exportOptions, onWarning: warning => warnings.push(warning) });
        setMessage(`PDF export completed.${warnings.length ? ` Review: ${warnings.join(' ')}` : ''}`);
      })}>Export document PDF</button>
      <button className="sm-btn" disabled={busy} onClick={() => run(async () => {
        const snapshot = publicationSnapshot(stateManager.getState());
        const report = { title: snapshot.settings.title, created: new Date().toISOString(), preset, printer, printerIssues: printerIssues(snapshot), issues: publicationPreflight(snapshot, 'print'), fonts: documentFontUsage(snapshot), headings: publicationHeadings(snapshot) };
        await savePublicationFile('publication-report.json', JSON.stringify(report, null, 2), 'application/json'); setMessage('Publication report saved.');
      })}>Save publication report</button>
    </div>
    <hr/>
    <label>Book title<input value={title} maxLength={200} onInput={event => setTitle(event.currentTarget.value)}/></label>
    <p>Add chapter files in reading order. The first chapter supplies synchronized styles. Chapters use the same page size and bleed.</p>
    <label>Add .recto chapters or open a saved .rectobook<input type="file" multiple accept=".recto,.json,.rectobook" disabled={busy} onChange={event => {
      const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; const token = ++request.current;
      void run(async () => {
        const added: Chapter[] = []; let importedTitle: string | undefined;
        if (files.length > 100) throw new Error('Add up to 100 chapters at a time.');
        for (const file of files) {
          if (file.size > 50 * 1024 * 1024) throw new Error('Each file must be smaller than 50 MB.');
          const text = await file.text();
          if (file.name.endsWith('.rectobook')) {
            if (files.length !== 1) throw new Error('Open one book archive at a time.');
            const saved = JSON.parse(text);
            if (saved.version !== 1 || typeof saved.title !== 'string' || !Array.isArray(saved.chapters) || saved.chapters.length > 100) throw new Error('Unsupported book archive.');
            importedTitle = saved.title;
            for (const entry of saved.chapters) {
              if (typeof entry.name !== 'string' || typeof entry.recto !== 'boolean') throw new Error('Invalid chapter entry.');
              added.push({ name: entry.name, recto: entry.recto, state: parseProject(JSON.stringify(entry.state), INITIAL_STATE) });
            }
          } else added.push({ name: file.name, recto: true, state: parseProject(text, INITIAL_STATE) });
        }
        const next = importedTitle === undefined ? [...chapters, ...added] : added;
        if (new Set(next.map(item => item.name)).size !== next.length) throw new Error('Chapter filenames must be unique.');
        if (token !== request.current) return;
        setChapters(next); if (importedTitle !== undefined) setTitle(importedTitle); setMessage(`${added.length} chapters loaded locally.`);
      });
    }}/></label>
    <ol className="editorial-list">{chapters.map((chapter, index) => <li key={chapter.name}>
      <strong>{chapter.state.settings.title || chapter.name}</strong><p>{chapter.state.spreads.reduce((n, spread) => n + spread.pages.length, 0)} pages · {chapter.name}</p>
      <label className="publication-check"><input type="checkbox" checked={chapter.recto} disabled={busy} onChange={event => setChapters(chapters.map((item, i) => i === index ? { ...item, recto: event.currentTarget.checked } : item))}/>Start on a right-hand page</label>
      <div className="publication-actions">
        {([-1, 1] as const).map(direction => <button key={direction} className="sm-btn" aria-label={`Move ${chapter.name} ${direction < 0 ? 'up' : 'down'}`} disabled={busy || index + direction < 0 || index + direction >= chapters.length} onClick={() => { const next = [...chapters]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setChapters(next); }}>{direction < 0 ? '↑' : '↓'}</button>)}
        <button className="sm-btn" disabled={busy} onClick={() => setChapters(chapters.filter((_, i) => i !== index))}>Remove</button>
      </div>
    </li>)}</ol>
    <div className="publication-actions">
      <button className="sm-btn" disabled={busy || !chapters.length} onClick={() => run(async () => {
        await savePublicationFile(`${safeName}.rectobook`, JSON.stringify({ version: 1, title, chapters }), 'application/json'); setMessage('Book archive saved with all chapter snapshots.');
      })}>Save book archive</button>
      <button className="sm-btn" disabled={busy || !chapters.length} onClick={() => run(async () => {
        const snapshots = new Map(chapters.map(chapter => [chapter.name, structuredClone(chapter.state)]));
        bookEngine.syncBookStyles(book(), name => snapshots.get(name)!, (name, snapshot) => { snapshots.set(name, snapshot); });
        setChapters(chapters.map(chapter => ({ ...chapter, state: parseProject(JSON.stringify(snapshots.get(chapter.name)), INITIAL_STATE) })));
        setMessage('Styles synchronized within the book snapshots. Save the book archive to retain these changes.');
      })}>Synchronize book styles</button>
      <button className="sm-btn" disabled={busy || !chapters.length} onClick={() => run(async () => {
        const manifest = book(); const combined = assembleBook(manifest, load);
        const { exportDocumentToPdf } = await import('../../export/pdfExport');
        const warnings = printer ? printerWarnings(publicationSnapshot(combined)) : [];
        const doc = await exportDocumentToPdf(combined, { ...exportOptions, download: false, onWarning: warning => warnings.push(warning) });
        await savePublicationFile(`${safeName}.pdf`, doc.output('arraybuffer'), 'application/pdf'); setMessage(`Book exported: ${combined.spreads.reduce((n, spread) => n + spread.pages.length, 0)} pages.${warnings.length ? ` Review: ${warnings.join(' ')}` : ''}`);
      })}>Export book PDF</button>
      <button className="sm-btn" disabled={busy || !chapters.length} onClick={() => run(async () => {
        const entries = bookEngine.generateUnifiedBookToc(book(), load);
        await savePublicationFile(`${safeName}-contents.txt`, entries.map(entry => `${'  '.repeat(entry.level - 1)}${entry.title}\t${entry.pageNumber}`).join('\n'), 'text/plain'); setMessage('Book contents saved.');
      })}>Export book contents</button>
    </div>
    {busy && <p role="status">Preparing publication…</p>}{message && <p role="status">{message}</p>}
  </details>;
}
