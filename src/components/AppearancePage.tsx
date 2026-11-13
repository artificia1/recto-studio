import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { appearanceThemes, defaultAppearance, getAppearance, setAppearance, subscribeAppearance,
  type Accent, type Appearance, type ButtonStyle, type PasteboardTone } from '../appearance';
import { useModalFocus } from '../hooks/useModalFocus';
import './appearancePage.css';

const themeDetails = {
  dark: ['Dark', 'Neutral charcoal'],
  light: ['Light', 'Soft white'],
  midnight: ['Midnight', 'Deep navy'],
  oled: ['OLED', 'True black'],
  system: ['System', 'Follows your device'],
} as const;
const buttons: { id: ButtonStyle; label: string; description: string }[] = [
  { id: 'classic', label: 'Classic', description: 'Solid controls with a clear border' },
  { id: 'minimal', label: 'Minimal', description: 'Quiet controls with simple outlines' },
  { id: 'glass', label: 'Glass', description: 'Tinted controls with soft highlights' },
];
const accents: { id: Exclude<Accent, 'custom'>; name: string; color: string }[] = [
  { id: 'blue', name: 'Blue', color: '#0d99ff' },
  { id: 'jade', name: 'Jade', color: '#1da482' },
  { id: 'violet', name: 'Violet', color: '#9274e7' },
  { id: 'amber', name: 'Amber', color: '#d79b3e' },
];

export default function AppearancePage({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const [appearance, setCurrent] = useState(getAppearance);
  const [hex, setHex] = useState(appearance.customAccent);
  const [hexError, setHexError] = useState(false);
  useModalFocus(true, dialog);
  useEffect(() => subscribeAppearance(setCurrent), []);

  const update = (changes: Partial<Appearance>) => setAppearance({ ...getAppearance(), ...changes });
  const updateAccent = (value: string) => {
    const candidate = '#' + value.trim().replace(/^#/, '').toLowerCase();
    setHex(value);
    const valid = /^#[0-9a-f]{6}$/.test(candidate);
    setHexError(!valid);
    if (valid) update({ accent: 'custom', customAccent: candidate });
  };

  return createPortal(
    <div className="appearance-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      }}>
      <section className="appearance-page" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="appearance-heading">
        <header className="appearance-page-header">
          <div>
            <h1 id="appearance-heading">Appearance</h1>
          </div>
          <button type="button" className="action-btn" onClick={onClose} aria-label="Close Appearance">
            <span aria-hidden="true">×</span> Close
          </button>
        </header>

        <div className="appearance-page-content">
          <fieldset className="appearance-section">
            <legend>Theme</legend>
            <div className="appearance-theme-grid">
              {appearanceThemes.map(({ value }) => {
                const [label, description] = themeDetails[value];
                return <button key={value} type="button" className="appearance-theme"
                  aria-pressed={appearance.theme === value} onClick={() => update({ theme: value })}>
                  <span className="appearance-theme-sample" data-preview={value} aria-hidden="true">
                    <i /><i /><i />
                  </span>
                  <strong>{label}</strong><small>{description}</small>
                </button>;
              })}
            </div>
          </fieldset>

          <fieldset className="appearance-section">
            <legend>Button style</legend>
            <div className="appearance-style-grid">
              {buttons.map(({ id, label, description }) => <button key={id} type="button" className="appearance-style"
                aria-pressed={appearance.buttonStyle === id} onClick={() => update({ buttonStyle: id })}>
                <span className="appearance-style-sample" data-buttons={id} aria-hidden="true">
                  <span className="action-btn">Open</span><span className="action-btn-primary">Export</span>
                </span>
                <strong>{label}</strong><small>{description}</small>
              </button>)}
            </div>
          </fieldset>

          <div className="appearance-settings-grid">
            <fieldset className="appearance-section">
              <legend>Accent color</legend>
              <div className="appearance-swatches">
                {accents.map(({ id, name, color }) => <button key={id} type="button" className="appearance-swatch"
                  style={{ '--swatch': color }} aria-label={name} title={name} aria-pressed={appearance.accent === id}
                  onClick={() => update({ accent: id })} />)}
              </div>
              <div className="appearance-custom">
                <input type="color" aria-label="Pick a custom accent color" value={appearance.customAccent} onInput={event => {
                  updateAccent(event.currentTarget.value);
                }} />
                <label>Custom hex
                  <input type="text" spellcheck={false} maxLength={7} placeholder="#0d99ff" value={hex}
                    aria-invalid={hexError} onInput={event => updateAccent(event.currentTarget.value)}
                    onBlur={() => { if (!hexError) setHex(getAppearance().customAccent); }} />
                </label>
              </div>
              {hexError && <p className="appearance-error" role="status">Enter a six-digit hex color.</p>}
            </fieldset>

            <fieldset className="appearance-section">
              <legend>Editor workspace</legend>
              <label className="appearance-row">Spread pasteboard
                <select className="styled-select" value={appearance.pasteboard}
                  onChange={event => update({ pasteboard: event.currentTarget.value as PasteboardTone })}>
                  <option value="charcoal">Charcoal</option><option value="gray">Gray</option><option value="light">Light</option>
                </select>
              </label>
              <label className="appearance-row">
                Compact controls
                <input type="checkbox" checked={appearance.compact} onChange={event => update({ compact: event.currentTarget.checked })} />
              </label>
            </fieldset>
          </div>
        </div>

        <footer className="appearance-page-footer">
          <p>Saved on this device. Changes apply immediately.</p>
          <button type="button" className="action-btn" onClick={() => {
            update(defaultAppearance);
            setHex(defaultAppearance.customAccent);
            setHexError(false);
          }}>Reset to defaults</button>
        </footer>
      </section>
    </div>, document.body,
  );
}
