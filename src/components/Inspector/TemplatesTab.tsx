import { stateManager } from '../../state';
import { TEMPLATES } from '../../templates';
import type { ProjectState, Spread } from '../../types';
import { useEffect, useState } from 'preact/hooks';
import { createPublicationStarter, PUBLICATION_STARTERS, type PublicationStarter } from '../../engine/publicationStarters';
import { captureSpreadLayout, instantiateSpreadLayout, readSavedSpreadLayouts, SAVED_LAYOUTS_KEY, writeSavedSpreadLayouts } from '../../engine/savedSpreadLayout';
import { SheetPlanningPanel } from './SheetPlanningPanel';
import { OrnamentPanel } from './OrnamentPanel';
import { ArtworkLibraryPanel } from './ArtworkLibraryPanel';
import './savedLayouts.css';

interface TemplatesTabProps {
  state: ProjectState;
}

export function TemplatesTab({ state }: TemplatesTabProps) {
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [layoutName, setLayoutName] = useState('');
  const [savedLayouts, setSavedLayouts] = useState(readSavedSpreadLayouts);
  const [starter, setStarter] = useState<PublicationStarter>('fiction');
  const [title, setTitle] = useState('Chapter One');
  const search = query.trim().normalize('NFKC').toLowerCase();
  const matches = (value: string) => value.normalize('NFKC').toLowerCase().includes(search);
  const visibleSaved = savedLayouts.filter(layout => matches(layout.name));
  const visibleBuiltIn = TEMPLATES.filter(layout => (category === 'All' || layout.category === category) &&
    matches(`${layout.name} ${layout.category} ${layout.description}`));

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === SAVED_LAYOUTS_KEY || event.key === null) setSavedLayouts(readSavedSpreadLayouts());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const act = (action: () => void, success: string) => {
    try { action(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const apply = (create: () => Spread, mode: 'append' | 'replace', size?: { width: number; height: number }) => {
    if (mode === 'replace' && stateManager.getActiveSpread().elements.length &&
      !window.confirm('Replace the active spread’s contents with this layout? You can undo this change.')) return;
    act(() => stateManager.applySpreadTemplate(create(), mode, size), mode === 'append'
      ? 'Layout added as a new spread. Undo restores the previous document.'
      : 'Spread layout replaced. Undo restores its previous contents.');
  };

  return (
    <div className="templates-view">
      <div className="section-header">PUBLICATION STARTERS & LAYOUTS</div>
      <ArtworkLibraryPanel state={state}/>
      <SheetPlanningPanel state={state}/>
      <OrnamentPanel state={state}/>
      <div className="publication-panel">
        <strong>Start a chapter or article</strong>
        <p>Uses this document’s trim and margins. Adds two linked pages with running heads, folios and automatic story extension.</p>
        <label>Starter layout<select value={starter} onChange={event => setStarter(event.currentTarget.value as PublicationStarter)}>{PUBLICATION_STARTERS.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <p>{PUBLICATION_STARTERS.find(item => item.id === starter)?.description}</p>
        <label>Chapter or article title<input value={title} maxLength={200} onInput={event => setTitle(event.currentTarget.value)}/></label>
        <div className="publication-actions"><button className="sm-btn" disabled={!title.trim()} onClick={() => act(() => stateManager.applySpreadTemplate(createPublicationStarter(state.settings, starter, title), 'append', { width: state.settings.widthMm, height: state.settings.heightMm }), 'Starter added. Select its body frame to import a manuscript or begin writing.')}>Add publication starter</button></div>
      </div>
      <p className="section-subtitle">
        Layouts adapt to the current trim. Review typography and placeholders before production.
      </p>
      <label className="template-search">Search layouts<input type="search" value={query} onInput={event => setQuery(event.currentTarget.value)} /></label>
      {message && <p role="status" className="template-message">{message}</p>}

      <section className="publication-panel" aria-labelledby="saved-layouts-heading">
        <h3 id="saved-layouts-heading">Saved layouts</h3>
        <p>Reuse standalone objects on visible layers. Saved layouts are available on this device.</p>
        <form onSubmit={event => {
          event.preventDefault();
          act(() => {
            const entry = captureSpreadLayout(stateManager.getState(), layoutName);
            const updated = [entry, ...readSavedSpreadLayouts()];
            writeSavedSpreadLayouts(updated);
            setSavedLayouts(updated);
            setLayoutName('');
          }, 'Spread layout saved.');
        }}>
          <label>Layout name<input value={layoutName} maxLength={100} onInput={event => setLayoutName(event.currentTarget.value)} /></label>
          <div className="publication-actions"><button type="submit" className="sm-btn" disabled={!layoutName.trim()}>Save active spread</button></div>
        </form>
        {savedLayouts.length > 0 && visibleSaved.length === 0 && <p>No saved layouts match your search.</p>}
        <div className="saved-layout-list">
          {visibleSaved.map(layout => <article className="saved-layout-card" key={layout.id}>
            <strong>{layout.name}</strong>
            <p>{layout.spread.pages.length} {layout.spread.pages.length === 1 ? 'page' : 'pages'} · {Number(layout.size.width.toFixed(2))} × {Number(layout.size.height.toFixed(2))} mm</p>
            <div className="publication-actions">
              <button type="button" className="sm-btn" onClick={() => apply(() => instantiateSpreadLayout(layout), 'append', layout.size)}>Add spread</button>
              <button type="button" className="sm-btn" onClick={() => apply(() => instantiateSpreadLayout(layout), 'replace', layout.size)}>Replace spread</button>
              <button type="button" className="sm-btn" onClick={() => act(() => {
                const updated = readSavedSpreadLayouts().filter(item => item.id !== layout.id);
                writeSavedSpreadLayouts(updated);
                setSavedLayouts(updated);
              }, 'Saved layout removed.')}>Remove</button>
            </div>
          </article>)}
        </div>
      </section>

      <h3 id="built-in-layouts-heading">Built-in layouts</h3>
      <label className="template-filter">Layout category<select value={category} onChange={event => setCategory(event.currentTarget.value)}>{['All', 'Book', 'Magazine', 'Zine', 'Brochure'].map(category => <option key={category}>{category}</option>)}</select></label>
      <div className="template-grid">
        {visibleBuiltIn.map((tmpl) => (
          <div key={tmpl.id} className="template-card">
            <div className="tmpl-badge">{tmpl.category}</div>
            <div className="tmpl-title">{tmpl.name}</div>
            <div className="tmpl-desc">{tmpl.description}</div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
              <button
                className="action-btn-primary btn-apply-tmpl"
                style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                onClick={() => apply(() => tmpl.createSpread(0, 1), 'replace')}
                title="Populate active spread canvas with this layout"
              >
                Load to Spread
              </button>
              <button
                className="action-btn btn-apply-tmpl"
                style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                onClick={() => apply(() => tmpl.createSpread(0, 1), 'append')}
                title="Append as a new spread at the end of publication"
              >
                + New Spread
              </button>
            </div>
          </div>
        ))}
      </div>
      {!visibleBuiltIn.length && <p className="section-subtitle">{search ? 'No built-in layouts match your search.' : 'No bundled layouts in this category yet. Use a publication starter or build a custom spread.'}</p>}
    </div>
  );
}
