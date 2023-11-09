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
            <button
              className="action-btn-primary btn-apply-tmpl"
              onClick={() => handleApply(tmpl)}
            >
              Append to Project
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
