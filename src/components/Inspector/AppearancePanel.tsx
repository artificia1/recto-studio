import { useEffect, useState } from 'preact/hooks';
import { appearanceThemes, defaultAppearance, getAppearance, setAppearance, subscribeAppearance,
  type Accent, type Appearance, type PasteboardTone } from '../../appearance';
import './appearancePanel.css';

const accents: { value: Accent; label: string }[] = [
  { value: 'blue', label: 'Blue' },
  { value: 'jade', label: 'Jade' },
  { value: 'violet', label: 'Violet' },
  { value: 'amber', label: 'Amber' },
];

export default function AppearancePanel() {
  const [appearance, setCurrent] = useState(getAppearance);
  useEffect(() => subscribeAppearance(setCurrent), []);
  const update = (changes: Partial<Appearance>) => setAppearance({ ...getAppearance(), ...changes });
  return <details className="setup-group appearance-panel">
    <summary className="group-title">Workspace appearance</summary>
    <fieldset>
      <legend>Theme</legend>
      <div className="appearance-themes">
        {appearanceThemes.map(({ value, label }) => <button key={value} type="button" aria-pressed={appearance.theme === value}
          className="appearance-theme" onClick={() => update({ theme: value })}>
          <span className="appearance-theme-preview" data-preview={value} aria-hidden="true"><span /><span /></span>
          {label}
        </button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>Accent</legend>
      <div className="appearance-accents">
        {accents.map(({ value, label }) => <button key={value} type="button" aria-label={label} title={label}
          className="appearance-accent" data-swatch={value} aria-pressed={appearance.accent === value}
          onClick={() => update({ accent: value })} />)}
      </div>
    </fieldset>
    <label className="appearance-pasteboard">
      Spread pasteboard
      <select className="styled-select" value={appearance.pasteboard}
        onChange={event => update({ pasteboard: event.currentTarget.value as PasteboardTone })}>
        <option value="charcoal">Charcoal</option>
        <option value="gray">Gray</option>
        <option value="light">Light</option>
      </select>
    </label>
    <div className="appearance-footer">
      <label><input type="checkbox" checked={appearance.compact}
        onChange={event => update({ compact: event.currentTarget.checked })} /> Compact controls</label>
      <button type="button" className="sm-btn" onClick={() => update(defaultAppearance)}>Reset</button>
    </div>
  </details>;
}
