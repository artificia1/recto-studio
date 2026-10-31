import { useEffect, useRef, useState } from 'preact/hooks';
import { useModalFocus } from '../hooks/useModalFocus';
import { EQUATION_TEMPLATES, renderEquation, type RenderedEquation } from '../engine/equations';
import { stateManager } from '../state';
import { savePublicationFile } from '../desktop';
import type { EquationSource, ImageElement } from '../types';
import './equations.css';

export function EquationModal({ element, onClose }: { element?: ImageElement; onClose: () => void }) {
  const [source, setSource] = useState<EquationSource>(element?.equation || {
    latex: EQUATION_TEMPLATES[0].latex, fontSizePt: 18, color: '#111111', displayMode: true,
  });
  const [description, setDescription] = useState(element?.altText || '');
  const [fitFrame, setFitFrame] = useState(!element);
  const [result, setResult] = useState<RenderedEquation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const spreadId = useRef(stateManager.getActiveSpread().id);
  useModalFocus(true, dialog);
  useEffect(() => {
    setResult(null);
    setError('');
    const timer = setTimeout(() => {
      try { setResult(renderEquation(source)); }
      catch (error) { setError(error instanceof Error ? error.message : 'Could not render this equation.'); }
    }, 200);
    return () => clearTimeout(timer);
  }, [source]);
  const change = (patch: Partial<EquationSource>) => { setResult(null); setSource(previous => ({ ...previous, ...patch })); };
  const save = () => {
    if (!result) return;
    const state = stateManager.getState();
    const spread = stateManager.getActiveSpread();
    if (spread.id !== spreadId.current) { setError('The active spread changed. Close and reopen the equation editor.'); return; }
    const current = element && spread.elements.find(item => item.id === element.id);
    const layerId = current?.layerId || state.activeLayerId;
    if (current?.locked || state.layers.some(layer => layer.id === layerId && layer.locked)) {
      setError('Unlock the object and its layer before editing.'); return;
    }
    const updates: Partial<ImageElement> = {
      equation: { ...source }, src: result.dataUrl, altText: description.trim() || `Equation: ${source.latex}`,
      originalWidth: result.widthMm * 96 / 25.4, originalHeight: result.heightMm * 96 / 25.4,
      format: 'SVG', fitMode: 'fit', proxySrc: undefined, assetId: undefined,
      ...(fitFrame ? { width: Number(result.widthMm.toFixed(3)), height: Number(result.heightMm.toFixed(3)) } : {}),
    };
    if (element) {
      if (!current || current.type !== 'image' || !current.equation) { setError('This equation is no longer available.'); return; }
      stateManager.updateElement(element.id, updates);
    } else {
      const selected = spread.elements.find(item => item.id === state.selectedElementId);
      const page = spread.pages.find(page => page.id === selected?.pageId) || spread.pages[0];
      if (!page) { setError('Create a page before inserting an equation.'); return; }
      const margins = state.settings.margins;
      stateManager.addElement({
        id: `equation-${crypto.randomUUID()}`, name: 'Equation', type: 'image', pageId: page.id,
        x: page.side === 'left' ? margins.outsideMm : margins.insideMm, y: margins.topMm,
        width: result.widthMm, height: result.heightMm, rotation: 0, opacity: 1,
        zIndex: Math.max(0, ...spread.elements.map(item => item.zIndex)) + 1,
        locked: false, src: result.dataUrl, fitMode: 'fit', borderColor: 'transparent', borderWidthMm: 0,
        ...updates,
      });
    }
    onClose();
  };
  const download = async () => {
    if (!result || busy) return;
    setBusy(true);
    try { await savePublicationFile('equation.svg', result.svg, 'image/svg+xml'); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay equation-overlay" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) onClose();
  }}>
    <div className="equation-dialog" role="dialog" aria-modal="true" aria-labelledby="equation-title" ref={dialog}>
      <header><div><h2 id="equation-title">{element ? 'Edit equation' : 'Insert equation'}</h2>
        <p>Typeset mathematics with LaTeX. Your source stays editable.</p></div>
        <button className="action-btn" aria-label="Close equation editor" onClick={onClose} disabled={busy}>×</button></header>
      <div className="equation-body">
        <label>Start from a template<select value="" onChange={event => {
          const template = EQUATION_TEMPLATES.find(item => item.name === event.currentTarget.value);
          if (template) change({ latex: template.latex });
        }}><option value="">Choose a formula…</option>{EQUATION_TEMPLATES.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
        <label>LaTeX source<textarea spellcheck={false} value={source.latex} maxLength={6000} rows={5}
          onInput={event => change({ latex: event.currentTarget.value })} /></label>
        <div className="equation-settings">
          <label>Type size (pt)<input type="number" min={6} max={144} step={1} value={source.fontSizePt}
            onInput={event => change({ fontSizePt: Number(event.currentTarget.value) })}/></label>
          <label>Ink colour<input type="color" value={source.color} onInput={event => change({ color: event.currentTarget.value })}/></label>
          <label>Math style<select value={source.displayMode ? 'display' : 'compact'}
            onChange={event => change({ displayMode: event.currentTarget.value === 'display' })}>
            <option value="display">Display</option><option value="compact">Compact</option></select></label>
        </div>
        <div className="equation-preview" aria-label="Equation preview" aria-busy={!result && !error}>
          {result ? <img src={result.dataUrl} alt={description || 'Equation preview'}/> : <span>{error ? 'Preview unavailable' : 'Typesetting…'}</span>}
        </div>
        {result && <p className="equation-size">Natural size: {result.widthMm.toFixed(1)} × {result.heightMm.toFixed(1)} mm</p>}
        <div aria-live="polite">{error && <p className="equation-error" role="alert">{error}</p>}</div>
        <label>Accessible description<input type="text" value={description} placeholder="Describe the formula in words" maxLength={2000}
          onInput={event => setDescription(event.currentTarget.value)}/></label>
        {element && <label className="equation-check"><input type="checkbox" checked={fitFrame}
          onChange={event => setFitFrame(event.currentTarget.checked)}/> Resize frame to the equation’s natural size</label>}
        <p className="equation-help">Supports fractions, roots, Greek letters, matrices, aligned equations and cases. Paste math directly, with or without $ delimiters. Full LaTeX documents and external packages are not supported.</p>
      </div>
      <footer><button className="action-btn" onClick={download} disabled={!result || busy}>Save SVG…</button>
        <span/><button className="action-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="action-btn-primary" onClick={save} disabled={!result || busy}>{element ? 'Apply equation' : 'Insert equation'}</button></footer>
    </div>
  </div>;
}
