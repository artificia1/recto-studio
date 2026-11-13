export const appearanceThemes = [
  { value: 'dark', label: 'Graphite' },
  { value: 'light', label: 'Paper' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'oled', label: 'OLED' },
  { value: 'system', label: 'System' },
] as const;
export type Theme = typeof appearanceThemes[number]['value'];
export type Accent = 'blue' | 'jade' | 'violet' | 'amber' | 'custom';
export type ButtonStyle = 'classic' | 'minimal' | 'glass';
export const pasteboardColors = { charcoal: '#1e1e1e', gray: '#666970', light: '#dce1e8' } as const;
export type PasteboardTone = keyof typeof pasteboardColors;

export interface Appearance {
  theme: Theme;
  accent: Accent;
  compact: boolean;
  pasteboard: PasteboardTone;
  buttonStyle: ButtonStyle;
  customAccent: string;
}

const storageKey = 'recto_appearance';
export const defaultAppearance: Appearance = {
  theme: 'dark', accent: 'blue', compact: false, pasteboard: 'charcoal', buttonStyle: 'classic', customAccent: '#0d99ff',
};
const accents: readonly Accent[] = ['blue', 'jade', 'violet', 'amber', 'custom'];
const buttonStyles: readonly ButtonStyle[] = ['classic', 'minimal', 'glass'];
const hexColor = /^#[\da-f]{6}$/i;
let preference = defaultAppearance;
const listeners = new Set<(value: Appearance) => void>();

export function getAppearance(): Appearance {
  return preference;
}

export function subscribeAppearance(listener: (value: Appearance) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function renderAppearance() {
  const root = document.documentElement;
  root.dataset.theme = preference.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : preference.theme;
  root.dataset.accent = preference.accent;
  root.dataset.density = preference.compact ? 'compact' : 'default';
  root.dataset.buttons = preference.buttonStyle;
  root.style.setProperty('--custom-accent', preference.customAccent);
}

export function setAppearance(next: Appearance) {
  preference = next;
  renderAppearance();
  try { localStorage.setItem(storageKey, JSON.stringify(preference)); }
  catch { /* Keep this session's appearance if browser storage is unavailable. */ }
  for (const listener of listeners) listener(preference);
}

export function initializeAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as Partial<Appearance> | null;
    if (saved) preference = {
      theme: appearanceThemes.find(theme => theme.value === saved.theme)?.value ?? defaultAppearance.theme,
      accent: saved.accent && accents.includes(saved.accent) ? saved.accent : defaultAppearance.accent,
      compact: saved.compact === true,
      pasteboard: saved.pasteboard && Object.hasOwn(pasteboardColors, saved.pasteboard)
        ? saved.pasteboard : defaultAppearance.pasteboard,
      buttonStyle: saved.buttonStyle && buttonStyles.includes(saved.buttonStyle) ? saved.buttonStyle : defaultAppearance.buttonStyle,
      customAccent: saved.customAccent && hexColor.test(saved.customAccent) ? saved.customAccent : defaultAppearance.customAccent,
    };
  } catch { /* Invalid preferences use the default workspace. */ }
  renderAppearance();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (preference.theme === 'system') renderAppearance();
  });
}
