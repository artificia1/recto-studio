/**
 * Recto Studio — OpenSpot / FreeTone Prepress Color Engine
 * Copyright (c) 2022-2026 Abhinav Sidhu. All rights reserved.
 * Licensed under the MIT License.
 *
 * Royalty-free open spot color palette with PostScript /Separation dictionaries.
 */

export interface FreeToneSpotColor {
  name: string;        // e.g. "FreeTone 185 C"
  code: string;        // e.g. "185 C"
  cmyk: [number, number, number, number]; // 0.0 - 1.0 (Cyan, Magenta, Yellow, Black)
  lab: [number, number, number];         // L*, a*, b*
  hex: string;         // Calibrated sRGB screen fallback
  category: 'coated' | 'uncoated' | 'metallic' | 'neutral';
}

/**
 * Standard FreeTone Prepress Spot Palette
 * Calibrated CMYK press curves and Lab tristimulus values.
 */
export const FREETONE_PALETTE: FreeToneSpotColor[] = [
  // Reds & Pinks
  { name: 'FreeTone 185 C', code: '185 C', cmyk: [0.0, 0.93, 0.79, 0.0], lab: [50.4, 69.2, 38.6], hex: '#e11d48', category: 'coated' },
  { name: 'FreeTone 186 C', code: '186 C', cmyk: [0.0, 1.0, 0.81, 0.04], lab: [44.8, 68.3, 37.1], hex: '#dc2626', category: 'coated' },
  { name: 'FreeTone Warm Red C', code: 'Warm Red C', cmyk: [0.0, 0.83, 0.80, 0.0], lab: [54.2, 61.5, 48.0], hex: '#f43f5e', category: 'coated' },
  { name: 'FreeTone Rubine Red C', code: 'Rubine Red C', cmyk: [0.0, 1.0, 0.22, 0.0], lab: [43.1, 74.2, 5.8], hex: '#db2777', category: 'coated' },
  { name: 'FreeTone Rhodamine Red C', code: 'Rhodamine Red C', cmyk: [0.05, 0.92, 0.0, 0.0], lab: [52.8, 77.1, -12.4], hex: '#ec4899', category: 'coated' },

  // Oranges & Yellows
  { name: 'FreeTone 021 C', code: '021 C', cmyk: [0.0, 0.65, 1.0, 0.0], lab: [61.0, 52.8, 75.3], hex: '#ea580c', category: 'coated' },
  { name: 'FreeTone Orange 021 U', code: '021 U', cmyk: [0.0, 0.53, 0.90, 0.0], lab: [65.2, 43.1, 62.4], hex: '#f97316', category: 'uncoated' },
  { name: 'FreeTone 012 C', code: '012 C', cmyk: [0.0, 0.08, 1.0, 0.0], lab: [87.5, 4.2, 98.4], hex: '#facc15', category: 'coated' },
  { name: 'FreeTone Process Yellow C', code: 'Yellow C', cmyk: [0.0, 0.0, 1.0, 0.0], lab: [89.1, -5.2, 93.1], hex: '#fde047', category: 'coated' },

  // Blues & Cyans
  { name: 'FreeTone Reflex Blue C', code: 'Reflex Blue C', cmyk: [1.0, 0.89, 0.0, 0.0], lab: [18.2, 22.4, -68.3], hex: '#1e3a8a', category: 'coated' },
  { name: 'FreeTone 286 C', code: '286 C', cmyk: [1.0, 0.75, 0.0, 0.0], lab: [30.1, 14.5, -57.4], hex: '#2563eb', category: 'coated' },
  { name: 'FreeTone 300 C', code: '300 C', cmyk: [1.0, 0.44, 0.0, 0.0], lab: [44.3, -4.8, -48.2], hex: '#0284c7', category: 'coated' },
  { name: 'FreeTone Process Cyan C', code: 'Cyan C', cmyk: [1.0, 0.0, 0.0, 0.0], lab: [60.5, -34.8, -44.1], hex: '#06b6d4', category: 'coated' },
  { name: 'FreeTone 2925 C', code: '2925 C', cmyk: [0.85, 0.24, 0.0, 0.0], lab: [54.2, -18.2, -42.8], hex: '#38bdf8', category: 'coated' },

  // Purples & Violets
  { name: 'FreeTone 2685 C', code: '2685 C', cmyk: [0.82, 0.98, 0.0, 0.12], lab: [24.8, 48.2, -46.5], hex: '#6b21a8', category: 'coated' },
  { name: 'FreeTone Violet C', code: 'Violet C', cmyk: [0.85, 0.95, 0.0, 0.0], lab: [29.6, 55.4, -58.2], hex: '#7c3aed', category: 'coated' },
  { name: 'FreeTone Purple C', code: 'Purple C', cmyk: [0.43, 0.91, 0.0, 0.0], lab: [41.2, 65.8, -38.4], hex: '#a855f7', category: 'coated' },

  // Greens
  { name: 'FreeTone 354 C', code: '354 C', cmyk: [0.85, 0.0, 0.95, 0.0], lab: [58.4, -68.2, 38.4], hex: '#10b981', category: 'coated' },
  { name: 'FreeTone 368 C', code: '368 C', cmyk: [0.57, 0.0, 1.0, 0.0], lab: [69.2, -48.5, 62.1], hex: '#84cc16', category: 'coated' },
  { name: 'FreeTone 347 C', code: '347 C', cmyk: [0.96, 0.0, 0.88, 0.12], lab: [46.8, -52.4, 24.2], hex: '#047857', category: 'coated' },
  { name: 'FreeTone Green C', code: 'Green C', cmyk: [1.0, 0.0, 0.65, 0.0], lab: [52.1, -64.2, 12.8], hex: '#059669', category: 'coated' },

  // Metallics & Neutrals
  { name: 'FreeTone 877 C', code: '877 C', cmyk: [0.10, 0.06, 0.08, 0.22], lab: [68.0, -0.5, 1.2], hex: '#8e8e93', category: 'metallic' },
  { name: 'FreeTone 871 C', code: '871 C', cmyk: [0.20, 0.30, 0.70, 0.15], lab: [62.4, 6.2, 32.1], hex: '#d4af37', category: 'metallic' },
  { name: 'FreeTone Cool Gray 7 C', code: 'Cool Gray 7 C', cmyk: [0.0, 0.0, 0.0, 0.45], lab: [58.2, -0.4, -2.1], hex: '#64748b', category: 'neutral' },
  { name: 'FreeTone Black 6 C', code: 'Black 6 C', cmyk: [0.40, 0.30, 0.30, 1.0], lab: [8.5, 1.2, -1.8], hex: '#09090b', category: 'neutral' },
];

/**
 * Normalizes spot color name into a safe PostScript name (e.g. "FreeTone_185_C").
 */
export function getSafeSpotName(spotName: string): string {
  return spotName.trim().replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Returns a spot color from the FreeTone standard library by name or code.
 */
export function getFreeToneColor(query: string): FreeToneSpotColor | undefined {
  if (!query) return undefined;
  const q = query.trim().toLowerCase();
  return FREETONE_PALETTE.find(
    (c) =>
      c.name.toLowerCase() === q ||
      c.code.toLowerCase() === q ||
      getSafeSpotName(c.name).toLowerCase() === q ||
      c.name.toLowerCase().replace(/\s+/g, '') === q.replace(/\s+/g, '')
  );
}

/**
 * Returns all available FreeTone spot colors.
 */
export function getAllFreeToneColors(): FreeToneSpotColor[] {
  return FREETONE_PALETTE;
}

/**
 * Generates an Adobe PostScript / PDF Level 2 /Separation color space dictionary string.
 * This instructs prepress RIPs to create a dedicated physical printing plate for this ink.
 */
export function generatePdfSeparationDict(spot: FreeToneSpotColor): string {
  const safeName = getSafeSpotName(spot.name);
  const [c, m, y, k] = spot.cmyk;

  return `[ /Separation /${safeName} /DeviceCMYK <<
  /FunctionType 2
  /Domain [0.0 1.0]
  /Range [0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0]
  /C0 [0.0 0.0 0.0 0.0]
  /C1 [${c.toFixed(4)} ${m.toFixed(4)} ${y.toFixed(4)} ${k.toFixed(4)}]
  /N 1.0
>> ]`;
}
