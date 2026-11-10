import { useState } from 'preact/hooks';
import { createLayoutLink, linkableElements, newLayoutBundle, previewLayoutLink, readLayoutBundle } from '../../engine/layoutBundle';
import { savePublicationFile } from '../../desktop';
import { INITIAL_STATE } from '../../state/defaults';
import { parseProject } from '../../state/projectValidation';

const limit = 128 * 1024 * 1024;
const parse = (text: string) => parseProject(text, INITIAL_STATE);

export default function PublicationBundlePanel() {
  const [bundle, setBundle] = useState(newLayoutBundle);
  const [sourceLayoutId, setSourceLayoutId] = useState('');
  const [sourceElementId, setSourceElementId] = useState('');
  const [targetLayoutId, setTargetLayoutId] = useState('');
  const [targetElementId, setTargetElementId] = useState('');
  const [refreshId, setRefreshId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewLayoutLink>>>();
  const [replaceLocal, setReplaceLocal] = useState(false);
  const disabled = busy || !!preview;
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const getLayout = (id: string) => bundle.layouts.find(layout => layout.id === id);
  const layoutOptions = (except?: string) => bundle.layouts.filter(layout => layout.id !== except).map(layout =>
    <option value={layout.id} key={layout.id}>{layout.name}</option>);
  const elements = (layoutId: string, type?: string) => linkableElements(getLayout(layoutId)).filter(element => !type || element.type === type).map(element =>
    <option key={element.id} value={element.id}>{element.type === 'text' ? element.text.slice(0, 65) || 'Empty story' : element.name || element.id}</option>);
  const source = linkableElements(getLayout(sourceLayoutId)).find(element => element.id === sourceElementId);
  return <details>
    <summary>Shared layouts</summary>
    <p>Keep each size in its own editable project. Link content between layouts and review updates before applying them.</p>
    <label>Add layout or open publication bundle<input type="file" accept=".recto,.json,.rectoset" disabled={disabled} onChange={event => {
      const input = event.currentTarget, file = input.files?.[0];
      input.value = '';
      if (!file) return;
      void run(async () => {
        if (file.size > limit) throw new Error('Choose a file smaller than 128 MB.');
        if (/\.rectoset$/i.test(file.name)) {
          setBundle(readLayoutBundle(await file.text(), parse));
          setSourceLayoutId(''); setTargetLayoutId(''); setSourceElementId(''); setTargetElementId(''); setRefreshId('');
        } else {
          if (bundle.layouts.length >= 24) throw new Error('A bundle supports up to 24 layouts.');
          const state = parse(await file.text());
          setBundle({ ...bundle, layouts: [...bundle.layouts, { id: crypto.randomUUID(), name: state.settings.title || file.name, state }] });
        }
      });
    }}/></label>
    {!!bundle.layouts.length && <>
      <ul className="editorial-list">{bundle.layouts.map(layout => <li key={layout.id}>
        {layout.name} · {layout.state.settings.widthMm} × {layout.state.settings.heightMm} mm
        <button className="sm-btn" disabled={disabled} onClick={() => run(async () => {
          const name = layout.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'layout';
          await savePublicationFile(`${name}.recto`, JSON.stringify(layout.state), 'application/json');
        })}>Download editable layout</button>
      </li>)}</ul>
      <label>Layout to refresh<select value={refreshId} disabled={disabled} onChange={event => setRefreshId(event.currentTarget.value)}>
        <option value="">Choose layout</option>{layoutOptions()}
      </select></label>
      <label>Revised layout file<input type="file" accept=".recto,.json" disabled={disabled || !refreshId} onChange={event => {
        const input = event.currentTarget, file = input.files?.[0];
        input.value = '';
        if (!file) return;
        void run(async () => {
          if (file.size > limit) throw new Error('Choose a file smaller than 128 MB.');
          const state = parse(await file.text());
          setBundle({ ...bundle, layouts: bundle.layouts.map(layout => layout.id === refreshId ? { ...layout, state } : layout) });
          setMessage('Layout snapshot refreshed. Review any linked updates separately.');
        });
      }}/></label>
      <button className="sm-btn" disabled={disabled} onClick={() => run(async () => {
        const data = JSON.stringify(bundle);
        if (new Blob([data]).size > limit) throw new Error('Publication bundles must be smaller than 128 MB.');
        if (await savePublicationFile('publication.rectoset', data, 'application/json')) setMessage('Publication bundle saved.');
      })}>Save publication bundle</button>
    </>}
    {bundle.layouts.length > 1 && <div>
      <label>Source layout<select aria-label="Source layout" value={sourceLayoutId} disabled={disabled} onChange={event => {
        setSourceLayoutId(event.currentTarget.value); setSourceElementId(''); setTargetLayoutId(''); setTargetElementId('');
      }}><option value="">Choose layout</option>{layoutOptions()}</select></label>
      <label>Source object<select aria-label="Source object" value={sourceElementId} disabled={disabled || !sourceLayoutId} onChange={event => {
        setSourceElementId(event.currentTarget.value); setTargetElementId('');
      }}><option value="">Choose object</option>{elements(sourceLayoutId)}</select></label>
      <label>Destination layout<select aria-label="Destination layout" value={targetLayoutId} disabled={disabled || !source} onChange={event => {
        setTargetLayoutId(event.currentTarget.value); setTargetElementId('');
      }}><option value="">Choose layout</option>{layoutOptions(sourceLayoutId)}</select></label>
      <label>Destination object<select aria-label="Destination object" value={targetElementId} disabled={disabled || !targetLayoutId} onChange={event => setTargetElementId(event.currentTarget.value)}>
        <option value="">Choose object</option>{elements(targetLayoutId, source?.type)}</select></label>
      <button className="sm-btn" disabled={disabled || !targetElementId || !source} onClick={() => run(async () => {
        const link = await createLayoutLink(bundle, { sourceLayoutId, sourceElementId, targetLayoutId, targetElementId });
        setBundle({ ...bundle, links: [...bundle.links, link] }); setMessage('Link created. Preview an update to copy the source content.');
      })}>Link layout objects</button>
    </div>}
    <ul className="editorial-list">{bundle.links.map(link => <li key={link.id}>
      <p>{getLayout(link.sourceLayoutId)?.name} → {getLayout(link.targetLayoutId)?.name}</p>
      <button className="sm-btn" disabled={disabled} onClick={() => run(async () => {
        setReplaceLocal(false); setPreview(await previewLayoutLink(bundle, link));
      })}>Preview linked update</button>
      <button className="sm-btn" disabled={disabled} onClick={() => setBundle({ ...bundle, links: bundle.links.filter(item => item.id !== link.id) })}>Detach link</button>
    </li>)}</ul>
    {preview && <section aria-label="Linked layout update preview">
      <p>{preview.sourceName} → {preview.targetName} · {preview.changed ? 'Content will change' : 'Content is already current'}</p>
      <details open={preview.changed}><summary>Compare content</summary>
        <p>Current destination</p><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '10em', overflow: 'auto' }}>{preview.before}</div>
        <p>After update</p><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '10em', overflow: 'auto' }}>{preview.after}</div>
      </details>
      {preview.conflict && <label><input type="checkbox" checked={replaceLocal} onChange={event => setReplaceLocal(event.currentTarget.checked)}/>
        Replace locally edited destination content</label>}
      <button className="sm-btn" disabled={preview.conflict && !replaceLocal} onClick={() => {
        setBundle(preview.next); setPreview(undefined); setMessage('Linked update applied. Download the updated layout or save the bundle.');
      }}>Apply linked update</button>
      <button className="sm-btn" onClick={() => setPreview(undefined)}>Cancel linked update</button>
    </section>}
    {message && <p role="status">{message}</p>}
  </details>;
}
