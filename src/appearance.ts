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
  for (const listener of listeners) listener(preference);
}

export function setAppearance(next: Appearance) {
  preference = next;
  renderAppearance();
  try { localStorage.setItem(storageKey, JSON.stringify(preference)); }
  catch { /* Keep this session's appearance if browser storage is unavailable. */ }
}

export function normalizeAppearance(saved: Partial<Appearance>): Appearance {
  return {
    theme: appearanceThemes.find(theme => theme.value === saved.theme)?.value ?? defaultAppearance.theme,
    accent: saved.accent && accents.includes(saved.accent) ? saved.accent : defaultAppearance.accent,
    compact: saved.compact === true,
    pasteboard: saved.pasteboard && Object.hasOwn(pasteboardColors, saved.pasteboard) ? saved.pasteboard : defaultAppearance.pasteboard,
    buttonStyle: saved.buttonStyle && buttonStyles.includes(saved.buttonStyle) ? saved.buttonStyle : defaultAppearance.buttonStyle,
    customAccent: typeof saved.customAccent === 'string' && hexColor.test(saved.customAccent) ? saved.customAccent : defaultAppearance.customAccent,
  };
}

export function serializeAppearance(value: Appearance) {
  return JSON.stringify({ format: 'recto-appearance', version: 1, appearance: value }, null, 2);
}

export function parseAppearance(text: string): Appearance {
  if (text.length > 8192) throw new Error('Choose an appearance profile smaller than 8 KiB.');
  const data = JSON.parse(text);
  if (data?.format !== 'recto-appearance' || data.version !== 1 || !data.appearance || typeof data.appearance !== 'object' ||
    Array.isArray(data.appearance)) throw new Error('Choose a Recto appearance profile.');
  const normalized = normalizeAppearance(data.appearance);
  if (Object.entries(normalized).some(([key, value]) => data.appearance[key] !== value)) {
    throw new Error('The profile has missing or unsupported appearance settings.');
  }
  return normalized;
}

export function initializeAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as Partial<Appearance> | null;
    if (saved) preference = normalizeAppearance(saved);
  } catch { /* Invalid preferences use the default workspace. */ }
  renderAppearance();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (preference.theme === 'system') renderAppearance();
  });
}
