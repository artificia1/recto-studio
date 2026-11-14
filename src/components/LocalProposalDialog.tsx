import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { collabSession } from '../collab';
import { describeLocalProposal, readLocalProposal } from '../engine/localProposal';
import { useModalFocus } from '../hooks/useModalFocus';
import { stateManager } from '../state';
import type { ProjectState } from '../types';
import './webInstallDialog.css';

type Offer = { source: string; proposal: string; revision: string; canvas: string | null };
type Review = Offer & { session: number; editorRevision: number; sourceState: ProjectState };
type BundledMcp = { executable: string; entry: string };

function closeInbox(proposal: string) {
  return import('@tauri-apps/api/core').then(({ invoke }) => invoke('desktop_end_proposal_review', { proposal })).catch(() => {});
}

async function captureCanvas() {
  const source = document.querySelector<HTMLCanvasElement>('#spread-canvas');
  if (!source?.width || !source.height) return null;
  const image = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
  image.width = Math.max(1, Math.floor(source.width * scale));
  image.height = Math.max(1, Math.floor(source.height * scale));
  const context = image.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(source, 0, 0, image.width, image.height);
    const png = await new Promise<Blob | null>(resolve => image.toBlob(resolve, 'image/png'));
    if (png && png.size <= 3 * 1024 * 1024) return Array.from(new Uint8Array(await png.arrayBuffer()));
  } catch { /* A linked image may prevent reading the canvas. The source file can still be rendered. */ }
  return null;
}

export default function LocalProposalDialog({ onClose }: { onClose(): void }) {
  const panel = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const [review, setReview] = useState<Review>();
  const [draft, setDraft] = useState<ProjectState>();
  const [busy, setBusy] = useState(false);
  const [shareCanvas, setShareCanvas] = useState(true);
  const [message, setMessage] = useState('');
  const [bundled, setBundled] = useState<BundledMcp>();
  useModalFocus(true, panel);
  const close = () => { if (!busy) onClose(); };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (import.meta.env.VITE_RECTO_MCP_PREVIEW !== '1') return;
    let active = true;
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke<BundledMcp | null>('desktop_bundled_mcp'))
      .then(runtime => { if (active && runtime) setBundled(runtime); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!review) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        if (collabSession.isConnected() || stateManager.getDocumentSession() !== review.session ||
          stateManager.getDocumentRevision() !== review.editorRevision) {
          if (alive) { setDraft(undefined); setMessage('The document changed. Close this review and share a fresh copy.'); }
          return;
        }
        const { invoke } = await import('@tauri-apps/api/core');
        const next = await invoke<string | null>('desktop_read_proposal', { proposal: review.proposal });
        if (!alive) return;
        if (next) setDraft(readLocalProposal(next, review.revision));
        else timer = setTimeout(check, 900);
      } catch (error) { if (alive) setMessage(String(error)); }
    };
    void check();
    return () => { alive = false; clearTimeout(timer); void closeInbox(review.proposal); };
  }, [review]);

  async function start() {
    setBusy(true);
    setMessage('');
    try {
      if (collabSession.isConnected()) throw new Error('Leave the shared session before reviewing a local proposal.');
      const session = stateManager.getDocumentSession(), editorRevision = stateManager.getDocumentRevision();
      const snapshot = stateManager.exportJson();
      const sourceState = structuredClone(stateManager.getState());
      const canvas = shareCanvas ? await captureCanvas() : null;
      const { invoke } = await import('@tauri-apps/api/core');
      const next = await invoke<Offer | null>('desktop_begin_proposal_review', { snapshot, canvas });
      if (!next) return;
      if (!mounted.current) { await closeInbox(next.proposal); return; }
      setReview({ ...next, session, editorRevision, sourceState });
    } catch (error) { if (mounted.current) setMessage(String(error)); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function apply() {
    if (!draft || !review || busy) return;
    setBusy(true);
    try {
      if (collabSession.isConnected()) throw new Error('Leave the shared session and start a fresh review.');
      await stateManager.applyReviewedProposal(draft, review.session, review.editorRevision);
      onClose();
    } catch (error) {
      if (mounted.current) { setMessage(String(error)); setBusy(false); }
    }
  }

  const summary = draft && review ? describeLocalProposal(review.sourceState, draft) : undefined;
  return createPortal(<div className="web-install-overlay" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={panel} className="web-install-dialog" role="dialog" aria-modal="true" aria-labelledby="local-proposal-title"
      onKeyDown={event => { if (event.key === 'Escape') close(); }}>
      <header><h2 id="local-proposal-title">Review publishing changes</h2></header>
      <div className="web-install-options">
        {!review && <>
          <p>Choose the folder shared with your publishing client. Recto saves a copy of the current document there for review.</p>
          <label><input type="checkbox" checked={shareCanvas} onChange={event => setShareCanvas(event.currentTarget.checked)} /> Include the visible canvas for the client</label>
          {bundled && <label>Local MCP client configuration
            <textarea readOnly rows={9} spellcheck={false} wrap="off" style={{ width: '100%' }} value={JSON.stringify({ mcpServers: {
              recto: { command: bundled.executable, args: [bundled.entry, 'mcp', '--workspace', 'CHOOSE_YOUR_WORKSPACE'] },
            } }, null, 2)} />
          </label>}
        </>}
        {review && <>
          <p>Give your client this source file and ask it to send a proposal using the second filename.</p>
          <p>Source <code>{review.source}</code></p>
          {review.canvas && <p>Canvas <code>{review.canvas}</code></p>}
          <p>Proposal <code>{review.proposal}</code></p>
          {!summary && !message && <p role="status">Waiting for proposal…</p>}
        </>}
        {summary && <div role="status">
          <p>Pages {summary.beforePages} → {summary.afterPages}. Frames {summary.added} added, {summary.edited} edited, {summary.removed} removed.</p>
          {summary.beforeTitle !== summary.afterTitle && <p>Title changes to “{summary.afterTitle}”</p>}
        </div>}
        {message && <p role="alert">{message}</p>}
        <footer>
          <button type="button" className="action-btn" disabled={busy} onClick={close}>Close</button>
          {!review && <button type="button" className="action-btn primary" disabled={busy} onClick={start}>Choose workspace…</button>}
          {summary && <button type="button" className="action-btn primary" disabled={busy} onClick={apply}>Apply to document</button>}
        </footer>
      </div>
    </section>
  </div>, document.body);
}
