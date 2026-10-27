import { stateManager } from '../../state';
import { ProjectState, PAGE_PRESETS, PagePreset } from '../../types';
import { MathInput } from '../common/MathInput';

interface SetupTabProps {
  state: ProjectState;
}

export function SetupTab({ state }: SetupTabProps) {
  const s = state.settings;

  const handlePresetSelect = (preset: PagePreset) => {
    const dim = PAGE_PRESETS[preset];
    if (dim) {
      stateManager.updateSettings({
        preset,
        widthMm: dim.widthMm,
        heightMm: dim.heightMm,
      });
    }
  };

  const handleCustomDimensionChange = (key: 'widthMm' | 'heightMm', val: number) => {
    stateManager.updateSettings({
      preset: 'Custom',
      [key]: val,
    });
  };

  const handleMarginChange = (key: keyof ProjectState['settings']['margins'], val: number) => {
    stateManager.updateSettings({
      margins: {
        ...s.margins,
        [key]: val,
      },
    });
  };

  return (
    <div className="setup-view">
      <div className="section-header">DOCUMENT SETUP & PREFERENCES</div>

      {/* Page Geometry & Spreads */}
      <div className="setup-group">
        <div className="group-title">PAGE TRIM & SPREAD SETUP</div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>
            Trim Preset:
          </label>
          <select
            className="styled-select"
            style={{ width: '100%', marginBottom: '6px' }}
            value={s.preset}
            onChange={(e) => handlePresetSelect((e.target as HTMLSelectElement).value as PagePreset)}
          >
            <option value="A4">A4 (210 × 297 mm)</option>
            <option value="US-Letter">US Letter (8.5 × 11 in)</option>
            <option value="Book-Trade-6x9">Trade Paperback (6 × 9 in)</option>
            <option value="Digest-5.5x8.5">Digest (5.5 × 8.5 in)</option>
            <option value="Zine-A5">Zine / Pamphlet A5 (148 × 210 mm)</option>
            <option value="Custom">Custom Dimensions...</option>
          </select>
        </div>

        <div className="input-grid-2">
          <label>
            Width (mm):
            <MathInput
              value={s.widthMm}
              min={50}
              max={1200}
              step={1}
              onChange={(val) => handleCustomDimensionChange('widthMm', val)}
            />
          </label>
          <label>
            Height (mm):
            <MathInput
              value={s.heightMm}
              min={50}
              max={1200}
              step={1}
              onChange={(val) => handleCustomDimensionChange('heightMm', val)}
            />
          </label>
        </div>

        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
            <input
              type="checkbox"
              checked={s.facingPages !== false}
              onChange={(e) => stateManager.updateSettings({ facingPages: (e.target as HTMLInputElement).checked })}
            />
            Facing Pages (Reader / Editorial Spreads)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px' }}>
            <input
              type="checkbox"
              checked={s.overprintBlack !== false}
              onChange={(e) => stateManager.updateSettings({ overprintBlack: (e.target as HTMLInputElement).checked })}
            />
            Overprint [Black] Plate (/OP true)
          </label>
        </div>
      </div>

      <div className="setup-group" style={{ marginTop: '16px' }}>
        <div className="group-title">MARGINS (MM)</div>
        <div className="input-grid-2">
          <label>
            Top:
            <MathInput
              value={s.margins.topMm}
              min={5}
              max={60}
              onChange={(val) => handleMarginChange('topMm', val)}
            />
          </label>
          <label>
            Bottom:
            <MathInput
              value={s.margins.bottomMm}
              min={5}
              max={60}
              onChange={(val) => handleMarginChange('bottomMm', val)}
            />
          </label>
          <label>
            Inside (Spine):
            <MathInput
              value={s.margins.insideMm}
              min={5}
              max={60}
              onChange={(val) => handleMarginChange('insideMm', val)}
            />
          </label>
          <label>
            Outside:
            <MathInput
              value={s.margins.outsideMm}
              min={5}
              max={60}
              onChange={(val) => handleMarginChange('outsideMm', val)}
            />
          </label>
        </div>
      </div>

      <div className="setup-group" style={{ marginTop: '16px' }}>
        <div className="group-title">BLEED & COLUMNS (MM)</div>
        <div className="input-grid-2">
          <label>
            Bleed:
            <MathInput
              value={s.bleedMm}
              min={0}
              max={15}
              step={0.5}
              onChange={(val) => stateManager.updateSettings({ bleedMm: val })}
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
            <MathInput
              value={s.columnGutterMm}
              min={2}
              max={25}
              onChange={(val) => stateManager.updateSettings({ columnGutterMm: val })}
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
            <MathInput
              value={s.baselineGrid?.incrementPt || 12}
              min={6}
              max={36}
              step={0.5}
              onChange={(val) => stateManager.setBaselineGrid({ incrementPt: val })}
            />
          </label>
          <label>
            Start Y (mm):
            <MathInput
              value={s.baselineGrid?.startMm ?? s.margins.topMm}
              min={0}
              max={100}
              step={1}
              onChange={(val) => stateManager.setBaselineGrid({ startMm: val })}
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
