/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */
// Recto Print Packaging Engine: One-Click Print Handoff Archive
import { ProjectState, TextElement, ImageElement } from './types';
import { exportDocumentToPdf } from './pdfExport';
import { createZipArchive } from './zip';
import { stateManager } from './state';
import { fontManager } from './fontManager';

export interface PackageExportOptions {
  download?: boolean;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return new TextEncoder().encode(dataUrl);
  const b64 = dataUrl.slice(commaIdx + 1);
  if (typeof atob === 'function') {
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  } else if (typeof (globalThis as any).Buffer !== 'undefined') {
    return new Uint8Array((globalThis as any).Buffer.from(b64, 'base64'));
  }
  return new Uint8Array();
}

export function generateInstructionsReport(state: ProjectState): string {
  const totalPages = state.spreads.reduce((acc, s) => acc + s.pages.length, 0);
  const { widthMm, heightMm, bleedMm, margins } = state.settings;
  const timestamp = new Date().toISOString();

  // Collect unique fonts
  const fontsSet = new Set<string>();
  for (const style of state.paragraphStyles || []) {
    if (style.fontFamily) fontsSet.add(style.fontFamily);
  }
  for (const spread of state.spreads) {
    for (const el of spread.elements) {
      if (el.type === 'text') {
        const txt = el as TextElement;
        if (txt.fontFamily) fontsSet.add(txt.fontFamily);
      }
    }
  }
  for (const master of state.masterSpreads || []) {
    for (const el of master.elements) {
      if (el.type === 'text') {
        const txt = el as TextElement;
        if (txt.fontFamily) fontsSet.add(txt.fontFamily);
      }
    }
  }

  const fontsList = Array.from(fontsSet).map((f) => {
    const primary = f.split(',')[0].trim().replace(/['"]/g, '');
    let source = 'System';
    if (fontManager.isCustomFont(primary)) source = 'Custom (Embedded)';
    else if (fontManager.isGoogleFont(primary)) source = 'Google Fonts (Web/Print Open License)';
    return `  - ${primary} [${source}] (Full family fallback: "${f}")`;
  });

  // Collect placed assets
  const links = stateManager.getAssetLinks();
  const assetsReport = links.length === 0
    ? '  None (Document uses vector graphics and typography exclusively)'
    : links
        .map(
          (l, i) =>
            `  ${i + 1}. ${l.name} (${l.format}, ${l.sizeFormatted})\n` +
            `     Spread: ${l.spreadNumber}, Page: ${l.pageNumber}\n` +
            `     Resolution: ${l.pixelWidth} x ${l.pixelHeight} px\n` +
            `     Physical Frame: ${Math.round(l.widthMm)} x ${Math.round(l.heightMm)} mm\n` +
            `     Effective DPI: ${l.effectiveDpi} DPI (${l.isLowRes ? 'WARNING: Low Resolution < 250 DPI' : 'Print Ready'})\n`
        )
        .join('\n');

  // Preflight check
  const preflightIssues = stateManager.runPreflightCheck();
  const preflightSummary = preflightIssues.length === 0
    ? '  PASS: All preflight audit criteria satisfied (No trim edge hazards, overset text, or bleed errors).'
    : preflightIssues.map((iss) => `  [${iss.severity.toUpperCase()}] ${iss.code}: ${iss.message} (Page ${iss.pageNumber})`).join('\n');

  return `================================================================================
RECTO STUDIO · PRINT PRODUCTION HANDOFF PACKAGE
================================================================================
Generated: ${timestamp}
Software: Recto Studio (Open-Source DTP Architecture)

1. DOCUMENT SPECIFICATIONS
--------------------------------------------------------------------------------
Document Title:    ${state.settings.title}
Preset:            ${state.settings.preset || 'Custom'}
Facing Spreads:    ${state.settings.facingPages ? 'Yes (Left/Right Readers Spread)' : 'No (Single Pages)'}
Page Count:        ${totalPages} pages (${state.spreads.length} spreads)
Trim Size:         ${widthMm} mm x ${heightMm} mm
Bleed Size:        ${bleedMm} mm (All four sides)
Safe Margins:      Top: ${margins.topMm}mm | Bottom: ${margins.bottomMm}mm | Inside: ${margins.insideMm}mm | Outside: ${margins.outsideMm}mm
Baseline Grid:     ${state.settings.baselineGrid?.enabled ? `Active (${state.settings.baselineGrid.incrementPt}pt increment, ${state.settings.baselineGrid.startMm}mm start)` : 'Disabled'}
Color Setting:     ${state.settings.colorMode || 'cmyk'} / ${state.settings.iccProfile || 'FOGRA39'} (ICC conversion and standards conformance are not certified)

2. FONTS SUMMARY
--------------------------------------------------------------------------------
Total Fonts Referenced: ${fontsList.length}
${fontsList.length > 0 ? fontsList.join('\n') : '  - Default System Fonts'}

3. PLACED ASSETS ROSTER
--------------------------------------------------------------------------------
Total Placed Assets: ${links.length}
${assetsReport}

4. PREFLIGHT VERIFICATION STATUS
--------------------------------------------------------------------------------
${preflightSummary}

5. PRESS OPERATOR NOTES & INSTRUCTIONS
--------------------------------------------------------------------------------
* Print PDF file is included in this root folder:
  - Generated with 14mm slug, crop marks, trim/bleed boxes, registration targets, and calibration bars.
  - Obtain printer preflight approval before production. This is not certified PDF/X or PDF/UA output.
* All placed raster assets are archived in the /Assets subfolder.
* Native .recto project source is preserved in this package for archival editing and version inspection.
================================================================================
`;
}

export async function packageDocument(
  state: ProjectState,
  options: PackageExportOptions = { download: true }
): Promise<{ buffer: Uint8Array; filename: string; filesCount: number }> {
  const baseTitle = state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-project';
  const packageDirName = `${baseTitle}-package`;
  const files: Record<string, string | Uint8Array> = {};

  // 1. Native .recto Project JSON
  const projectJson = JSON.stringify(state, null, 2);
  files[`${baseTitle}.recto`] = projectJson;

  // 2. High-Resolution Print-Ready PDF
  const pdfDoc = await exportDocumentToPdf(state, {
    includeCropMarks: true,
    includeBleed: true,
    includeRegistrationMarks: true,
    includeColorBars: true,
    exportFormat: 'pages',
    spreadRange: 'all',
    download: false,
  });
  const pdfArrayBuffer = pdfDoc.output('arraybuffer');
  files[`${baseTitle}-print.pdf`] = new Uint8Array(pdfArrayBuffer);

  // 3. Assets Subfolder
  let assetIdx = 1;
  for (const spread of state.spreads) {
    for (const el of spread.elements) {
      if (el.type === 'image') {
        const img = el as ImageElement;
        if (img.src && img.src.startsWith('data:')) {
          const mimeMatch = img.src.match(/^data:image\/([a-zA-Z0-9+]+);/);
          let ext = mimeMatch ? mimeMatch[1].toLowerCase() : 'png';
          if (ext === 'jpeg') ext = 'jpg';
          const assetName = img.name || `image-${assetIdx}.${ext}`;
          const assetBytes = dataUrlToBytes(img.src);
          files[`Assets/${assetName}`] = assetBytes;
          assetIdx++;
        }
      }
    }
  }

  // 4. Instructions.txt report
  const instructions = generateInstructionsReport(state);
  files['Instructions.txt'] = instructions;

  // 5. Generate ZIP Archive
  const zipBuffer = createZipArchive(files);
  const zipFilename = `${packageDirName}.zip`;

  // 6. Trigger Download if in browser
  if (options.download && typeof document !== 'undefined') {
    const blob = new Blob([zipBuffer as unknown as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    buffer: zipBuffer,
    filename: zipFilename,
    filesCount: Object.keys(files).length,
  };
}
