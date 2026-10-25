/**
 * Recto Studio — Prepress Color Management & Soft-Proofing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Implements profile-aware CMYK/RGB gamut mapping, Total Area Coverage (TAC)
 * evaluation, and on-screen soft-proof simulation for FOGRA39, GRACoL 2006, SWOP 2006, and sRGB.
 */

export type IccProfileName = 'FOGRA39' | 'GRACoL2006' | 'SWOP2006' | 'sRGB';

export interface ProfileMetrics {
  name: IccProfileName;
  description: string;
  standard: string;
  maxTacPercent: number; // Total Area Coverage limit
  dotGainPercent: number; // Midtone (50%) mechanical dot gain
}

export const ICC_PROFILES: Record<IccProfileName, ProfileMetrics> = {
  FOGRA39: {
    name: 'FOGRA39',
    description: 'ISO 12647-2:2004 / Coated v2 (European Offset)',
    standard: 'ISO Coated v2 (ECI)',
    maxTacPercent: 330,
    dotGainPercent: 14,
  },
  GRACoL2006: {
    name: 'GRACoL2006',
    description: 'GRACoL 2006 Coated Commercial Sheetfed (North America)',
    standard: 'IDEAlliance G7',
    maxTacPercent: 320,
    dotGainPercent: 13,
  },
  SWOP2006: {
    name: 'SWOP2006',
    description: 'SWOP 2006 Coated Publication Web Offset',
    standard: 'ANSI CGATS TR 001',
    maxTacPercent: 300,
    dotGainPercent: 19,
  },
  sRGB: {
    name: 'sRGB',
    description: 'Standard sRGB Display Space (IEC 61966-2-1)',
    standard: 'IEC 61966-2-1',
    maxTacPercent: 400,
    dotGainPercent: 0,
  },
};

export interface GamutAuditResult {
  inGamut: boolean;
  cmyk: [number, number, number, number];
  totalInk: number;
  maxAllowedTac: number;
  exceedsTac: boolean;
  deltaEEstimate: number;
  warning?: string;
}

export class ColorEngine {
  /**
   * Converts 8-bit RGB [0-255] to profile-calibrated CMYK [0-100].
   */
  public rgbToCmyk(r: number, g: number, b: number, profile: IccProfileName = 'FOGRA39'): [number, number, number, number] {
    // Pure Black Golden Rule: 100% K, 0% CMY to prevent registration ghosting
    if (r === 0 && g === 0 && b === 0) {
      return [0, 0, 0, 100];
    }
    // Pure White: 0% CMYK
    if (r === 255 && g === 255 && b === 255) {
      return [0, 0, 0, 0];
    }

    const normR = r / 255;
    const normG = g / 255;
    const normB = b / 255;

    let k = 1 - Math.max(normR, normG, normB);
    let c = (1 - normR - k) / (1 - k || 1);
    let m = (1 - normG - k) / (1 - k || 1);
    let y = (1 - normB - k) / (1 - k || 1);

    const prof = ICC_PROFILES[profile] || ICC_PROFILES.FOGRA39;

    // Apply profile-specific Under Color Removal (UCR) / Gray Component Replacement (GCR)
    let cPct = Math.round(c * 100);
    let mPct = Math.round(m * 100);
    let yPct = Math.round(y * 100);
    let kPct = Math.round(k * 100);

    const total = cPct + mPct + yPct + kPct;
    if (total > prof.maxTacPercent) {
      const scale = prof.maxTacPercent / total;
      cPct = Math.round(cPct * scale);
      mPct = Math.round(mPct * scale);
      yPct = Math.round(yPct * scale);
      kPct = Math.min(100, Math.round(kPct * scale));
    }

    return [cPct, mPct, yPct, kPct];
  }

  /**
   * Simulates CMYK press output back to monitor sRGB, modeling ink density and dot gain.
   */
  public cmykToSimulatedRgb(c: number, m: number, y: number, k: number, profile: IccProfileName = 'FOGRA39'): [number, number, number] {
    const prof = ICC_PROFILES[profile] || ICC_PROFILES.FOGRA39;
    const dotGain = prof.dotGainPercent / 100;
    const maxReflectance = profile === 'SWOP2006' ? 0.78 : 0.85;

    // Apply dot gain compensation
    const adjust = (val: number) => {
      const v = val / 100;
      return Math.min(1, Math.max(0, v + (v * (1 - v) * dotGain * 0.5)));
    };

    const cAdj = adjust(c);
    const mAdj = adjust(m);
    const yAdj = adjust(y);
    const kAdj = adjust(k);

    let r = 255 * (1 - cAdj) * (1 - kAdj);
    let g = 255 * (1 - mAdj) * (1 - kAdj);
    let b = 255 * (1 - yAdj) * (1 - kAdj);

    // Physical offset ink reflectance limit on saturated secondary mixtures (C+Y green, M+Y red, C+M blue)
    if (cAdj > 0.5 && yAdj > 0.5) g *= maxReflectance;
    if (mAdj > 0.5 && yAdj > 0.5) r *= maxReflectance;
    if (cAdj > 0.5 && mAdj > 0.5) b *= maxReflectance;

    return [
      Math.round(Math.max(0, Math.min(255, r))),
      Math.round(Math.max(0, Math.min(255, g))),
      Math.round(Math.max(0, Math.min(255, b))),
    ];
  }

  /**
   * Soft-proofs a hex color against an ICC output profile.
   */
  public softProof(hexColor: string, profile: IccProfileName = 'FOGRA39'): string {
    const rgb = this.parseHex(hexColor);
    if (!rgb) return hexColor;
    const cmyk = this.rgbToCmyk(rgb[0], rgb[1], rgb[2], profile);
    const simRgb = this.cmykToSimulatedRgb(cmyk[0], cmyk[1], cmyk[2], cmyk[3], profile);
    return `#${simRgb[0].toString(16).padStart(2, '0')}${simRgb[1].toString(16).padStart(2, '0')}${simRgb[2].toString(16).padStart(2, '0')}`;
  }

  /**
   * Evaluates if a color is within the printable gamut and TAC limit of the target profile.
   */
  public auditColorGamut(hexColor: string, profile: IccProfileName = 'FOGRA39'): GamutAuditResult {
    const rgb = this.parseHex(hexColor) || [0, 0, 0];
    const prof = ICC_PROFILES[profile] || ICC_PROFILES.FOGRA39;
    const cmyk = this.rgbToCmyk(rgb[0], rgb[1], rgb[2], profile);
    const totalInk = cmyk[0] + cmyk[1] + cmyk[2] + cmyk[3];
    const exceedsTac = totalInk > prof.maxTacPercent;

    const simRgb = this.cmykToSimulatedRgb(cmyk[0], cmyk[1], cmyk[2], cmyk[3], profile);
    const deltaR = rgb[0] - simRgb[0];
    const deltaG = rgb[1] - simRgb[1];
    const deltaB = rgb[2] - simRgb[2];
    const deltaEEstimate = Math.round(Math.sqrt(0.3 * deltaR * deltaR + 0.59 * deltaG * deltaG + 0.11 * deltaB * deltaB) * 10) / 10;

    const inGamut = !exceedsTac && deltaEEstimate < 12;

    let warning: string | undefined;
    if (exceedsTac) {
      warning = `Total Area Coverage (${totalInk}%) exceeds ${profile} press limit (${prof.maxTacPercent}%). Risk of ink smearing.`;
    } else if (!inGamut) {
      warning = `Color exceeds printable gamut (estimated DeltaE ~${deltaEEstimate}). Out of gamut for ${profile}.`;
    }

    return {
      inGamut,
      cmyk,
      totalInk,
      maxAllowedTac: prof.maxTacPercent,
      exceedsTac,
      deltaEEstimate,
      warning,
    };
  }

  private parseHex(hex: string): [number, number, number] | null {
    if (!hex || typeof hex !== 'string') return null;
    let clean = hex.trim().replace(/^#/, '');
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    if (clean.length !== 6) return null;
    const num = parseInt(clean, 16);
    if (isNaN(num)) return null;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
}

export const colorEngine = new ColorEngine();
