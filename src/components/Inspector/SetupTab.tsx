import { stateManager } from '../../state';
import { ProjectState } from '../../types';

interface SetupTabProps {
  state: ProjectState;
}

export function SetupTab({ state }: SetupTabProps) {
  const s = state.settings;

  const handleMarginChange = (key: keyof ProjectState['settings']['margins'], val: string) => {
    stateManager.updateSettings({
      margins: {
        ...s.margins,
        [key]: parseFloat(val) || 0,
      },
    });
  };

  return (
    <div className="setup-view">
      <div className="section-header">PAGE & GRID SETUP</div>

      <div className="setup-group">
        <div className="group-title">MARGINS (MM)</div>
        <div className="input-grid-2">
          <label>
            Top:
            <input
              type="number"
              value={s.margins.topMm}
              min={5}
              max={60}
              onInput={(e) => handleMarginChange('topMm', (e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Bottom:
            <input
              type="number"
              value={s.margins.bottomMm}
              min={5}
              max={60}
              onInput={(e) => handleMarginChange('bottomMm', (e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Inside (Spine):
            <input
              type="number"
              value={s.margins.insideMm}
              min={5}
              max={60}
              onInput={(e) => handleMarginChange('insideMm', (e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Outside:
            <input
              type="number"
              value={s.margins.outsideMm}
              min={5}
              max={60}
              onInput={(e) => handleMarginChange('outsideMm', (e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      </div>

      <div className="setup-group" style={{ marginTop: '16px' }}>
        <div className="group-title">BLEED & SLUG (MM)</div>
        <div className="input-grid-2">
          <label>
            Bleed:
            <input
              type="number"
              value={s.bleedMm}
              min={0}
              max={15}
              step={0.5}
              onInput={(e) =>
                stateManager.updateSettings({
                  bleedMm: parseFloat((e.target as HTMLInputElement).value) || 0,
                })}
            />
          </label>
          <label>
            Columns:
            <input
              type="number"
              value={s.columnCount}
              min={1}
              max={6}
              onInput={(e) =>
                stateManager.updateSettings({
                  columnCount: parseInt((e.target as HTMLInputElement).value, 10) || 1,
                })}
            />
          </label>
          <label>
            Gutter:
            <input
              type="number"
              value={s.columnGutterMm}
              min={2}
              max={25}
              onInput={(e) =>
                stateManager.updateSettings({
                  columnGutterMm: parseFloat((e.target as HTMLInputElement).value) || 4,
                })}
            />
            mm
          </label>
        </div>
      </div>
      <div className="setup-group" style={{ marginTop: '16px' }}>
        <div className="group-title">BASELINE GRID</div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
            <input
              type="checkbox"
              checked={Boolean(s.baselineGrid?.enabled)}
              onChange={(e) =>
                stateManager.setBaselineGrid({
                  enabled: (e.target as HTMLInputElement).checked,
                })}
            />
            Enable Baseline Grid
          </label>
        </div>

        <div className="input-grid-2">
          <label>
            Increment (pt):
            <input
              type="number"
              value={s.baselineGrid?.incrementPt || 12}
              min={6}
              max={36}
              step={0.5}
              onInput={(e) =>
                stateManager.setBaselineGrid({
                  incrementPt: parseFloat((e.target as HTMLInputElement).value) || 12,
                })}
            />
          </label>
          <label>
            Start Y (mm):
            <input
              type="number"
              value={s.baselineGrid?.startMm ?? s.margins.topMm}
              min={0}
              max={100}
              step={1}
              onInput={(e) =>
                stateManager.setBaselineGrid({
                  startMm: parseFloat((e.target as HTMLInputElement).value) || s.margins.topMm,
                })}
            />
          </label>
        </div>

        <div style={{ marginTop: '8px' }}>
          <button
            className={`sm-btn ${state.showBaselineGrid ? 'active' : ''}`}
            style={{ width: '100%', padding: '6px' }}
            onClick={() => stateManager.toggleBaselineGrid()}
          >
            {state.showBaselineGrid ? 'Hide Baseline Grid Guides' : 'Show Baseline Grid Guides'}
          </button>
        </div>
      </div>
    </div>
  );
}
