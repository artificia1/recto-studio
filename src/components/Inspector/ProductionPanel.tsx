import { useRef, useState } from 'preact/hooks';
import type { ProjectState } from '../../types';
import { INITIAL_STATE, stateManager } from '../../state';
import { parseProject } from '../../state/projectValidation';
import { bookEngine } from '../../engine/bookEngine';
import { assembleBook } from '../../engine/bookAssembly';
import { publicationHeadings } from '../../engine/publicationReferences';
import { publicationPreflight } from '../../engine/publicationPreflight';
import { documentFontUsage } from '../../engine/documentFonts';
import { PDF_PRESETS, type PdfPreset } from '../../export/presets';
import { savePublicationFile } from '../../desktop';

interface Chapter { name: string; state: ProjectState; recto: boolean }

export default function ProductionPanel({ state }: { state: ProjectState }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [title, setTitle] = useState('Untitled Book');
  const [preset, setPreset] = useState<PdfPreset>('screen');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [trapping, setTrapping] = useState(false), [trapWidth, setTrapWidth] = useState(0.144);
  const request = useRef(0);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(''); try { await action(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const book = () => bookEngine.createBook(title, chapters.map(chapter => ({ title: chapter.state.settings.title || chapter.name, filePath: chapter.name, forceRectoOpening: chapter.recto })));
  const load = (name: string) => { const chapter = chapters.find(item => item.name === name); if (!chapter) throw new Error(`Missing chapter ${name}`); return chapter.state; };
  const safeName = (title || 'publication').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 100) || 'publication';
  return <details className="publication-panel">
    <summary>Production & books</summary>
    <label>PDF preset<select value={preset} onChange={event => setPreset(event.currentTarget.value as PdfPreset)}>{Object.entries(PDF_PRESETS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
    <p>{PDF_PRESETS[preset].description} PDF presets do not certify PDF/X, PDF/A or PDF/UA conformance.</p>
    <details><summary>Process-colour trapping</summary>
      <label className="publication-check"><input type="checkbox" checked={trapping} onChange={event => setTrapping(event.currentTarget.checked)}/>Spread lighter opaque fills into adjacent darker fills</label>
      <label>Trap width (pt)<input aria-label="Trap width in points" type="number" min={0.001} max={2} step={0.001} value={trapWidth} onChange={event => setTrapWidth(Number(event.currentTarget.value))}/></label>
      <p>Export-only vector traps for closed process-colour fills without visible strokes. Text, photographs, stroked or transparent artwork and spot inks require printer trapping. Confirm the trap width with your printer; 0.144 pt is a starting value, not a press guarantee.</p>
    </details>
    <div className="publication-actions">
      <button className="sm-btn" disabled={busy} onClick={() => run(async () => { const { exportDocumentToPdf } = await import('../../export/pdfExport'); const warnings: string[] = []; await exportDocumentToPdf(structuredClone(stateManager.getState()), { ...PDF_PRESETS[preset].options, ...(trapping ? { trapping: { widthPt: trapWidth } } : {}), onWarning: warning => warnings.push(warning) }); setMessage(`PDF export completed.${warnings.length ? ` Review: ${warnings.join(' ')}` : ''}`); })}>Export document PDF</button>
      <button className="sm-btn" disabled={busy} onClick={() => run(async () => {
        const snapshot = structuredClone(stateManager.getState());
        const report = { title: snapshot.settings.title, created: new Date().toISOString(), preset, issues: publicationPreflight(snapshot, 'print'), fonts: documentFontUsage(snapshot), headings: publicationHeadings(snapshot) };
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
        const warnings: string[] = [];
        const doc = await exportDocumentToPdf(combined, { ...PDF_PRESETS[preset].options, ...(trapping ? { trapping: { widthPt: trapWidth } } : {}), download: false, onWarning: warning => warnings.push(warning) });
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
