import { useEffect, useState } from 'preact/hooks';
import { fontManager } from '../../fontManager';
import { stateManager } from '../../state';
import { variationCss } from '../../engine/fontVariations';
import type { TextElement } from '../../types';

export default function VariableFontPanel({ element }: { element: TextElement }) {
  const font = fontManager.getFont(element.fontFamily);
  const axes = Object.entries(font?.variationAxes || {}).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => !!entry[1]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const saved = fontManager.getFontAsset(element.fontFamily)?.variations;
    setValues(Object.fromEntries(axes.map(([tag, axis]) => [tag, saved?.[tag] ?? axis.default])));
    setMessage('');
  }, [element.id, element.fontFamily]);
  if (!axes.length) return null;
  return <details className="publication-panel">
    <summary>Variable font axes</summary>
    <p>Sliders preview the imported font live. Apply saves an instance for layout and export as one font choice. Optical size is manual; PDF uses shaped outlines.</p>
    {axes.map(([tag, axis]) => <label key={tag}>{axis.name} ({tag}) · {values[tag] ?? axis.default}
      <input aria-label={`Font axis ${tag}`} type="range" min={axis.min} max={axis.max} step={(axis.max - axis.min) / 1000 || 1}
        value={values[tag] ?? axis.default} disabled={busy} onInput={event => setValues({ ...values, [tag]: Number(event.currentTarget.value) })}/>
    </label>)}
    <p aria-label="Variable font preview" style={{ fontFamily: `"${element.fontFamily.replace(/["\\]/g, '')}"`, fontVariationSettings: variationCss(values), fontSize: '24px' }}>Aa Hamburgefonts 012345</p>
    <div className="publication-actions"><button className="sm-btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const family = await fontManager.createVariation(element.fontFamily, values);
        if (stateManager.getState().selectedElementId !== element.id) throw new Error('Selection changed. Select the intended frame and apply again.');
        const current = stateManager.getElementById(element.id);
        if (!current || current.locked || stateManager.getState().layers.find(layer => layer.id === current.layerId)?.locked) throw new Error('Unlock the frame and its layer first.');
        stateManager.applyImportedFont(element.id, family);
        setMessage('Variable font instance applied.');
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    }}>{busy ? 'Applying axes…' : 'Apply font axes'}</button>
    <button className="sm-btn" disabled={busy} onClick={() => setValues(Object.fromEntries(axes.map(([tag, axis]) => [tag, axis.default])))}>Reset preview</button></div>
    {message && <p role="status">{message}</p>}
  </details>;
}
