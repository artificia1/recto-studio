import { useMemo, useState } from 'preact/hooks';
import type { createTranslationFrameProof, FrameProof } from '../translation/frameProof';

const ptToMm = 25.4 / 72;

function ProofSide({ title, proof }: { title: string; proof?: FrameProof }) {
  if (!proof) return <div><h4>{title}</h4><p>This frame is excluded from this edition.</p></div>;
  const maxLines = 120;
  return <div className="translation-frame-side">
    <h4>{title}</h4>
    <p>{proof.lines.length} lines · {proof.placed.toLocaleString()} placed characters
      {proof.overset && ` · ${proof.remaining.toLocaleString()} overset characters`}</p>
    <svg viewBox={`0 0 ${Math.max(proof.width, 1)} ${Math.max(proof.height, 1)}`}
      className={proof.overset ? 'translation-frame-svg translation-frame-overset' : 'translation-frame-svg'}
      role="img" aria-label={`${title}, page ${proof.page}, ${proof.lines.length} composed lines`}>
      <rect x={0} y={0} width={proof.width} height={proof.height} fill="white"/>
      {proof.lines.slice(0, maxLines).flatMap((line, lineIndex) => line.segments.map((segment, index) =>
        <text key={`${lineIndex}-${index}`} x={segment.x} y={line.y + segment.style.fontSizePt * ptToMm}
          font-family={segment.style.fontFamily} font-size={segment.style.fontSizePt * ptToMm}
          font-weight={segment.style.bold ? 'bold' : 'normal'} font-style={segment.style.italic ? 'italic' : 'normal'}
          text-decoration={segment.style.underline ? 'underline' : 'none'}
          fill={segment.style.color} xml:space="preserve">{segment.text}</text>))}
      {proof.notes.lines.slice(0, maxLines).map((line, index) =>
        <text key={`note-${index}`} x={proof.padding + line.x} y={proof.height - proof.padding - proof.notes.height + 3 + line.y}
          font-family={proof.notes.family} font-size={proof.notes.size * ptToMm} fill={proof.color}
          xml:space="preserve">{line.text}</text>)}
    </svg>
    {proof.lines.length > maxLines && <p>The drawing shows the first 120 lines.</p>}
    <details><summary>Read frame text</summary><p className="translation-proof-text" dir="auto">{proof.text.slice(0, 4000)}</p>
      {proof.text.length > 4000 && <p>Text preview shows the first 4,000 characters.</p>}
    </details>
  </div>;
}

export function TranslationFrameProof({ source }: { source: ReturnType<typeof createTranslationFrameProof> }) {
  const [id, setId] = useState('');
  const [opened, setOpened] = useState(false);
  const active = id || source.frames[0]?.id;
  const proof = useMemo(() => opened && active ? source.compare(active) : undefined, [opened, active, source]);
  if (!source.frames.length) return null;
  const change = proof?.before && proof.after ? proof.after.remaining - proof.before.remaining : 0;
  return <details onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Compare composed text frames</summary>
    <label>Frame<select value={active} onChange={event => setId(event.currentTarget.value)}>
      {source.frames.map(frame => <option key={frame.id} value={frame.id}>Page {frame.page} · {frame.label}</option>)}
    </select></label>
    {change > 0 && <p role="status">The translated frame leaves {change.toLocaleString()} more characters overset.</p>}
    {proof && <div className="translation-bilingual">
      <ProofSide title="Source frame" proof={proof.before}/>
      <ProofSide title="Translated frame" proof={proof.after}/>
    </div>}
  </details>;
}
