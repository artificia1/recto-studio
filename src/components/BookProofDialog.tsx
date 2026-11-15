import { useEffect, useRef, useState } from 'preact/hooks';
import { savePublicationFile } from '../desktop';
import { useModalFocus } from '../hooks/useModalFocus';
import { assembleArchivedBook, type ArchivedChapter, type BookArchive } from '../engine/bookArchive';
import { approveBookProof, approvedProofPdf, compareBookProof, describeBookProofRevision, makeBookProof, type ApprovedBookProof } from '../engine/bookProof';
import { uniqueProofMatches, type ProofMatch, type ProofPage } from '../engine/proofComparison';
import type { CommentPin } from '../types';
import { openReviewPdf, proofDifference, type PdfReviewNote } from '../export/pdfReview';
import './proofReview.css';

type Reader = Awaited<ReturnType<typeof openReviewPdf>>;
type Report = ReturnType<typeof compareBookProof>;
type Candidate = Awaited<ReturnType<typeof makeBookProof>>;
const statuses: Record<ProofMatch['change'], string> = {
  unchanged: 'Unchanged', text: 'Text changed', artwork: 'Artwork or layout changed',
  size: 'Page size changed', added: 'Added', removed: 'Removed', uncertain: 'Needs review',
};
const pageFilters = { changes: 'Changes and moves', moved: 'Moved pages', all: 'All pages' } as const;

export default function BookProofDialog({ archive, onApprove, onComments, onClose }: {
  archive: BookArchive;
  onApprove(proof: ApprovedBookProof): void;
  onComments(chapters: ArchivedChapter[]): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const abort = useRef(new AbortController());
  const readers = useRef<{ before?: Reader; after: Reader }>();
  const approvedPages = useRef<ProofPage[]>();
  const [candidate, setCandidate] = useState<Candidate>();
  const [report, setReport] = useState<Report>();
  const [approved, setApproved] = useState(archive.proof);
  const [selected, setSelected] = useState<ProofMatch>();
  const [filter, setFilter] = useState<keyof typeof pageFilters>('changes');
  const [unplacedNotes, setUnplacedNotes] = useState<PdfReviewNote[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [difference, setDifference] = useState('');
  const [highlight, setHighlight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useModalFocus(true, dialog);
  useEffect(() => () => abort.current.abort(), []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) {
      if (!abort.current.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
    } finally { if (!abort.current.signal.aborted) setBusy(false); }
  };
  const show = async (row: ProofMatch, pair: NonNullable<typeof readers.current>) => {
    const [before, after] = await Promise.all([
      row.before === null ? '' : pair.before?.preview(row.before) || '',
      row.after === null ? '' : pair.after.preview(row.after),
    ]);
    const overlay = row.change !== 'unchanged' ? await proofDifference(before, after) : '';
    abort.current.signal.throwIfAborted();
    setSelected(row); setImages([before, after]); setDifference(overlay); setHighlight(false);
  };
  const prepare = async () => {
    const signal = abort.current.signal;
    await readers.current?.before?.close(); await readers.current?.after.close();
    readers.current = undefined; approvedPages.current = undefined;
    setCandidate(undefined); setReport(undefined); setSelected(undefined); setUnplacedNotes([]);
    const book = assembleArchivedBook(archive);
    setMessage('Rendering the current book proof…');
    const current = await makeBookProof(book.source, book.pages, archive.delivery);
    signal.throwIfAborted();
    const after = await openReviewPdf(current.bytes.slice().buffer, signal);
    let before: Reader | undefined;
    try {
      if (approved) {
        before = await openReviewPdf((await approvedProofPdf(approved)).buffer, signal);
        const original = await before.scan(page => setMessage('Scanning approved page ' + page + ' of ' + approved.pages.length + '…'));
        const revised = await after.scan(page => setMessage('Scanning current page ' + page + ' of ' + current.snapshot.pages.length + '…'));
        const comparison = compareBookProof(approved, current.snapshot, original, revised);
        const row = comparison.rows.find(row => row.change !== 'unchanged' || row.moved) ?? comparison.rows[0];
        await show(row, { before, after });
        approvedPages.current = original;
        setFilter(row.change === 'unchanged' && !row.moved ? 'all' : 'changes');
        setReport(comparison);
      } else {
        await show({ before: null, after: 0, moved: false, change: 'added' }, { after });
      }
      readers.current = { before, after };
      setCandidate(current);
      setMessage(approved ? '' : 'Current proof ready. Review it before marking it approved.');
    } catch (error) { await before?.close(); await after.close(); throw error; }
  };
  const importComments = async (file: File) => {
    if (!approved || !report || !candidate || !approvedPages.current) return;
    const signal = abort.current.signal;
    const originalPages = approvedPages.current;
    const annotated = await openReviewPdf(file, signal);
    try {
      const notes = await annotated.notes();
      setUnplacedNotes([]);
      if (!notes.length) { setMessage('This PDF contains no supported comments with text.'); return; }
      const revisedPages = await annotated.scan(page => setMessage(`Checking annotated page ${page} of ${annotated.length}…`));
      const known = uniqueProofMatches(originalPages), revised = uniqueProofMatches(revisedPages);
      const current = new Map(candidate.snapshot.pages.map(page => [page.key, page]));
      const safe = new Set(report.rows.filter(row => row.change === 'unchanged' && row.before !== null).map(row => approved.pages[row.before!].key));
      const additions = new Map<string, CommentPin[]>();
      const unplaced: PdfReviewNote[] = [];
      let already = 0;
      for (const note of notes) {
        const signature = revisedPages[note.page].signature;
        const index = revised.get(signature) == null ? undefined : known.get(signature);
        const from = index == null ? undefined : approved.pages[index];
        const page = from && safe.has(from.key) ? current.get(from.key) : undefined;
        const chapter = page && archive.chapters.find(item => item.id === page.chapterId);
        if (!page?.pageId || !chapter) { unplaced.push(note); continue; }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([page.key, note.x, note.y, note.author, note.text])));
        const id = 'book-proof-note-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        const chapterNotes = additions.get(chapter.id) || [];
        if (chapter.state.comments?.some(item => item.id === id) || chapterNotes.some(item => item.id === id)) { already++; continue; }
        chapterNotes.push({ id, pageId: page.pageId, spreadId: page.spreadId,
          spreadIndex: chapter.state.spreads.findIndex(spread => spread.id === page.spreadId),
          x: note.x * chapter.state.settings.widthMm, y: note.y * chapter.state.settings.heightMm, proofPage: note.page + 1,
          author: note.author, text: note.text, timestamp: Date.now(), resolved: false });
        additions.set(chapter.id, chapterNotes);
      }
      signal.throwIfAborted();
      if (additions.size) onComments(archive.chapters.map(chapter => additions.has(chapter.id)
        ? { ...chapter, state: { ...chapter.state, comments: [...(chapter.state.comments || []), ...additions.get(chapter.id)!] } } : chapter));
      setUnplacedNotes(unplaced);
      setMessage(`${notes.length - unplaced.length - already} notes imported. ${already} already in the book. ` +
        `${unplaced.length} need manual placement. Save the book archive to retain imported notes.`);
    } finally { await annotated.close(); }
  };

  const rows = report?.rows.filter(row => filter === 'all' || row.moved || (filter === 'changes' && row.change !== 'unchanged')) ?? [];
  const pageLabel = (row: ProofMatch) => {
    const before = row.before === null ? '' : String(row.before + 1);
    const after = row.after === null ? '' : String(row.after + 1);
    return row.moved ? before + ' → ' + after : after || before;
  };
  return <div className="modal-overlay" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
    <div className="proof-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label="Book proof review">
      <header><div><h2>Book proof review</h2>
        <p>{approved ? 'Approved ' + approved.approvedAt.slice(0, 10) + ' · ' + approved.pages.length + ' pages' : 'Set the first approved proof for this book.'}</p>
      </div><button className="sm-btn" onClick={onClose}>Close</button></header>
      <div className="publication-actions">
        <button className="sm-btn" disabled={busy} onClick={() => void run(prepare)}>{approved ? 'Compare against approved proof' : 'Prepare book proof'}</button>
        {approved && <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
          await savePublicationFile('approved-book-proof.pdf', await approvedProofPdf(approved), 'application/pdf');
        })}>Download approved proof</button>}
        {candidate && <>
          <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
            await savePublicationFile('book-review.pdf', candidate.bytes, 'application/pdf');
          })}>Download current proof</button>
          <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
            const next = await approveBookProof(candidate.snapshot, candidate.bytes);
            abort.current.signal.throwIfAborted(); onApprove(next); setApproved(next);
            setReport(undefined); setCandidate(undefined); setSelected(undefined);
            setMessage('Proof approved. Save the book archive to keep this baseline.');
          })}>Approve current proof</button>
          <label>Preview current page <select disabled={busy}
            value={selected?.after === null || selected?.after === undefined ? '' : selected.after}
            onChange={event => {
              const index = Number(event.currentTarget.value);
              const row = report?.rows.find(row => row.after === index) ??
                { before: null, after: index, moved: false, change: 'added' as const };
              void run(() => show(row, readers.current!));
            }}>
            {selected?.after === null && <option value="">Removed page</option>}
            {candidate.snapshot.pages.map((page, index) => <option key={page.key} value={index}>{page.pageNumber} · {page.chapterTitle}</option>)}
          </select></label>
          {difference && <button className="sm-btn" aria-pressed={highlight} onClick={() => setHighlight(!highlight)}>Highlight changes</button>}
        </>}
      </div>
      {report && <>
        <p>{report.beforePages} → {report.afterPages} pages · {report.changed} changed · {report.moved} moved · {report.newFindings.length} new findings</p>
        {report.coverReview && <p role="alert">Cover dimensions changed. Review them before delivery.</p>}
        <div className="proof-notes">
          <label>Import comments from annotated approved proof <input type="file" accept="application/pdf,.pdf" disabled={busy}
            onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run(() => importComments(file)); }}/></label>
          <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
            const result = await describeBookProofRevision(approved!, candidate!, report);
            const pendingComments = unplacedNotes.map(({ page, ...note }) => ({ ...note, pageNumber: page + 1 }));
            const content = JSON.stringify({ title: archive.title, ...result, pendingComments }, null, 2);
            abort.current.signal.throwIfAborted();
            if (await savePublicationFile('book-proof-revision.json', content, 'application/json')) setMessage('Book proof revision report saved.');
          })}>Save revision report</button>
        </div>
        {!!unplacedNotes.length && <details><summary>Comments to place manually ({unplacedNotes.length})</summary>
          <ul>{unplacedNotes.slice(0, 50).map((note, index) => <li key={index}>Page {note.page + 1} · {note.author} · {note.text}</li>)}</ul>
          {unplacedNotes.length > 50 && <p>Save the revision report to keep all comments.</p>}
        </details>}
        {(['newFindings', 'resolvedFindings'] as const).map(kind => report[kind].length > 0 && <details key={kind}>
          <summary>{kind === 'newFindings' ? 'New preflight findings' : 'Resolved preflight findings'} ({report[kind].length})</summary>
          <ul>{report[kind].slice(0, 100).map((item, index) => <li key={index}>Page {item.page} · {item.message}</li>)}</ul>
        </details>)}
      </>}
      <p role="status">{message || (busy ? 'Working…' : '')}</p>
      {candidate && selected && <div className="proof-workspace">
        {report && <aside><label className="proof-page-filter">Show pages<select value={filter} disabled={busy}
          onChange={event => setFilter(event.currentTarget.value as keyof typeof pageFilters)}>
          {Object.entries(pageFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {!rows.length && <p>No pages in this view.</p>}
        <ol aria-label="Book proof changes">{rows.map(row => <li key={`${row.before}-${row.after}`}><button className="sm-btn" disabled={busy}
          aria-current={selected === row ? 'page' : undefined} onClick={() => void run(() => show(row, readers.current!))}>
          Page {pageLabel(row)} · {row.moved && row.change === 'unchanged' ? 'Moved' : statuses[row.change]}
        </button></li>)}</ol></aside>}
        <section className={'proof-pair' + ((highlight && difference) || !report ? ' proof-single' : '')} aria-label="Book proof previews">
          {highlight && difference ? <figure><figcaption>Changed pixels</figcaption><img src={difference} alt="Highlighted proof differences"/></figure> :
            images.map((image, index) => (report || index === 1) && <figure key={index}><figcaption>{index ? 'Current proof' : 'Approved proof'}</figcaption>
              {image ? <img src={image} alt={index ? 'Current book page' : 'Approved book page'}/> : <p>No matching page.</p>}
            </figure>)}
        </section>
      </div>}
      {candidate?.warnings.length ? <details><summary>Proof warnings ({candidate.warnings.length})</summary>
        <ul>{candidate.warnings.slice(0, 50).map(warning => <li key={warning}>{warning}</li>)}</ul></details> : null}
    </div>
  </div>;
}
