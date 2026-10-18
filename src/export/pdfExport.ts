/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { jsPDF } from 'jspdf';
import { ProjectState, Page, Spread, TextElement, ImageElement, ShapeElement, VectorPathElement, TableElement } from '../types/index';
import { stateManager, numberToSuperscript } from '../state';
import { assetStore } from '../engine/assetStore';
import { tableEngine } from '../engine/tableEngine';

export interface ExportOptions {
  includeCropMarks?: boolean;
  includeBleed?: boolean;
  includeRegistrationMarks?: boolean;
  includeColorBars?: boolean;
  exportFormat?: 'pages' | 'spreads';
  spreadRange?: 'all' | 'current' | number[];
  compress?: boolean;
  overprintBlack?: boolean;
}

export async function exportDocumentToPdf(
  state: ProjectState,
  options: ExportOptions = {}
): Promise<jsPDF> {
  const {
    includeCropMarks = false,
    includeBleed = false,
    includeRegistrationMarks = false,
    includeColorBars = false,
    spreadRange = 'all',
    overprintBlack = state.settings.overprintBlack !== false,
  } = options;

  const widthMm = state.settings.widthMm || 210;
  const heightMm = state.settings.heightMm || 297;
  const bleedMm = state.settings.bleedMm !== undefined ? state.settings.bleedMm : 3;
  const bleed = includeBleed ? bleedMm : 0;
  const slug = (includeCropMarks || includeRegistrationMarks || includeColorBars) ? 14 : 0;

  const pdfPageWidth = widthMm + (bleed * 2) + (slug * 2);
  const pdfPageHeight = heightMm + (bleed * 2) + (slug * 2);

  const orientation = widthMm > heightMm ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [pdfPageWidth, pdfPageHeight],
    compress: options.compress !== undefined ? options.compress : true,
  });

  if (overprintBlack) {
    const baseGState = new (doc as any).GState({ opacity: 1 });
    (doc as any).setGState(baseGState);
    (doc.internal.events as any).subscribe('putGStateDict', () => {
      (doc.internal as any).write('/GSOverprint << /Type /ExtGState /OP true /op true /OPM 1 >>');
      (doc.internal as any).write('/GSKnockout << /Type /ExtGState /OP false /op false /OPM 0 >>');
    });
  }

  // PDF/UA & Section 508 Universal Accessibility Metadata
  doc.setDocumentProperties({
    title: state.settings.title || 'Recto Document',
    subject: 'Universal Accessible PDF Document (PDF/UA-1 & Section 508)',
    author: 'Recto Studio',
    keywords: 'PDF/UA, Section 508, Universal Accessibility, Tagged PDF',
    creator: 'Recto Studio (Open-Source DTP Architecture)',
  });

  const accessibleItems: { tag: string; altText?: string }[] = [];

  let isFirstPage = true;

  // Determine spreads to export
  let targetSpreads: Spread[] = state.spreads;
  if (spreadRange === 'current') {
    targetSpreads = [state.spreads[state.activeSpreadIndex] || state.spreads[0]];
  } else if (Array.isArray(spreadRange)) {
    targetSpreads = state.spreads.filter((_, idx) => spreadRange.includes(idx));
  }

  const pagesToExport: { page: Page; spread: Spread }[] = [];
  for (const spread of targetSpreads) {
    for (const page of spread.pages) {
      pagesToExport.push({ page, spread });
    }
  }

  const totalPagesInDoc = state.spreads.reduce((acc, s) => acc + s.pages.length, 0);

  for (const { page, spread } of pagesToExport) {
    if (!isFirstPage) {
      doc.addPage([pdfPageWidth, pdfPageHeight], orientation);
    }
    isFirstPage = false;

    const originX = slug + bleed;
    const originY = slug + bleed;

    // 1. Fill page background (DeviceCMYK 0%)
    doc.setFillColor(0, 0, 0, 0);
    doc.rect(originX, originY, widthMm, heightMm, 'F');

    // 2. Commercial Print Marks
    if (includeCropMarks) {
      drawCropMarks(doc, originX, originY, widthMm, heightMm, bleed);
    }
    if (includeRegistrationMarks) {
      drawRegistrationTargets(doc, originX, originY, widthMm, heightMm, slug);
    }
    if (includeColorBars) {
      drawCMYKCalibrationBar(doc, originX, originY, widthMm);
    }
    if (slug > 0) {
      drawSlugMetadata(
        doc,
        originX,
        originY,
        widthMm,
        heightMm,
        state.settings.title,
        Math.min(page.pageNumber, totalPagesInDoc),
        totalPagesInDoc,
        state.settings.colorMode || 'cmyk',
        state.settings.iccProfile || 'FOGRA39'
      );
    }

    // 3. Render Master Spread Elements (rendered behind page elements)
    if (spread.masterSpreadId) {
      const master = state.masterSpreads?.find(m => m.id === spread.masterSpreadId);
      if (master) {
        for (const mEl of master.elements) {
          if (spread.detachedMasterElementIds?.includes(mEl.id)) {
            continue;
          }
          if (spread.elements.some(e => e.masterSourceId === mEl.id && e.pageId === page.id)) {
            continue;
          }
          const masterPage = master.pages.find(p => p.id === mEl.pageId);
          if (masterPage && masterPage.side !== page.side && spread.pages.length > 1) {
            continue;
          }

          const mX = originX + mEl.x;
          let mY = originY + mEl.y;
          if (mEl.y + (mEl.height || 0) > heightMm - 2) {
            mY = originY + Math.max(0, heightMm - (state.settings.margins.bottomMm || 15) + 2);
          }

          if (mEl.type === 'shape') {
            const shape = mEl as ShapeElement;
            applyCmykFillColor(doc, shape.fillColor);
            applyCmykDrawColor(doc, shape.strokeColor);
            doc.setLineWidth(shape.strokeWidthMm || 0.2);
            if (shape.shapeKind === 'line') {
              doc.line(mX, mY, mX + shape.width, mY + shape.height);
            } else if (shape.shapeKind === 'rectangle') {
              doc.rect(mX, mY, shape.width, shape.height, shape.fillColor ? 'FD' : 'S');
            }
          } else if (mEl.type === 'text') {
            const textEl = mEl as TextElement;
            const evalText = stateManager.evaluateTokens(textEl.text, page.pageNumber);
            applyCmykTextColor(doc, textEl.color || '#000000', overprintBlack);
            doc.setFontSize(textEl.fontSizePt);
            applyFont(doc, textEl.fontFamily);
            let mTargetX = mX;
            let mAlign: 'left' | 'center' | 'right' = 'left';
            if (textEl.alignment === 'center') {
              mTargetX = mX + textEl.width / 2;
              mAlign = 'center';
            } else if (textEl.alignment === 'right') {
              mTargetX = mX + textEl.width;
              mAlign = 'right';
            }
            doc.text(evalText, mTargetX, mY + (textEl.fontSizePt * 0.3527), {
              maxWidth: textEl.width,
              align: mAlign,
            });
          }
        }
      }
    }

    // 4. Render Page Elements
    const pageElements = spread.elements.filter(el => el.pageId === page.id);
    pageElements.sort((a, b) => a.zIndex - b.zIndex);

    for (const el of pageElements) {
      const elX = originX + el.x;
      const elY = originY + el.y;

      if (el.type === 'shape') {
        const shape = el as ShapeElement;
        applyCmykFillColor(doc, shape.fillColor);
        applyCmykDrawColor(doc, shape.strokeColor);
        doc.setLineWidth(shape.strokeWidthMm || 0.2);

        if (shape.shapeKind === 'rectangle') {
          doc.rect(elX, elY, shape.width, shape.height, shape.fillColor && shape.fillColor !== 'transparent' ? 'FD' : 'S');
        } else if (shape.shapeKind === 'ellipse') {
          doc.ellipse(elX + shape.width / 2, elY + shape.height / 2, shape.width / 2, shape.height / 2, shape.fillColor && shape.fillColor !== 'transparent' ? 'FD' : 'S');
        } else if (shape.shapeKind === 'line') {
          doc.line(elX, elY, elX + shape.width, elY + shape.height);
        }
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        if (pathEl.nodes.length >= 2) {
          applyCmykDrawColor(doc, pathEl.strokeColor);
          doc.setLineWidth(pathEl.strokeWidthMm || 0.3);
          for (let i = 1; i < pathEl.nodes.length; i++) {
            const prev = pathEl.nodes[i - 1];
            const curr = pathEl.nodes[i];
            doc.line(elX + prev.x, elY + prev.y, elX + curr.x, elY + curr.y);
          }
          if (pathEl.closed && pathEl.nodes.length >= 3) {
            const first = pathEl.nodes[0];
            const last = pathEl.nodes[pathEl.nodes.length - 1];
            doc.line(elX + last.x, elY + last.y, elX + first.x, elY + first.y);
          }
        }
      } else if (el.type === 'text') {
        const text = el as TextElement;
        if (text.backgroundColor && text.backgroundColor !== 'transparent') {
          applyCmykFillColor(doc, text.backgroundColor);
          doc.rect(elX, elY, text.width, text.height, 'F');
        }
        if (text.borderWidthMm > 0 && text.borderColor !== 'transparent') {
          applyCmykDrawColor(doc, text.borderColor);
          doc.setLineWidth(text.borderWidthMm);
          doc.rect(elX, elY, text.width, text.height, 'S');
        }

        applyCmykTextColor(doc, text.color || '#000000', overprintBlack);
        doc.setFontSize(text.fontSizePt);
        applyFont(doc, text.fontFamily);

        const padding = text.paddingMm ?? 0;
        const availableWidth = Math.max(2, text.width - (padding * 2));

        const footnotes = stateManager.getFootnotesForElement(text.id);
        const fnSettings = state.settings.footnoteSettings || {
          numberingStyle: 'superscript',
          separatorRuleWidthMm: 30,
          separatorRuleThicknessPt: 0.5,
          fontSizePt: 8,
        };
        const fnFontSizePt = fnSettings.fontSizePt || 8;
        const fnLineHeightMm = fnFontSizePt * 0.3527 * 1.35;
        const totalFnHtMm = footnotes.length > 0 ? (footnotes.length * fnLineHeightMm) + 3 : 0;
        const availableHeight = Math.max(0, text.height - (padding * 2) - totalFnHtMm);

        const colCount = Math.max(1, text.columns || 1);
        const colGutter = text.columnGutterMm || 4;
        const colWidth = Math.max(2, (availableWidth - (colGutter * (colCount - 1))) / colCount);

        const lineHeight = text.lineHeight || 1.3;
        if (typeof (doc as any).setLineHeightFactor === 'function') {
          (doc as any).setLineHeightFactor(lineHeight);
        }
        const lineSpacingMm = (text.fontSizePt * lineHeight * 25.4) / 72;
        const maxLinesPerCol = Math.max(1, Math.floor((availableHeight - (text.fontSizePt * 0.3527)) / lineSpacingMm) + 1);

        const evalText = stateManager.evaluateTokens(text.text || '', page.pageNumber);
        const allWrappedLines: string[] = doc.splitTextToSize(evalText, colWidth);
        const totalCapacity = colCount * maxLinesPerCol;
        const visibleLines = allWrappedLines.slice(0, totalCapacity);

        for (let c = 0; c < colCount; c++) {
          const colLines = visibleLines.slice(c * maxLinesPerCol, (c + 1) * maxLinesPerCol);
          if (colLines.length === 0) continue;

          const colX = elX + padding + (c * (colWidth + colGutter));
          const startY = elY + padding + (text.fontSizePt * 0.3527);

          let textX = colX;
          let alignOpt: 'left' | 'center' | 'right' | 'justify' = 'left';
          if (text.alignment === 'center') {
            textX = colX + colWidth / 2;
            alignOpt = 'center';
          } else if (text.alignment === 'right') {
            textX = colX + colWidth;
            alignOpt = 'right';
          } else if (text.alignment === 'justify') {
            textX = colX;
            alignOpt = 'justify';
          } else {
            textX = colX;
            alignOpt = 'left';
          }

          doc.text(colLines, textX, startY, {
            maxWidth: colWidth,
            align: alignOpt,
          });
        }

        if (footnotes.length > 0) {
          const fnStartY = elY + text.height - padding - totalFnHtMm + 1;
          const ruleWidthMm = Math.min(availableWidth * 0.45, fnSettings.separatorRuleWidthMm || 30);

          applyCmykDrawColor(doc, '#808080');
          doc.setLineWidth((fnSettings.separatorRuleThicknessPt || 0.5) * 0.3527);
          doc.line(elX + padding, fnStartY, elX + padding + ruleWidthMm, fnStartY);

          doc.setFontSize(fnFontSizePt);
          applyCmykTextColor(doc, text.color || '#222222');
          footnotes.forEach((fn, idx) => {
            const lineY = fnStartY + 2 + (idx * fnLineHeightMm);
            const marker = numberToSuperscript(fn.number);
            doc.text(`${marker} ${fn.text}`, elX + padding, lineY);
          });
        }
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        const fullResSrc = (assetStore.getFullResolution(img.assetId || img.src) as string) || img.src;
        if (fullResSrc && (fullResSrc.startsWith('data:image') || fullResSrc.startsWith('http') || fullResSrc.startsWith('blob:'))) {
          try {
            doc.addImage(fullResSrc, 'JPEG', elX, elY, img.width, img.height);
            assetStore.flushPageExportBuffer(img.assetId || img.src);
          } catch (e) {
            drawPlaceholderImage(doc, elX, elY, img.width, img.height, img.caption);
          }
        } else {
          drawPlaceholderImage(doc, elX, elY, img.width, img.height, img.caption);
        }
      } else if (el.type === 'table') {
        const table = el as TableElement;
        tableEngine.exportPdfTable(doc, table, elX, elY, table.width, table.height, [table], overprintBlack);
      }
    }

    // 5. Collect accessible structure items in reading order (top-to-bottom, left-to-right)
    const sortedForReading = [...pageElements].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.x - b.x;
    });

    for (const el of sortedForReading) {
      if (el.type === 'text') {
        const textEl = el as TextElement;
        const style = state.paragraphStyles?.find((s) => s.id === textEl.paragraphStyleId);
        const tag = style?.pdfTag || 'P';
        accessibleItems.push({ tag });
      } else if (el.type === 'image') {
        const imgEl = el as ImageElement;
        accessibleItems.push({
          tag: 'Figure',
          altText: imgEl.altText || imgEl.caption || imgEl.name || 'Image frame',
        });
      } else if (el.type === 'table') {
        accessibleItems.push({ tag: 'Table' });
      } else if (el.type === 'path' || el.type === 'shape') {
        accessibleItems.push({ tag: 'Figure' });
      }
    }
  }

  // Tagged PDF / PDF/UA Structure Tree Registration
  let structTreeRootId: number | undefined;

  (doc.internal.events as any).subscribe('postPutResources', () => {
    const childIds: number[] = [];
    for (const item of accessibleItems) {
      const childId = (doc.internal as any).newObject();
      childIds.push(childId);
      const altStr = item.altText ? ` /Alt (${escapePdfText(item.altText)})` : '';
      (doc.internal as any).write(`<< /Type /StructElem /S /${item.tag}${altStr} >>\nendobj`);
    }

    structTreeRootId = (doc.internal as any).newObject();
    const kRef = childIds.length > 0 ? childIds.map((id) => `${id} 0 R`).join(' ') : '';
    (doc.internal as any).write(
      `<< /Type /StructTreeRoot /RoleMap << /Title /H1 /Caption /P /BlockQuote /Part >> /K [${kRef}] >>\nendobj`
    );
  });

  (doc.internal.events as any).subscribe('putCatalog', () => {
    if (structTreeRootId) {
      (doc.internal as any).write(`/StructTreeRoot ${structTreeRootId} 0 R`);
    }
    const colorMode = (state.settings.colorMode || 'cmyk').toUpperCase();
    const iccProfile = state.settings.iccProfile || (colorMode === 'CMYK' ? 'FOGRA39' : 'sRGB');
    (doc.internal as any).write(`/OutputIntents [<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (${iccProfile}) /Info (${colorMode} ${iccProfile} Output Intent) /RegistryName (http://www.color.org) >>]`);
    (doc.internal as any).write('/MarkInfo << /Marked true >> /Lang (en-US)');
  });

  const filename = `${state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-document'}.pdf`;
  doc.save(filename);
  return doc;
}

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
  doc.setTextColor(c, m, y, k);
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
  doc.setFillColor(c, m, y, k);
  if (typeof (doc.internal as any).out === 'function') {
    (doc.internal as any).out('/GSKnockout gs');
  }
}

export function applyCmykDrawColor(doc: any, colorStr: string | undefined): void {
  const [c, m, y, k] = colorToCmyk(colorStr || '#000000');
  doc.setDrawColor(c, m, y, k);
}

function applyFont(doc: any, fontFamily: string) {
  const fam = fontFamily ? fontFamily.toLowerCase() : '';
  if (fam.includes('sans') || fam.includes('inter') || fam.includes('grotesk')) {
    doc.setFont('helvetica', 'normal');
  } else if (fam.includes('mono')) {
    doc.setFont('courier', 'normal');
  } else {
    doc.setFont('times', 'normal');
  }
}

function drawPlaceholderImage(doc: any, x: number, y: number, w: number, h: number, caption?: string) {
  doc.setFillColor(248, 248, 248);
  doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h, 'S');
  doc.line(x, y, x + w, y + h);
  doc.line(x + w, y, x, y + h);

  if (caption) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text(caption, x + w / 2, y + h / 2 + 6, { align: 'center' });
  }
}

export function drawCropMarks(doc: any, x: number, y: number, w: number, h: number, bleed: number) {
  // Pure 100% K Black for crisp offset press registration
  doc.setDrawColor(0, 0, 0, 100);
  doc.setLineWidth(0.1);

  const markLen = 6;
  const gap = 2;

  // Top-Left corner
  doc.line(x - gap - markLen, y, x - gap, y);
  doc.line(x, y - gap - markLen, x, y - gap);

  // Top-Right corner
  doc.line(x + w + gap, y, x + w + gap + markLen, y);
  doc.line(x + w, y - gap - markLen, x + w, y - gap);

  // Bottom-Left corner
  doc.line(x - gap - markLen, y + h, x - gap, y + h);
  doc.line(x, y + h + gap, x, y + h + gap + markLen);

  // Bottom-Right corner
  doc.line(x + w + gap, y + h, x + w + gap + markLen, y + h);
  doc.line(x + w, y + h + gap, x + w, y + h + gap + markLen);
}

export function drawRegistrationTargets(doc: any, x: number, y: number, w: number, h: number, slug: number) {
  // 4-Color Registration Plate (100C 100M 100Y 100K)
  doc.setDrawColor(100, 100, 100, 100);
  doc.setFillColor(100, 100, 100, 100);
  doc.setLineWidth(0.15);

  const targets = [
    { cx: x + w / 2, cy: y - 5.5 },          // Top target
    { cx: x + w / 2, cy: y + h + 5.5 },      // Bottom target
    { cx: x - 5.5, cy: y + h / 2 },          // Left target
    { cx: x + w + 5.5, cy: y + h / 2 },      // Right target
  ];

  for (const { cx, cy } of targets) {
    doc.circle(cx, cy, 3, 'S');
    doc.circle(cx, cy, 1.5, 'S');
    doc.line(cx - 4.5, cy, cx + 4.5, cy);
    doc.line(cx, cy - 4.5, cx, cy + 4.5);
  }
}

export function drawCMYKCalibrationBar(doc: any, x: number, y: number, w: number) {
  const barY = y - 11.5;
  const swatchW = 7;
  const swatchH = 3;

  // Native DeviceCMYK primary density swatches: C 100%, M 100%, Y 100%, K 100%, K 75%, K 50%, K 25%
  const swatches: [number, number, number, number][] = [
    [100, 0, 0, 0],   // Cyan 100%
    [0, 100, 0, 0],   // Magenta 100%
    [0, 0, 100, 0],   // Yellow 100%
    [0, 0, 0, 100],   // Black 100% (Pure K)
    [0, 0, 0, 75],    // Black 75%
    [0, 0, 0, 50],    // Black 50%
    [0, 0, 0, 25],    // Black 25%
  ];

  const startX = x + (w - swatches.length * swatchW) / 2;
  doc.setLineWidth(0.1);
  doc.setDrawColor(0, 0, 0, 40);

  swatches.forEach(([c, m, y, k], i) => {
    doc.setFillColor(c, m, y, k);
    doc.rect(startX + (i * swatchW), barY, swatchW, swatchH, 'FD');
  });
}

function drawSlugMetadata(
  doc: any,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  pageNum: number,
  totalPages: number,
  colorMode: string = 'cmyk',
  iccProfile: string = 'FOGRA39'
) {
  doc.setTextColor(100, 100, 100);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const safePageNum = Math.min(pageNum, totalPages);
  const metaText = `RECTO STUDIO | ${title.toUpperCase()} | PAGE ${safePageNum} OF ${totalPages} | ${timestamp} | COLOR: ${colorMode.toUpperCase()} (${iccProfile}) | PDF/X READY`;
  doc.text(metaText, x, y + h + 11.5);
}

function escapePdfText(str: string): string {
  return str ? str.replace(/[\\()]/g, (c) => '\\' + c) : '';
}
