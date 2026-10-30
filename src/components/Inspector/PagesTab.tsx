import { stateManager } from '../../state';
import { ProjectState } from '../../types';
import { PublicationPanel } from './PublicationPanel';
import { pageLabel } from '../../engine/pageLabels';

interface PagesTabProps {
  state: ProjectState;
}

export function PagesTab({ state }: PagesTabProps) {
  const spreads = state.spreads;
  const masterSpreads = state.masterSpreads || [];

  const handleDeleteSpread = (e: MouseEvent, idx: number) => {
    e.stopPropagation();
    if (confirm(`Delete Spread ${idx + 1}?`)) {
      stateManager.deleteSpread(idx);
    }
  };

  const handleCreateMaster = () => {
    const nextPrefix = String.fromCharCode(65 + masterSpreads.length); // A, B, C...
    const name = `${nextPrefix}-Chapter Master`;
    stateManager.createMasterSpread(name, nextPrefix);
  };

  return (
    <div className="pages-manager">
      <PublicationPanel key={spreads[state.activeSpreadIndex].id} spread={spreads[state.activeSpreadIndex]} />
      {/* MASTER PAGES SECTION */}
      <div className="pages-header" style={{ marginBottom: '8px' }}>
        <span>MASTER PAGES ({masterSpreads.length})</span>
        <button
          className="sm-btn"
          style={{ backgroundColor: 'var(--accent-cyan)', color: '#111', fontWeight: 600, border: 'none' }}
          onClick={handleCreateMaster}
          title="Create a new Master Spread template"
        >
          + New Master
        </button>
      </div>

      <div className="master-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
        {masterSpreads.map((m) => (
          <div
            key={m.id}
            className="master-card"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              borderRadius: '5px',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '9px', fontWeight: 700, backgroundColor: 'rgba(13, 153, 255, 0.15)', color: 'var(--accent-cyan)', padding: '2px 5px', borderRadius: '3px' }}>
                {m.prefix}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {m.name}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                {m.elements.length} elements · {'{{page}}'}
              </span>
              {masterSpreads.length > 1 && (
                <button
                  type="button"
                  title="Delete Master Spread"
                  aria-label={`Delete ${m.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete Master Spread "${m.name}"? Spreads using this master will be detached.`)) {
                      stateManager.deleteMasterSpread(m.id);
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    fontSize: '12px',
                    lineHeight: 1,
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s, background-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ff4d4f';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 77, 79, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* PUBLICATION SPREADS SECTION */}
      <div className="pages-header">
        <span>DOCUMENT SPREADS ({spreads.length})</span>
        <button
          className="action-btn-primary"
          onClick={() => stateManager.addSpread()}
        >
          + Add Spread
        </button>
      </div>

      <div className="spread-list">
        {spreads.map((spread, idx) => {
          const isCurrent = idx === state.activeSpreadIndex;
          const pageNames = spread.pages.map((p) => `p.${pageLabel(spreads.flatMap(spread => spread.pages), p.id).label}`).join(' - ');
          const elementCount = spread.elements.length;
          const assignedMaster = masterSpreads.find((m) => m.id === spread.masterSpreadId);

          return (
            <div
              key={spread.id}
              className={`spread-card ${isCurrent ? 'active' : ''}`}
              onClick={() => stateManager.setActiveSpread(idx)}
            >
              <div className="spread-preview-mini">
                {spread.pages.map((p) => (
                  <div key={p.id} className="mini-page">
                    {pageLabel(spreads.flatMap(spread => spread.pages), p.id).label}
                  </div>
                ))}
              </div>
              <div className="spread-info">
                <div className="spread-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Spread {idx + 1} ({pageNames})</span>
                  {assignedMaster && (
                    <span style={{ fontSize: '9px', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                      [{assignedMaster.prefix}]
                    </span>
                  )}
                </div>
                <div className="spread-meta">{elementCount} elements on spread</div>

                <div style={{ marginTop: '5px' }} onClick={(e) => e.stopPropagation()}>
                  <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Master:
                    <select
                      value={spread.masterSpreadId || ''}
                      style={{
                        fontSize: '10px',
                        padding: '2px 4px',
                        backgroundColor: 'var(--bg-panel)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '3px',
                      }}
                      onChange={(e) => {
                        const val = (e.target as HTMLSelectElement).value || null;
                        stateManager.assignMasterSpread(idx, val);
                      }}
                    >
                      <option value="">None (Blank)</option>
                      {masterSpreads.map((m) => (
                        <option key={m.id} value={m.id}>
                          [{m.prefix}] {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              {spreads.length > 1 && (
                <button
                  className="btn-del-spread"
                  onClick={(e) => handleDeleteSpread(e as any, idx)}
                  title="Delete Spread"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
