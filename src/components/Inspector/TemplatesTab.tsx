import { stateManager } from '../../state';
import { TEMPLATES, TemplateDefinition } from '../../templates';
import { ProjectState } from '../../types';

interface TemplatesTabProps {
  state: ProjectState;
}

export function TemplatesTab({ state }: TemplatesTabProps) {
  const handleApply = (tmpl: TemplateDefinition) => {
    let lastPageNum = 0;
    for (const sp of state.spreads) {
      for (const p of sp.pages) {
        if (p.pageNumber > lastPageNum) lastPageNum = p.pageNumber;
      }
    }
    const newSpread = tmpl.createSpread(state.spreads.length, lastPageNum + 1);
    state.spreads.push(newSpread);
    stateManager.setActiveSpread(state.spreads.length - 1);
  };

  const handleApplyToActive = (tmpl: TemplateDefinition) => {
    const curSpread = stateManager.getActiveSpread();
    const startPageNum = curSpread.pages[0]?.pageNumber || 1;
    const generated = tmpl.createSpread(state.activeSpreadIndex, startPageNum);
    if (curSpread.pages.length >= 2 && generated.pages.length >= 2) {
      const pageIdMap = new Map([
        [generated.pages[0].id, curSpread.pages[0].id],
        [generated.pages[1].id, curSpread.pages[1].id],
      ]);
      curSpread.elements = generated.elements.map((el) => ({
        ...el,
        pageId: pageIdMap.get(el.pageId) || curSpread.pages[0].id,
      }));
    } else {
      curSpread.elements = generated.elements.map((el) => ({
        ...el,
        pageId: curSpread.pages[0]?.id || el.pageId,
      }));
    }
    stateManager.setActiveSpread(state.activeSpreadIndex);
  };

  return (
    <div className="templates-view">
      <div className="section-header">PROFESSIONAL SPREAD TEMPLATES</div>
      <p className="section-subtitle">
        Instantly insert publication-grade layouts with calibrated margins, columns, and typography.
      </p>

      <div className="template-grid">
        {TEMPLATES.map((tmpl) => (
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
    </div>
  );
}
