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
import BookReferencesPanel from './BookReferencesPanel';
import { readBookArchive, type ArchivedChapter } from '../../engine/bookArchive';
import { bookReferenceTargets, hasBookReferenceTarget, type BookReference } from '../../engine/bookReferences';
import { compareChapterImpact } from '../../engine/chapterImpact';
import { buildBookDelivery, defaultBookDelivery, type BookDeliveryRecipe } from '../../engine/bookDelivery';
import BookDeliveryPanel from './BookDeliveryPanel';

const ProofReviewDialog = lazy(() => import('../ProofReviewDialog'));
const PublicationBundlePanel = lazy(() => import('./PublicationBundlePanel'));
const chapterPageCount = (chapter: ArchivedChapter) => chapter.state.spreads.reduce((count, spread) => count + spread.pages.length, 0);
const parseChapter = (text: string) => parseProject(text, INITIAL_STATE);
const readChapterFile = async (file: File) => {
  if (file.size > 50 * 1024 * 1024) throw new Error('Each chapter file must be smaller than 50 MB.');
  return parseChapter(await file.text());
};

export default function ProductionPanel({ state }: { state: ProjectState }) {
  const [chapters, setChapters] = useState<ArchivedChapter[]>([]);
  const [references, setReferences] = useState<BookReference[]>([]);
  const [delivery, setDelivery] = useState<BookDeliveryRecipe>(defaultBookDelivery);
  const [replacement, setReplacement] = useState<{ before: ArchivedChapter; after: ArchivedChapter; missing: string[]; impact: ReturnType<typeof compareChapterImpact> }>();
  const [title, setTitle] = useState('Untitled Book');
  const [preset, setPreset] = useState<PdfPreset>('screen');
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [printer, setPrinter] = useState<PrinterProfile>();
  const [message, setMessage] = useState('');
  const [editionName, setEditionName] = useState('');
  const selected = state.spreads[state.activeSpreadIndex]?.elements.find(element => element.id === state.selectedElementId);
  const canTag = selected && !selected.locked && !state.layers.find(layer => layer.id === selected.layerId)?.locked &&
    !((selected.type === 'text' || selected.type === 'table') && (selected.prevFrameId || selected.nextFrameId));
  const [trapping, setTrapping] = useState(false), [trapWidth, setTrapWidth] = useState(0.144);
  const request = useRef(0);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(''); try { await action(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const book = () => ({ title, styleSourceChapterId: chapters[0]?.id || '', references,
    chapters: chapters.map(chapter => ({
      id: chapter.id, filePath: chapter.id, title: chapter.state.settings.title || chapter.name,
      startPageNumber: 1, pageCount: chapterPageCount(chapter), forceRectoOpening: chapter.recto,
    })) });
  const load = (id: string) => { const chapter = chapters.find(item => item.id === id); if (!chapter) throw new Error(`Missing chapter ${id}`); return chapter.state; };
  const lastChapter = chapters.length ? bookEngine.repaginateBook(book(), load).chapters.at(-1) : undefined;
  const editingBook = busy || !!replacement;
  const refreshChapter = (before: ArchivedChapter) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.recto,.json';
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (!file) return;
      void run(async () => {
        const state = await readChapterFile(file);
        const { widthMm, heightMm, bleedMm } = (chapters.find(item => item !== before) || before).state.settings;
        if (chapters.length > 1 && (state.settings.widthMm !== widthMm || state.settings.heightMm !== heightMm || state.settings.bleedMm !== bleedMm)) {
          throw new Error('The updated chapter must match the book’s page size and bleed.');
        }
        const targets = bookReferenceTargets(state);
        const missing = references.filter(ref => ref.chapterId === before.id &&
          !hasBookReferenceTarget(targets, ref.elementId, ref.paragraphId, ref.format)).map(ref => ref.key);
        setReplacement({ before, after: { ...before, name: file.name, state }, missing, impact: compareChapterImpact(before.state, state) });
      });
    };
    picker.click();
  };
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
    <button className="sm-btn" onClick={() => setBundleOpen(true)} disabled={bundleOpen}>Manage publication layouts</button>
    {bundleOpen && <Suspense fallback={<p>Loading layout tools…</p>}><PublicationBundlePanel/></Suspense>}
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
    <p>Add chapter files in reading order. Use Refresh chapter to review a revised source file before updating the book. The first chapter supplies synchronized styles. Chapters use the same page size and bleed.</p>
    <label>Add .recto chapters or open a saved .rectobook<input type="file" multiple accept=".recto,.json,.rectobook" disabled={editingBook} onChange={event => {
      const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; const token = ++request.current;
      void run(async () => {
        const added: ArchivedChapter[] = [];
        if (files.length > 100) throw new Error('Add up to 100 chapters at a time.');
        for (const file of files) {
          if (/\.rectobook$/i.test(file.name)) {
            if (files.length !== 1) throw new Error('Open one book archive at a time.');
            if (file.size > 128 * 1024 * 1024) throw new Error('Book archives must be smaller than 128 MB.');
            const saved = readBookArchive(await file.text(), parseChapter);
            if (token !== request.current) return;
            setChapters(saved.chapters); setTitle(saved.title); setReferences(saved.references);
            setDelivery(saved.delivery || defaultBookDelivery);
            setMessage(`${saved.chapters.length} chapters loaded locally.`);
            return;
          }
          added.push({ id: crypto.randomUUID(), name: file.name, recto: true, state: await readChapterFile(file) });
        }
        const next = [...chapters, ...added];
        if (next.length > 100) throw new Error('A book can contain up to 100 chapters.');
        if (token !== request.current) return;
        setChapters(next); setMessage(`${added.length} chapters loaded locally.`);
      });
    }}/></label>
    <ol className="editorial-list">{chapters.map((chapter, index) => <li key={chapter.id}>
      <strong>{chapter.state.settings.title || chapter.name}</strong><p>{chapterPageCount(chapter)} pages · {chapter.name}</p>
      <label className="publication-check"><input type="checkbox" checked={chapter.recto} disabled={editingBook} onChange={event => setChapters(chapters.map((item, i) => i === index ? { ...item, recto: event.currentTarget.checked } : item))}/>Start on a right-hand page</label>
      <div className="publication-actions">
        {([-1, 1] as const).map(direction => <button key={direction} className="sm-btn" aria-label={`Move ${chapter.name} ${direction < 0 ? 'up' : 'down'}`} disabled={editingBook || index + direction < 0 || index + direction >= chapters.length} onClick={() => { const next = [...chapters]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setChapters(next); }}>{direction < 0 ? '↑' : '↓'}</button>)}
        <button className="sm-btn" aria-label={`Refresh chapter ${chapter.name}`} disabled={editingBook} onClick={() => refreshChapter(chapter)}>Refresh chapter</button>
        <button className="sm-btn" disabled={editingBook} onClick={() => setChapters(chapters.filter(item => item.id !== chapter.id))}>Remove</button>
      </div>
    </li>)}</ol>
    {replacement && <section aria-label="Chapter refresh preview">
      <h4>Chapter refresh preview</h4>
      <p>{replacement.before.name} ({chapterPageCount(replacement.before)} pages) → {replacement.after.name} ({chapterPageCount(replacement.after)} pages)</p>
      {!!replacement.missing.length && <p role="alert">Targets missing in this revision: {replacement.missing.join(', ')}. Reassign these references before exporting.</p>}
      <p>{replacement.impact.headings.length} heading changes · {replacement.impact.introduced.length} new findings · {replacement.impact.resolved.length} resolved findings</p>
      {!!replacement.impact.headings.length && <ul>{replacement.impact.headings.map(({ key, before, after }) => <li key={key}>
        {before ? `${before.title} (page ${before.pageNumber})` : 'New heading'} → {after ? `${after.title} (page ${after.pageNumber})` : 'Removed'}
      </li>)}</ul>}
      {(['introduced', 'resolved'] as const).map(kind => !!replacement.impact[kind].length && <details key={kind} open={kind === 'introduced'}>
        <summary>{kind === 'introduced' ? 'New preflight findings' : 'Resolved preflight findings'}</summary>
        <ul>{replacement.impact[kind].map((issue, index) => <li key={`${issue.key}-${index}`}>Page {issue.page} · {issue.message}</li>)}</ul>
      </details>)}
      <button className="sm-btn" onClick={() => setReplacement(undefined)}>Cancel refresh</button>
      <button className="sm-btn" onClick={() => {
        setChapters(chapters.map(chapter => chapter.id === replacement.before.id ? replacement.after : chapter));
        setReplacement(undefined);
        setMessage('Chapter refreshed. Save the book archive to retain the update.');
      }}>Apply chapter refresh</button>
    </section>}
    {chapters.length > 0 && <BookReferencesPanel chapters={chapters} references={references} onChange={setReferences} disabled={editingBook}/>}
    {lastChapter && <BookDeliveryPanel recipe={delivery} settings={chapters[0].state.settings}
      pageCount={lastChapter.startPageNumber + lastChapter.pageCount - 1} disabled={editingBook} onChange={setDelivery}
      onCover={file => run(async () => setDelivery({ ...delivery, cover: await readChapterFile(file), approvedDimensions: undefined }))}
      onExport={() => run(async () => {
        const snapshot = assembleBook(book(), load);
        if (printer) printerWarnings(publicationSnapshot(snapshot));
        const bytes = await buildBookDelivery(snapshot, delivery);
        if (await savePublicationFile(`${safeName}-delivery.zip`, bytes, 'application/zip')) setMessage('Book delivery package saved.');
      })}/>}
    <div className="publication-actions">
      <button className="sm-btn" disabled={editingBook || !chapters.length} onClick={() => run(async () => {
        const archive = JSON.stringify({ version: 2, title, chapters, references, delivery });
        if (new Blob([archive]).size > 128 * 1024 * 1024) throw new Error('Book archives must be smaller than 128 MB.');
        await savePublicationFile(`${safeName}.rectobook`, archive, 'application/json'); setMessage('Book archive saved with all chapter snapshots.');
      })}>Save book archive</button>
      <button className="sm-btn" disabled={editingBook || !chapters.length} onClick={() => run(async () => {
        const snapshots = new Map(chapters.map(chapter => [chapter.id, structuredClone(chapter.state)]));
        bookEngine.syncBookStyles(book(), name => snapshots.get(name)!, (name, snapshot) => { snapshots.set(name, snapshot); });
        setChapters(chapters.map(chapter => ({ ...chapter, state: parseChapter(JSON.stringify(snapshots.get(chapter.id))) })));
        setMessage('Styles synchronized within the book snapshots. Save the book archive to retain these changes.');
      })}>Synchronize book styles</button>
      <button className="sm-btn" disabled={editingBook || !chapters.length} onClick={() => run(async () => {
        const manifest = book(); const combined = assembleBook(manifest, load);
        const { exportDocumentToPdf } = await import('../../export/pdfExport');
        const warnings = printer ? printerWarnings(publicationSnapshot(combined)) : [];
        const doc = await exportDocumentToPdf(combined, { ...exportOptions, download: false, onWarning: warning => warnings.push(warning) });
        await savePublicationFile(`${safeName}.pdf`, doc.output('arraybuffer'), 'application/pdf'); setMessage(`Book exported: ${combined.spreads.reduce((n, spread) => n + spread.pages.length, 0)} pages.${warnings.length ? ` Review: ${warnings.join(' ')}` : ''}`);
      })}>Export book PDF</button>
      <button className="sm-btn" disabled={editingBook || !chapters.length} onClick={() => run(async () => {
        const entries = bookEngine.generateUnifiedBookToc(book(), load);
        await savePublicationFile(`${safeName}-contents.txt`, entries.map(entry => `${'  '.repeat(entry.level - 1)}${entry.title}\t${entry.pageNumber}`).join('\n'), 'text/plain'); setMessage('Book contents saved.');
      })}>Export book contents</button>
    </div>
    {busy && <p role="status">Preparing publication…</p>}{message && <p role="status">{message}</p>}
  </details>;
}
