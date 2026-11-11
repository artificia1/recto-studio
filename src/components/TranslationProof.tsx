import { useState } from 'preact/hooks';
import { LayoutChangeSummary } from './LayoutChangeSummary';
import { PreflightChangeSummary } from './PreflightChangeSummary';
import { TranslationFrameProof } from './TranslationFrameProof';
import type { previewTranslatedEdition } from '../translation/edition';

export function TranslationProof({ proof, selected, available, navigate }: {
  proof: ReturnType<typeof previewTranslatedEdition>;
  selected: number;
  available: number;
  navigate: (id: string) => void;
}) {
  const [limit, setLimit] = useState(20);
  return <section aria-label="Translated edition proof">
    <h3>Translated edition proof</h3>
    <p>{selected.toLocaleString()} units will be replaced. The remaining copy and the source project stay as they are.</p>
    {selected < available && <p role="status">This edition retains source-language text in units you did not select.</p>}
    <LayoutChangeSummary result={proof.layout} onNavigate={navigate}/>
    <PreflightChangeSummary result={proof.preflight}/>
    <TranslationFrameProof source={proof.frameProof}/>
    <details open={proof.fonts.some(finding => finding.missing.length > 0)}>
      <summary>Font coverage ({proof.fonts.length} findings)</summary>
      {proof.fonts.length === 0 && <p>The loaded fonts cover the checked characters.</p>}
      <ul className="translation-font-findings">{proof.fonts.slice(0, limit).map(finding =>
        <li key={JSON.stringify([finding.frameId, finding.family])}>
          <p><strong>{finding.family}</strong> · {finding.unverified ? 'Load the font file to verify its character coverage.'
            : `Missing characters: ${finding.missing.map(char => `${char} (U+${char.codePointAt(0)!.toString(16).toUpperCase()})`).join(', ')}`}</p>
          <button className="sm-btn" onClick={() => navigate(finding.frameId)}>Locate source frame</button>
        </li>)}</ul>
      {proof.fonts.length > limit && <button className="sm-btn" onClick={() => setLimit(limit + 20)}>Show more font findings</button>}
    </details>
  </section>;
}
