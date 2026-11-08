import { useState } from 'preact/hooks';
import type { ColorManagementSettings, ProjectState, RenderingIntent } from '../../types';
import { stateManager } from '../../state';
import { createProfileAsset, profileBytes, MAX_ICC_BYTES } from '../../engine/iccProfiles';
import { convertIcc, describeIcc } from '../../engine/colorService';

export default function ColorManagementPanel({ state }: { state: ProjectState }) {
  const settings = state.settings.colorManagement;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sample, setSample] = useState('#806040');
  const [result, setResult] = useState('');
  const change = (updates: Partial<ColorManagementSettings>) => {
    if (settings) stateManager.updateSettings({ colorManagement: { ...settings, ...updates } });
    setResult('');
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <details className="publication-panel">
    <summary>ICC colour management</summary>
    <p>Import your printer's CMYK ICC profile for LittleCMS conversions. The profile file is saved with this project. FOGRA, GRACoL and SWOP names alone do not supply a profile.</p>
    <label>CMYK output profile<input aria-label="CMYK output ICC profile" type="file" accept=".icc,.icm" disabled={busy} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      if (!file) return;
      void run(async () => {
        if (file.size > MAX_ICC_BYTES) throw new Error('Choose an ICC profile no larger than 16 MiB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const description = await describeIcc(bytes);
        const outputProfile = await createProfileAsset(bytes, file.name, description);
        stateManager.updateSettings({ colorManagement: { outputProfile, intent: 'relative',
          blackPointCompensation: true, preservePureBlack: true, convertPdf: true, tacLimit: 300 } });
        setResult(''); setMessage('Output profile loaded.');
      });
    }}/></label>
    {settings && <>
      <p><strong>{settings.outputProfile.description}</strong><br/>{settings.outputProfile.name}</p>
      <label>Rendering intent<select aria-label="ICC rendering intent" value={settings.intent} disabled={busy} onChange={event => change({ intent: event.currentTarget.value as RenderingIntent })}>
        <option value="perceptual">Perceptual</option><option value="relative">Relative colorimetric</option>
        <option value="saturation">Saturation</option><option value="absolute">Absolute colorimetric</option>
      </select></label>
      <label className="publication-check"><input type="checkbox" checked={settings.blackPointCompensation} onChange={event => change({ blackPointCompensation: event.currentTarget.checked })}/>Black point compensation</label>
      <label className="publication-check"><input type="checkbox" checked={settings.preservePureBlack} onChange={event => change({ preservePureBlack: event.currentTarget.checked })}/>Keep exact RGB black as 100% K</label>
      <label className="publication-check"><input type="checkbox" checked={settings.convertPdf} onChange={event => change({ convertPdf: event.currentTarget.checked })}/>Convert PDF artwork to output profile</label>
      <label>Ink coverage warning (%)<input aria-label="ICC TAC threshold" type="number" min={100} max={400} value={settings.tacLimit} onChange={event => change({ tacLimit: Math.max(100, Math.min(400, Number(event.currentTarget.value) || 300)) })}/></label>
      <label>Test sRGB colour<input aria-label="ICC test colour" type="color" value={sample} onInput={event => { setSample(event.currentTarget.value); setResult(''); }}/></label>
      <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
        const pixels = new Uint8Array([1, 3, 5].map(offset => parseInt(sample.slice(offset, offset + 2), 16)));
        const converted = await convertIcc({ profile: profileBytes(settings.outputProfile), pixels, direction: 'rgb-to-cmyk',
          intent: settings.intent, blackPointCompensation: settings.blackPointCompensation, preservePureBlack: settings.preservePureBlack });
        const values = Array.from(converted, value => Math.round(value / 255 * 1000) / 10);
        setResult(`C ${values[0]}% · M ${values[1]}% · Y ${values[2]}% · K ${values[3]}% · TAC ${(values.reduce((a, b) => a + b, 0)).toFixed(1)}%`);
      })}>Test ICC conversion</button>
      {result && <p role="status">{result}</p>}
      <button className="sm-btn" disabled={busy} onClick={() => { stateManager.updateSettings({ colorManagement: undefined }); setResult(''); }}>Remove output profile</button>
    </>}
    <p>Pure-black preservation is a local override to ICC separation. Soft-proof previews and final press appearance also depend on the monitor, paper and RIP.</p>
    {busy && <p role="status">Processing colour profile…</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
