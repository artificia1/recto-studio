import { PAGE_PRESETS, type ProjectState } from '../../types';
import './documentOverview.css';

const measurement = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

interface DocumentOverviewProps {
  state: ProjectState;
  onOpenPageSetup: () => void;
}

export function DocumentOverview({ state, onOpenPageSetup }: DocumentOverviewProps) {
  const { widthMm, heightMm, facingPages, bleedMm, columnCount, columnGutterMm, preset } = state.settings;
  const pageCount = state.spreads.reduce((total, spread) => total + spread.pages.length, 0);
  const pageScale = 34 / Math.max(widthMm, heightMm);
  const miniature = { width: Math.max(7, widthMm * pageScale), height: Math.max(7, heightMm * pageScale) };
  const paper = PAGE_PRESETS[preset]?.name.split(' (')[0] ?? 'Custom';

  return (
    <section className="document-overview" aria-labelledby="document-overview-title">
      <h2 id="document-overview-title">Document overview</h2>
      <p className="document-overview-hint">Select an object on the page to edit its properties.</p>
      <div className="document-overview-card">
        <div className="document-overview-format">
          <div className="document-overview-preview" aria-hidden="true">
            <span style={miniature} />
            {facingPages && <span style={miniature} />}
          </div>
          <div>
            <h3>{paper}</h3>
            <p>{measurement.format(widthMm)} × {measurement.format(heightMm)} mm</p>
          </div>
        </div>
        <dl className="document-overview-details">
          <div>
            <dt>Pages</dt>
            <dd>{pageCount.toLocaleString()} · {facingPages ? 'Facing' : 'Single'}</dd>
          </div>
          <div>
            <dt>Bleed</dt>
            <dd>{measurement.format(bleedMm)} mm</dd>
          </div>
          <div>
            <dt>Columns</dt>
            <dd>{columnCount}{columnCount > 1 && ` · ${measurement.format(columnGutterMm)} mm gutter`}</dd>
          </div>
        </dl>
        <button className="action-btn document-overview-setup" type="button" onClick={onOpenPageSetup}>
          Page setup <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
