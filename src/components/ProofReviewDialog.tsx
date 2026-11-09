import { useEffect, useRef, useState } from 'preact/hooks';
import { stateManager } from '../state';
import { savePublicationFile } from '../desktop';
import { compareProofPages, uniqueProofMatches, type ProofChange, type ProofPage } from '../engine/proofComparison';
import { useModalFocus } from '../hooks/useModalFocus';
import type { CommentPin } from '../types';
import { openReviewPdf, proofDifference } from '../export/pdfReview';
import './proofReview.css';

const labels: Record<ProofChange, string> = { unchanged: 'No difference detected', text: 'Text changed', artwork: 'Artwork or layout changed', size: 'Page size changed', added: 'Added page', removed: 'Removed page' };
type Reader = Awaited<ReturnType<typeof openReviewPdf>>;
interface Proofs { before: Reader; after: Reader; baseline: ProofPage[]; revised: ProofPage[] }

export default function ProofReviewDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const controller = useRef(new AbortController());
  const proofs = useRef<Proofs>();
  const [files, setFiles] = useState<[File?, File?]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [changes, setChanges] = useState<ProofChange[]>([]);
  const [page, setPage] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [difference, setDifference] = useState('');
  const [highlight, setHighlight] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(true);
  useModalFocus(true, dialog);
  useEffect(() => () => controller.current.abort(), []);

  const act = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); }
    catch (error) { if (!controller.current.signal.aborted) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (!controller.current.signal.aborted) setBusy(false); }
  };

  const show = async (index: number, pair: Proofs) => {
    const next = await Promise.all([pair.before.preview(index), pair.after.preview(index)]);
    const overlay = pair.baseline[index]?.signature !== pair.revised[index]?.signature ? await proofDifference(next[0], next[1]) : '';
    if (!controller.current.signal.aborted) { setPage(index); setImages(next); setDifference(overlay); }
  };

  const compare = async () => {
    const [a, b] = files;
    if (!a || !b) return;
    await proofs.current?.before.close(); await proofs.current?.after.close();
    proofs.current = undefined; setChanges([]); setImages([]);
    const signal = controller.current.signal;
    const before = await openReviewPdf(a, signal);
    let after: Reader | undefined;
    try {
      after = await openReviewPdf(b, signal);
      const baseline = await before.scan(index => setMessage(`Scanning original proof ${index} / ${before.length}`));
      const revised = await after.scan(index => setMessage(`Scanning revised proof ${index} / ${after!.length}`));
      const results = compareProofPages(baseline, revised);
      const pair = { before, after, baseline, revised };
      await show(Math.max(0, results.findIndex(change => change !== 'unchanged')), pair);
      proofs.current = pair; setChanges(results); setOnlyChanges(results.some(change => change !== 'unchanged'));
      setMessage(`${results.filter(change => change !== 'unchanged').length} of ${results.length} page positions changed.`);
    } catch (error) { await before.close(); await after?.close(); throw error; }
  };

  const importNotes = async (pair: Proofs) => {
    const notes = await pair.after.notes();
    if (!notes.length) { setMessage('The revised PDF contains no supported comments with text.'); return; }
    const revision = stateManager.getDocumentRevision();
    const source = structuredClone(stateManager.getState());
    const pages = source.spreads.flatMap((spread, spreadIndex) => spread.pages.map(page => ({ page, spread, spreadIndex })));
    const { exportDocumentToPdf } = await import('../export/pdfExport');
    setMessage('Checking comment positions against the current document…');
    const current = await exportDocumentToPdf(source, { download: false, fetchExternalAssets: false });
    const reader = await openReviewPdf(current.output('arraybuffer'), controller.current.signal);
    try {
      const currentMatches = uniqueProofMatches(await reader.scan());
      const baselineMatches = uniqueProofMatches(pair.baseline);
      const revisedMatches = uniqueProofMatches(pair.revised);
      const additions: CommentPin[] = [];
      for (const note of notes) {
        const signature = pair.revised[note.page].signature;
        const original = baselineMatches.get(signature);
        const position = original == null || revisedMatches.get(signature) == null ? undefined : currentMatches.get(signature);
        const target = position == null ? undefined : pages[position];
        const key = new TextEncoder().encode(JSON.stringify([signature, note.page, note.x, note.y, note.author, note.text]));
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', key));
        const id = `pdf-note-${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
        additions.push({ id, pageId: target?.page.id, spreadId: target?.spread.id, spreadIndex: target?.spreadIndex ?? 0,
          x: note.x * source.settings.widthMm, y: note.y * source.settings.heightMm, proofPage: note.page + 1, unplaced: !target,
          author: note.author, text: note.text, timestamp: Date.now(), resolved: false });
      }
      controller.current.signal.throwIfAborted();
      const count = stateManager.importProofNotes(additions, revision);
      const uncertain = additions.filter(note => note.unplaced).length;
      setMessage(`${count} new comments imported. ${uncertain} of the PDF comments need placement. Open Review notes to see them.`);
    } finally { await reader.close(); }
  };

  return <div className="modal-overlay" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
    <div className="proof-dialog" role="dialog" aria-modal="true" aria-label="Compare proofs" ref={dialog}>
      <header><div><h2>Compare proofs</h2><p>Compare PDF pages by position. Small details can fall below the preview resolution.</p></div><button className="sm-btn" onClick={onClose}>Close</button></header>
      <div className="proof-inputs">{(['Original proof', 'Revised proof'] as const).map((label, index) => <label key={label}>{label}
        <input aria-label={label} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={event => {
          const next = [...files] as [File?, File?]; next[index] = event.currentTarget.files?.[0];
          setFiles(next); setChanges([]); setImages([]); setMessage('');
        }}/>
      </label>)}</div>
      <div className="publication-actions">
        <button className="sm-btn" disabled={busy || !files[0] || !files[1]} onClick={() => void act(compare)}>Compare PDFs</button>
        <button className="sm-btn" disabled={busy} onClick={() => void act(async () => {
          const source = structuredClone(stateManager.getState());
          const { exportDocumentToPdf } = await import('../export/pdfExport');
          const pdf = await exportDocumentToPdf(source, { download: false, fetchExternalAssets: false });
          controller.current.signal.throwIfAborted();
          const name = source.settings.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'publication';
          await savePublicationFile(`${name}-review.pdf`, pdf.output('arraybuffer'), 'application/pdf');
          setMessage('Review PDF saved. Keep this original to compare with the annotated copy.');
        })}>Download current review PDF</button>
        {!!changes.length && <>
          {difference && <button className="sm-btn" aria-pressed={highlight} onClick={() => setHighlight(!highlight)}>Highlight changes</button>}
          <button className="sm-btn" disabled={busy} onClick={() => void act(() => importNotes(proofs.current!))}>Import comments from revised proof</button>
          <button className="sm-btn" disabled={busy} onClick={() => void act(async () => {
            const report = { original: files[0]?.name, revised: files[1]?.name, pages: changes.map((change, index) => ({ page: index + 1, change })) };
            await savePublicationFile('proof-comparison.json', JSON.stringify(report, null, 2), 'application/json');
            setMessage('Comparison report saved.');
          })}>Save comparison report</button>
        </>}
      </div>
      <p role="status">{message || (busy ? 'Working…' : '')}</p>
      {!!changes.length && <div className="proof-workspace">
        <aside><label><input type="checkbox" checked={onlyChanges} onChange={event => setOnlyChanges(event.currentTarget.checked)}/>Changed pages only</label>
          <ol aria-label="Proof page changes">{changes.map((change, index) => (!onlyChanges || change !== 'unchanged') && <li key={index}>
            <button className="sm-btn" disabled={busy} aria-current={page === index ? 'page' : undefined} onClick={() => void act(() => show(index, proofs.current!))}>Page {index + 1} · {labels[change]}</button>
          </li>)}</ol></aside>
        <section className="proof-pair" aria-label={`Proof previews for page ${page + 1}`}>
          {highlight && difference ? <figure><figcaption>Changed pixels · Page {page + 1}</figcaption><img src={difference} alt={`Highlighted changes on page ${page + 1}`}/></figure> : images.map((image, index) => <figure key={index}><figcaption>{index ? 'Revised' : 'Original'} · Page {page + 1}</figcaption>
            {image ? <img src={image} alt={`${index ? 'Revised' : 'Original'} proof page ${page + 1}`}/> : <p>No page at this position.</p>}
          </figure>)}
        </section>
      </div>}
    </div>
  </div>;
}
