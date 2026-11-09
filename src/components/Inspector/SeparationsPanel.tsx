import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProjectState } from '../../types';
import { resolveMaster } from '../../engine/masterInheritance';
import { captureProofArtwork } from '../../engine/proofCapture';
import { separateProof, displayProof } from '../../engine/inkProof';

export default function SeparationsPanel({ state }: { state: ProjectState }) {
  const [open, setOpen] = useState(false), [plates, setPlates] = useState([true, true, true, true]);
  const [spot, setSpot] = useState(''), [heatmap, setHeatmap] = useState(false);
  const [limit, setLimit] = useState(state.settings.colorManagement?.tacLimit || 300);
  const [sample, setSample] = useState<{ width: number; height: number; cmyk: Uint8Array; state: ProjectState; spot: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [meter, setMeter] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null), serial = useRef(0);
  const context = useRef({ state, spot });
  if (context.current.state !== state || context.current.spot !== spot) context.current = { state, spot };
  const spread = state.spreads[state.activeSpreadIndex];
  const spots = [...new Set([...spread.elements, ...(resolveMaster(state.masterSpreads, spread.masterSpreadId)?.elements || [])].map(element => element.spotColor).filter((value): value is string => !!value))].sort();
  const capture = async () => {
    const generation = ++serial.current;
    const target = context.current;
    setSample(undefined); setMeter(''); setBusy(true);
    try {
      setMessage('Sampling visible artwork…');
      const source = captureProofArtwork(spot || undefined), pixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
      const cmyk = await separateProof(pixels.data, spot ? undefined : state.settings.colorManagement);
      if (generation !== serial.current || target !== context.current) return;
      setSample({ width: source.width, height: source.height, cmyk, state, spot }); setMessage('');
    } catch (error) { if (generation === serial.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (generation === serial.current) setBusy(false); }
  };
  useEffect(() => { setLimit(state.settings.colorManagement?.tacLimit || 300); }, [state.settings.identifier, state.settings.colorManagement?.tacLimit]);
  useEffect(() => { if (spot && !spots.includes(spot)) setSpot(''); }, [spot, spots.join('\u0000')]);
  useEffect(() => {
    setSample(undefined); setMeter(''); setMessage(''); setBusy(false);
    if (!open) return;
    const timeout = setTimeout(() => void capture(), 300);
    return () => { clearTimeout(timeout); serial.current++; };
  }, [open, state, spot]);
  useEffect(() => {
    if (!canvas.current) return;
    if (!sample || sample.state !== state || sample.spot !== spot) { canvas.current.width = 1; canvas.current.height = 1; return; }
    const result = displayProof(sample.cmyk, spot ? [false, false, false, true] : plates, limit, heatmap && !spot);
    canvas.current.width = sample.width; canvas.current.height = sample.height;
    canvas.current.getContext('2d')!.putImageData(new ImageData(result.rgba, sample.width, sample.height), 0, 0);
    setMeter(`Maximum ${result.maximum.toFixed(1)}% · ${result.exceeded.toLocaleString()} samples above ${limit}%`);
  }, [sample, state, plates, heatmap, limit, spot]);
  return <details className="publication-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Separations preview</summary>
    {open && <>
      <p>{state.settings.colorManagement ? 'ICC simulation using your output profile.' : 'Approximate CMYK simulation. Import an output ICC profile for managed separations.'} Samples the visible canvas artwork; guides and selection handles are excluded.</p>
      <label>Proof plate<select aria-label="Proof plate" value={spot} onChange={event => setSpot(event.currentTarget.value)}><option value="">Process CMYK</option>{spots.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {!spot && <><div className="publication-actions proof-plates">{['Cyan', 'Magenta', 'Yellow', 'Black'].map((name, index) => <label className="publication-check" key={name}><input type="checkbox" checked={plates[index]} onChange={event => setPlates(plates.map((value, i) => i === index ? event.currentTarget.checked : value))}/>{name}</label>)}</div>
        <label>TAC threshold (%)<input aria-label="Proof TAC threshold" type="number" min={100} max={400} value={limit} onChange={event => setLimit(Math.max(100, Math.min(400, Number(event.currentTarget.value) || 300)))}/></label>
        <label className="publication-check"><input type="checkbox" checked={heatmap} onChange={event => setHeatmap(event.currentTarget.checked)}/>Highlight excessive ink coverage</label></>}
      <canvas ref={canvas} aria-label="Ink separations artwork preview" aria-busy={busy} style={{ width: '100%', maxHeight: '280px', objectFit: 'contain', background: '#fff', border: '1px solid #555' }}/>
      {!spot && <p role="status">{meter}</p>}
      <button className="sm-btn" disabled={busy} onClick={() => void capture()}>Refresh ink preview</button>
      <p>Composite simulation cannot recover original CMYK values or reproduce RIP overprints, trapping or knockout interactions. Spot isolation shows the selected objects' artwork; white ink and finishing plates require printer verification.</p>
      {message && <p role="status">{message}</p>}
    </>}
  </details>;
}
