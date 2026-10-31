import { useRef, useState } from 'preact/hooks';
import { useModalFocus } from '../hooks/useModalFocus';
import { stateManager } from '../state';
import { createZipArchive } from '../zip';
import { savePublicationFile } from '../desktop';
import conversionScript from '../../public/conversion/Recto-Export-IDML.jsx?raw';
import './equations.css';

const instructions = `INDD to Recto Studio\n\n1. Open the original INDD document in a compatible, licensed Adobe InDesign installation.\n2. Open Window > Utilities > Scripts. Right-click the User folder and choose Reveal in Explorer/Finder.\n3. Copy Recto-Export-IDML.jsx from this ZIP into that Scripts Panel folder.\n4. Double-click the script in InDesign's Scripts panel and choose a new IDML file location.\n5. Return to Recto and import that IDML file.\n\nYou can also use InDesign's File > Export > InDesign Markup (IDML) without this script.\n\nThe script exports the active document. It never saves or closes the original document.\nRecto's IDML importer supports editable text, styles and geometry, with format limitations.\nKeep original linked images/fonts available for relinking and check the imported result.\n\nWithout InDesign, ask the document creator to provide IDML.\nRaw binary recovery in Recto only extracts possible fragments and previews; it cannot recreate the original layout.\n`;

export function InddImportModal({ file, onClose }: { file: File; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useModalFocus(true, dialog);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const kit = () => run(async () => {
    const archive = createZipArchive({ 'Recto-Export-IDML.jsx': conversionScript, 'README.txt': instructions });
    await savePublicationFile('Recto-IDML-Conversion.zip', archive, 'application/zip');
  });
  const recover = () => run(async () => {
    if (!acknowledged) return;
    if (file.size > 128 * 1024 * 1024) throw new Error('Recovery supports files up to 128 MB. Export IDML for larger documents.');
    await stateManager.loadFromIndd(await file.arrayBuffer(), file.name, { recoverContent: true });
    onClose();
  });
  return <div className="modal-overlay equation-overlay" onKeyDown={event => {
    event.stopPropagation(); if (event.key === 'Escape' && !busy) onClose();
  }}><div className="equation-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="indd-title">
    <header><div><h2 id="indd-title">Open an InDesign document</h2><p>{file.name}</p></div></header>
    <div className="equation-body">
      <p><strong>Use IDML for an editable layout.</strong> Recto cannot reconstruct a native INDD database directly.</p>
      <p>Open the document in InDesign and export <strong>InDesign Markup (IDML)</strong>, then import that file here. Fonts, linked images and unsupported layout features may need review.</p>
      <p className="equation-help">The conversion kit includes a script to export the active document in your installed InDesign and instructions. It leaves the original document open and does not save it. If you do not have InDesign, ask the document creator for IDML.</p>
      <button className="action-btn" onClick={kit} disabled={busy}>Save IDML conversion kit…</button>
      <button className="action-btn-primary" onClick={() => input.current?.click()} disabled={busy}>Import converted IDML…</button>
      <input ref={input} type="file" accept=".idml" hidden onChange={event => {
        const converted = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (converted) void run(async () => { await stateManager.loadFromIdml(await converted.arrayBuffer(), converted.name); onClose(); });
      }}/>
      <details><summary>Recover fragments without InDesign</summary>
        <div className="equation-body">
          <p className="equation-help">Recovery can extract a preview, metadata and possible text fragments. Text may be missing, duplicated or out of order. Original pages, styles and object positions are unavailable. Recovery pages use a clearly labelled A4 workspace.</p>
          <label className="equation-check"><input type="checkbox" checked={acknowledged}
            onChange={event => setAcknowledged(event.currentTarget.checked)}/> Replace the current document with recovered content</label>
          <button className="action-btn" disabled={!acknowledged || busy} onClick={recover}>Recover content only</button>
        </div>
      </details>
      {error && <p className="equation-error" role="alert">{error}</p>}
    </div>
    <footer><p className="equation-help">Save your current project before importing another document.</p><span/>
      <button className="action-btn" onClick={onClose} disabled={busy}>Cancel</button></footer>
  </div></div>;
}
