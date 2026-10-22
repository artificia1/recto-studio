/**
 * Recto Studio — Pure Vector Barcode & ISBN-13 Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

// EAN-13 Parity encoding tables for left-hand digits
const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_CODES = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R_CODES = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

const PARITY_MAP = [
  ['L', 'L', 'L', 'L', 'L', 'L'], // 0
  ['L', 'L', 'G', 'L', 'G', 'G'], // 1
  ['L', 'L', 'G', 'G', 'L', 'G'], // 2
  ['L', 'L', 'G', 'G', 'G', 'L'], // 3
  ['L', 'G', 'L', 'L', 'G', 'G'], // 4
  ['L', 'G', 'G', 'L', 'L', 'G'], // 5
  ['L', 'G', 'G', 'G', 'L', 'L'], // 6
  ['L', 'G', 'L', 'G', 'L', 'G'], // 7
  ['L', 'G', 'L', 'G', 'G', 'L'], // 8
  ['L', 'G', 'G', 'L', 'G', 'L'], // 9
];

/**
 * Calculates EAN-13 / ISBN-13 check digit if 12 digits provided.
 */
export function calculateEan13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits12[i], 10) || 0;
    sum += i % 2 === 0 ? d : d * 3;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

/**
 * Generates vector SVG for standard Bookland ISBN-13 / EAN-13 barcode.
 * Returns an SVG XML string suitable for data URL embedding.
 */
export function generateEan13Svg(rawInput: string, options: { widthMm?: number; heightMm?: number; showText?: boolean } = {}): string {
  const cleanDigits = rawInput.replace(/[^0-9]/g, '');
  let full13 = cleanDigits.slice(0, 13);
  if (full13.length === 12) {
    full13 += calculateEan13CheckDigit(full13);
  } else if (full13.length < 12) {
    full13 = full13.padEnd(12, '0');
    full13 += calculateEan13CheckDigit(full13);
  }

  const firstDigit = parseInt(full13[0], 10);
  const leftDigits = full13.slice(1, 7);
  const rightDigits = full13.slice(7, 13);
  const parityPattern = PARITY_MAP[firstDigit] || PARITY_MAP[0];

  let bitPattern = '101'; // Left Guard

  for (let i = 0; i < 6; i++) {
    const digit = parseInt(leftDigits[i], 10);
    const codeType = parityPattern[i];
    bitPattern += codeType === 'L' ? L_CODES[digit] : G_CODES[digit];
  }

  bitPattern += '01010'; // Center Guard

  for (let i = 0; i < 6; i++) {
    const digit = parseInt(rightDigits[i], 10);
    bitPattern += R_CODES[digit];
  }

  bitPattern += '101'; // Right Guard

  const barWidth = 1.0;
  const barHeight = 50;
  const guardHeight = 56;
  const quietZoneWidth = 10;
  const totalWidth = quietZoneWidth * 2 + bitPattern.length * barWidth;
  const totalHeight = options.showText !== false ? 70 : 58;

  let rects = '';
  for (let i = 0; i < bitPattern.length; i++) {
    if (bitPattern[i] === '1') {
      const isGuard = i < 3 || (i >= 45 && i < 50) || i >= bitPattern.length - 3;
      const h = isGuard ? guardHeight : barHeight;
      const x = quietZoneWidth + i * barWidth;
      rects += `<rect x="${x.toFixed(1)}" y="4" width="${barWidth}" height="${h}" fill="#000000" />\n`;
    }
  }

  const formattedIsbn = `ISBN ${full13.slice(0, 3)}-${full13.slice(3, 4)}-${full13.slice(4, 8)}-${full13.slice(8, 12)}-${full13.slice(12)}`;
  const textElement = options.showText !== false
    ? `<text x="${totalWidth / 2}" y="66" font-family="monospace, monospace" font-size="7.5" font-weight="bold" text-anchor="middle" fill="#000000">${formattedIsbn}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%">
    <rect width="${totalWidth}" height="${totalHeight}" fill="#ffffff" />
    ${rects}
    ${textElement}
  </svg>`;
}

/**
 * Returns a data URL containing the SVG barcode.
 */
export function generateEan13DataUrl(isbn: string): string {
  const svg = generateEan13Svg(isbn);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
