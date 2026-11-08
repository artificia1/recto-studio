import type { ProjectState } from '../../types';
import { printReadiness } from '../../engine/printReadiness';
import { stateManager } from '../../state';
import { savePublicationFile } from '../../desktop';
import { useState } from 'preact/hooks';

export default function PrintReadinessPanel({ state }: { state: ProjectState }) {
  const report = printReadiness(state);
  const [status, setStatus] = useState('');
  return <details className="publication-panel">
    <summary>Print production readiness</summary>
    <p>Ordinary PDF output. PDF/X certification, ICC conversion, automatic trapping and transparency flattening are not implemented.</p>
    <ul>{report.requirements.map(requirement => <li key={requirement}><p>{requirement}</p></li>)}</ul>
    <ul className="editorial-list">{report.items.map((item, index) => <li key={`${item.elementId}-${index}`}>
      <button className="editorial-jump" onClick={() => stateManager.zoomToElement(item.elementId)}><span>{item.severity === 'error' ? 'Unsupported effect: ' : 'Review: '}{item.message}</span></button>
    </li>)}</ul>
    <div className="publication-actions"><button className="sm-btn" onClick={async () => {
      try {
        const saved = await savePublicationFile('recto-print-readiness.json', JSON.stringify(report, null, 2), 'application/json');
        setStatus(saved ? 'Readiness report saved.' : 'Save cancelled.');
      } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    }}>Save production report</button></div>
    {status && <p role="status">{status}</p>}
  </details>;
}
