import { useEffect, useRef, useState } from 'preact/hooks';
import { savePublicationFile } from '../desktop';
import type { PrinterProfile } from '../engine/printerProfiles';
import { inspectDeliveryPdf, type PdfDeliveryReport } from '../export/pdfDelivery';
import { useModalFocus } from '../hooks/useModalFocus';
import './proofReview.css';

export default function PdfDeliveryDialog({ printer, onClose }: { printer?: PrinterProfile; onClose(): void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const [file, setFile] = useState<File>();
  const [report, setReport] = useState<PdfDeliveryReport>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useModalFocus(true, dialog);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      if (active.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const inspect = (source: File) => run(async () => {
    setReport(undefined);
    const inspected = await inspectDeliveryPdf(source, printer);
    if (active.current) {
      setReport(inspected);
      setMessage('Delivery inspection complete.');
    }
  });

  const save = (inspected: PdfDeliveryReport) => run(async () => {
    const base = inspected.source.name.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'publication';
    const saved = await savePublicationFile(`${base}-delivery-report.json`, JSON.stringify(inspected, null, 2), 'application/json');
    if (saved && active.current) setMessage('Delivery report saved.');
  });

  return <div className="modal-overlay" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
    <div className="proof-dialog pdf-delivery-dialog" role="dialog" aria-modal="true" aria-label="Inspect delivery PDF" ref={dialog}>
      <header>
        <div><h2>Inspect delivery PDF</h2><p>Check page boxes, fonts and output profiles in the file you plan to send.</p></div>
        <button className="sm-btn" onClick={onClose}>Close</button>
      </header>
      <div className="proof-inputs"><label>Delivery PDF
        <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={event => {
          setFile(event.currentTarget.files?.[0]); setReport(undefined); setMessage('');
        }}/>
      </label></div>
      {printer && <p>Printer requirements for {printer.name} · Bleed and output ICC</p>}
      <div className="publication-actions">
        <button className="sm-btn" disabled={!file || busy} onClick={() => file && void inspect(file)}>Inspect PDF</button>
        <button className="sm-btn" disabled={!report || busy} onClick={() => report && void save(report)}>Save delivery report</button>
      </div>
      <p role="status">{message || (busy ? 'Working…' : '')}</p>
      {report && <section aria-label="Delivery inspection results">
        <p><strong>{report.source.name}</strong> · {report.pages.length} {report.pages.length === 1 ? 'page' : 'pages'} ·
          PDF {report.source.pdfCatalogVersion || report.source.pdfHeaderVersion} · {report.tagged ? 'Structure tree present' : 'No structure tree'}</p>
        <p className="pdf-delivery-hash">SHA-256 <code>{report.source.sha256}</code></p>
        {report.findings.length ? <ul className="editorial-list">
          {report.findings.map((item, index) => <li key={index}><strong>{item.severity === 'error' ? 'Fix' : 'Review'}
            {item.page && ` · Page ${item.page}`}</strong><p>{item.message}</p></li>)}
        </ul> : <p>No issues found in the inspected fields.</p>}
        <details>
          <summary>Page boxes ({report.pages.length})</summary>
          <ol>{report.pages.map(page => <li key={page.number}>
            {page.trimSizeMm ? `Trim ${page.trimSizeMm.width.toFixed(2)} × ${page.trimSizeMm.height.toFixed(2)} mm` : 'No explicit valid trim box'}
            {page.bleedMm && ` · Minimum bleed ${Math.min(...Object.values(page.bleedMm)).toFixed(2)} mm`}
          </li>)}</ol>
        </details>
        <details>
          <summary>Font resources ({report.fonts.length})</summary>
          {!!report.fonts.length && <ul>{report.fonts.map((font, index) => <li key={index}>
            {font.name} · {font.embedding === 'type3-glyphs' ? 'Type 3 glyphs' : font.embedding === 'embedded' ? 'Embedded program' : 'No embedded program'}
            {font.unicodeMap && ' · ToUnicode present'}
          </li>)}</ul>}
        </details>
        <details>
          <summary>Output intents ({report.outputIntents.length})</summary>
          {!!report.outputIntents.length && <ul>{report.outputIntents.map((intent, index) => <li key={index}>
            {intent.identifier || intent.subtype || `Intent ${index + 1}`}
            {intent.profile && ` · ${intent.profile.colorSpace} ICC v${intent.profile.version}`}
          </li>)}</ul>}
        </details>
        <p>Review separately for image resolution, ink coverage, artwork at the bleed edge and standards conformance.</p>
      </section>}
    </div>
  </div>;
}
