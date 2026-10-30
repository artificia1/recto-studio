import { getFreeToneColor, getSafeSpotName } from '../engine/spotColors';

/**
 * Converts a hex or CSS color string to DeviceCMYK percentages (0-100).
 * Implements the "Pure Black" prepress rule: black colors map to 100% K (0, 0, 0, 100).
 */
export function colorToCmyk(colorStr: string | undefined): [number, number, number, number] {
  if (!colorStr || colorStr === 'transparent') {
    return [0, 0, 0, 0];
  }
  const clean = colorStr.trim().toLowerCase();

  // Pure Black Golden Rule for offset press plates
  if (
    clean === '#000' ||
    clean === '#000000' ||
    clean === 'black' ||
    clean === 'rgb(0,0,0)' ||
    clean === 'rgb(0, 0, 0)'
  ) {
    return [0, 0, 0, 100];
  }

  // Pure White
  if (
    clean === '#fff' ||
    clean === '#ffffff' ||
    clean === 'white' ||
    clean === 'rgb(255,255,255)' ||
    clean === 'rgb(255, 255, 255)'
  ) {
    return [0, 0, 0, 0];
  }

  let r = 0, g = 0, b = 0;
  if (clean.startsWith('#')) {
    const hex = clean.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else if (clean.startsWith('rgb')) {
    const m = clean.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0], 10);
      g = parseInt(m[1], 10);
      b = parseInt(m[2], 10);
    }
  }

  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const kNorm = 1 - Math.max(rNorm, gNorm, bNorm);
  if (kNorm >= 0.999) {
    return [0, 0, 0, 100];
  }

  const cNorm = (1 - rNorm - kNorm) / (1 - kNorm);
  const mNorm = (1 - gNorm - kNorm) / (1 - kNorm);
  const yNorm = (1 - bNorm - kNorm) / (1 - kNorm);

  return [
    Math.round(cNorm * 100),
    Math.round(mNorm * 100),
    Math.round(yNorm * 100),
    Math.round(kNorm * 100),
  ];
}

export function applyCmykTextColor(doc: any, colorStr: string | undefined, overprint: boolean = true): void {
  const [c, m, y, k] = colorToCmyk(colorStr || '#000000');
  doc.setTextColor(c / 100, m / 100, y / 100, k / 100);
  if (overprint && c === 0 && m === 0 && y === 0 && k === 100) {
    if (typeof (doc.internal as any).out === 'function') {
      (doc.internal as any).out('/GSOverprint gs');
    }
  } else {
    if (typeof (doc.internal as any).out === 'function') {
      (doc.internal as any).out('/GSKnockout gs');
    }
  }
}

export function applyCmykFillColor(doc: any, colorStr: string | undefined): void {
  const [c, m, y, k] = colorToCmyk(colorStr || '#ffffff');
  doc.setFillColor(c / 100, m / 100, y / 100, k / 100);
  if (typeof (doc.internal as any).out === 'function') {
    (doc.internal as any).out('/GSKnockout gs');
  }
}

export function applyCmykDrawColor(doc: any, colorStr: string | undefined): void {
  const [c, m, y, k] = colorToCmyk(colorStr || '#000000');
  doc.setDrawColor(c / 100, m / 100, y / 100, k / 100);
}

export function applySpotColor(doc: any, spotName: string, isStroke: boolean = false, tint: number = 1.0): void {
  const spot = getFreeToneColor(spotName);
  if (!spot) return;
  const safeName = getSafeSpotName(spot.name);
  if (typeof (doc.internal as any).out === 'function') {
    if (isStroke) {
      (doc.internal as any).out(`/CS_${safeName} CS ${tint.toFixed(3)} SC`);
    } else {
      (doc.internal as any).out(`/CS_${safeName} cs ${tint.toFixed(3)} sc`);
    }
  } else {
    const [c, m, y, k] = spot.cmyk;
    if (isStroke) {
      doc.setDrawColor(c, m, y, k);
    } else {
      doc.setFillColor(c, m, y, k);
    }
  }
}

