import { stateManager } from '../../state';
import { TEMPLATES, TemplateDefinition } from '../../templates';
import { ProjectState } from '../../types';
import { useState } from 'preact/hooks';
import { createPublicationStarter, PUBLICATION_STARTERS, type PublicationStarter } from '../../engine/publicationStarters';
import { SheetPlanningPanel } from './SheetPlanningPanel';
import { OrnamentPanel } from './OrnamentPanel';
import { ArtworkLibraryPanel } from './ArtworkLibraryPanel';

interface TemplatesTabProps {
  state: ProjectState;
}

export function TemplatesTab({ state }: TemplatesTabProps) {
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('All');
  const [starter, setStarter] = useState<PublicationStarter>('fiction');
  const [title, setTitle] = useState('Chapter One');
  const act = (action: () => void, success: string) => {
    try { action(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const handleApply = (tmpl: TemplateDefinition) => {
    act(() => stateManager.applySpreadTemplate(tmpl.createSpread(0, 1), 'append'), 'Layout added as a new spread. Undo restores the previous document.');
  };

  const handleApplyToActive = (tmpl: TemplateDefinition) => {
    const curSpread = stateManager.getActiveSpread();
    if (curSpread.elements.length && !window.confirm('Replace the active spread’s contents with this layout? You can undo this change.')) return;
    act(() => stateManager.applySpreadTemplate(tmpl.createSpread(0, 1), 'replace'), 'Spread layout replaced. Undo restores its previous contents.');
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
        Add a reusable layout without replacing existing work. Layouts adapt from A4 to the current trim; review typography and placeholders before production.
      </p>
      <label className="template-filter">Layout category<select value={category} onChange={event => setCategory(event.currentTarget.value)}>{['All', 'Book', 'Magazine', 'Zine', 'Brochure'].map(category => <option key={category}>{category}</option>)}</select></label>
      {message && <p role="status" className="template-message">{message}</p>}

      <div className="template-grid">
        {TEMPLATES.filter(template => category === 'All' || template.category === category).map((tmpl) => (
          <div key={tmpl.id} className="template-card">
            <div className="tmpl-badge">{tmpl.category}</div>
            <div className="tmpl-title">{tmpl.name}</div>
            <div className="tmpl-desc">{tmpl.description}</div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
              <button
                className="action-btn-primary btn-apply-tmpl"
                style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                onClick={() => handleApplyToActive(tmpl)}
                title="Populate active spread canvas with this layout"
              >
                Load to Spread
              </button>
              <button
                className="action-btn btn-apply-tmpl"
                style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                onClick={() => handleApply(tmpl)}
                title="Append as a new spread at the end of publication"
              >
                + New Spread
              </button>
            </div>
          </div>
        ))}
      </div>
      {category !== 'All' && !TEMPLATES.some(template => template.category === category) && <p className="section-subtitle">No bundled layouts in this category yet. Use a publication starter or build a custom spread.</p>}
    </div>
  );
}
