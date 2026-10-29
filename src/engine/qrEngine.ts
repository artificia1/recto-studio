/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Native Vector QR Code Engine (ISO/IEC 18004 Model 2).
 * Standards-compliant QR matrix generation with Reed-Solomon ECC.
 * Emits pure vector SVG and DeviceCMYK/RGB data streams.
 */

import { qrcodegen } from './qrcodegen';

export function generateQrMatrix(text: string): boolean[][] {
  const safeText = text || ' ';
  const qr = qrcodegen.QrCode.encodeText(safeText, qrcodegen.QrCode.Ecc.MEDIUM);
  const matrix: boolean[][] = [];
  for (let y = 0; y < qr.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < qr.size; x++) {
      row.push(qr.getModule(x, y));
    }
    matrix.push(row);
  }
  return matrix;
}

export function generateQrSvg(text: string, sizeMm: number = 30): string {
  const matrix = generateQrMatrix(text);
  const cells = matrix.length;
  const cellSize = 10;
  const quietZone = 4; // Standard 4-module quiet zone required for reliable scanner acquisition
  const viewBoxSize = (cells + quietZone * 2) * cellSize;

  let pathData = '';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (matrix[r][c]) {
        const x = (c + quietZone) * cellSize;
        const y = (r + quietZone) * cellSize;
        pathData += `M${x},${y}h${cellSize}v${cellSize}h-${cellSize}z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizeMm}mm" height="${sizeMm}mm" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <path d="${pathData.trim()}" fill="#000000"/>
</svg>`;
}

export function generateQrDataUrl(text: string, sizeMm: number = 30): string {
  const svg = generateQrSvg(text, sizeMm);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
