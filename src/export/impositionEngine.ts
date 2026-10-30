/**
 * Recto Studio — Print Signature & Booklet Imposition Engine
 * Copyright (c) 2022-2026 Abhinav Sidhu. All rights reserved.
 * Licensed under the MIT License.
 */

import { jsPDF } from 'jspdf';
import { ProjectState, Spread, Page, ImageElement } from '../types/index';
import { stateManager } from '../state';
import { calculateImageFitting } from '../canvas';
import { exportDocumentToPdf } from './pdfExport';

export type ImpositionBindingMode = 'saddle-stitch' | 'perfect-bound' | 'consecutive-2up' | 'mini-zine-8page';

export interface ImpositionSheetSide {
  sheetIndex: number;
  side: 'front' | 'back';
  sideNumber: number;
  leftPageNumber: number | null; // null represents blank padding page
  rightPageNumber: number | null;
  leftCreepMm: number;
  rightCreepMm: number;
  signatureIndex: number;
}

export interface ImpositionPlan {
  bindingMode: ImpositionBindingMode;
  totalPagesOriginal: number;
  totalPagesPadded: number;
  blankPagesAdded: number;
  sheetsCount: number;
  signatureSizePages: number;
  signaturesCount: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
  creepPerSheetMm: number;
  maxCreepMm: number;
  sheetSides: ImpositionSheetSide[];
}

export interface ImpositionOptions {
  bindingMode?: ImpositionBindingMode;
  signatureSize?: number; // 4, 8, 16, or 32 pages per signature (for perfect bound)
  creepMmPerSheet?: number; // e.g. 0.08mm per sheet
  includeCutMarks?: boolean;
  includeFoldLine?: boolean;
  includeSheetMetadata?: boolean;
  paperStockWeightGsm?: number;
}

/**
 * Calculates a complete mathematical imposition plan for booklet printing.
 */
export function calculateImpositionPlan(
  state: ProjectState,
  options: ImpositionOptions = {}
): ImpositionPlan {
  const bindingMode = options.bindingMode || 'saddle-stitch';
  const pageWidthMm = state.settings.widthMm || 210;
  const pageHeightMm = state.settings.heightMm || 297;
  const sheetWidthMm = pageWidthMm * 2;
  const sheetHeightMm = pageHeightMm;

  // Collect all ordered sequential page numbers from the project spreads
  const totalPagesOriginal = state.spreads.reduce((acc, s) => acc + s.pages.length, 0);

  // Signatures must be in multiples of 4 pages (each physical sheet has 2 pages front + 2 pages back = 4 pages)
  let signatureSize = options.signatureSize || 16;
  if (bindingMode === 'mini-zine-8page') {
    signatureSize = 8;
  } else if (bindingMode === 'saddle-stitch') {
    signatureSize = Math.max(4, Math.ceil(totalPagesOriginal / 4) * 4);
  } else if (signatureSize % 4 !== 0) {
    signatureSize = Math.max(4, Math.ceil(signatureSize / 4) * 4);
  }

  // Calculate total pages padded to multiple of signature size or 4
  const paddingUnit = bindingMode === 'mini-zine-8page' ? 8 : (bindingMode === 'saddle-stitch' ? 4 : signatureSize);
  const totalPagesPadded = Math.max(bindingMode === 'mini-zine-8page' ? 8 : 4, Math.ceil(totalPagesOriginal / paddingUnit) * paddingUnit);
  const blankPagesAdded = totalPagesPadded - totalPagesOriginal;
  const sheetsCount = bindingMode === 'mini-zine-8page' ? totalPagesPadded / 8 : totalPagesPadded / 4;
  const signaturesCount = Math.max(1, totalPagesPadded / signatureSize);

  // Creep estimation: ~0.08mm per 80gsm sheet unless specified
  const creepPerSheetMm = options.creepMmPerSheet !== undefined
    ? options.creepMmPerSheet
    : ((options.paperStockWeightGsm || 80) * 0.001);
  const maxCreepMm = (sheetsCount / signaturesCount) * creepPerSheetMm;

  const sheetSides: ImpositionSheetSide[] = [];
  let globalSideIndex = 1;

  if (bindingMode === 'mini-zine-8page') {
    // 8-Page French-Fold Mini-Zine: Imposes 8 pages onto 1 folding sheet
    for (let z = 0; z < signaturesCount; z++) {
      const zBase = z * 8;
      sheetSides.push({
        sheetIndex: z,
        side: 'front',
        sideNumber: globalSideIndex++,
        leftPageNumber: zBase + 8 <= totalPagesOriginal ? zBase + 8 : null,
        rightPageNumber: zBase + 1 <= totalPagesOriginal ? zBase + 1 : null,
        leftCreepMm: 0,
        rightCreepMm: 0,
        signatureIndex: z,
      });
      sheetSides.push({
        sheetIndex: z,
        side: 'back',
        sideNumber: globalSideIndex++,
        leftPageNumber: zBase + 2 <= totalPagesOriginal ? zBase + 2 : null,
        rightPageNumber: zBase + 7 <= totalPagesOriginal ? zBase + 7 : null,
        leftCreepMm: 0,
        rightCreepMm: 0,
        signatureIndex: z,
      });
    }
  } else if (bindingMode === 'consecutive-2up') {
    // Simple 2-up reader spread proofing
    for (let i = 0; i < totalPagesPadded; i += 2) {
      const pLeft = i + 1 <= totalPagesOriginal ? i + 1 : null;
      const pRight = i + 2 <= totalPagesOriginal ? i + 2 : null;
      sheetSides.push({
        sheetIndex: Math.floor(i / 4),
        side: (Math.floor(i / 2) % 2 === 0) ? 'front' : 'back',
        sideNumber: globalSideIndex++,
        leftPageNumber: pLeft,
        rightPageNumber: pRight,
        leftCreepMm: 0,
        rightCreepMm: 0,
        signatureIndex: 0,
      });
    }
  } else {
    // Saddle-Stitch or Multi-Signature Perfect Bound
    const sheetsPerSig = signatureSize / 4;

    for (let sig = 0; sig < signaturesCount; sig++) {
      const sigStartPage = sig * signatureSize + 1;
      const sigEndPage = (sig + 1) * signatureSize;

      for (let s = 0; s < sheetsPerSig; s++) {
        // Creep: outer sheets stay anchored, inner sheets move outward towards face
        const innerDistance = s; // 0 is outer sheet, increases inward
        const sheetCreep = innerDistance * creepPerSheetMm;

        // Front Side: [ Left = sigEndPage - 2*s | Right = sigStartPage + 2*s ]
        const frontLeft = sigEndPage - (2 * s);
        const frontRight = sigStartPage + (2 * s);

        sheetSides.push({
          sheetIndex: sig * sheetsPerSig + s,
          side: 'front',
          sideNumber: globalSideIndex++,
          leftPageNumber: frontLeft <= totalPagesOriginal ? frontLeft : null,
          rightPageNumber: frontRight <= totalPagesOriginal ? frontRight : null,
          leftCreepMm: sheetCreep === 0 ? 0 : -sheetCreep, // Shifts away from spine
          rightCreepMm: sheetCreep, // Shifts away from spine
          signatureIndex: sig,
        });

        // Back Side: [ Left = sigStartPage + 2*s + 1 | Right = sigEndPage - 2*s - 1 ]
        const backLeft = sigStartPage + (2 * s) + 1;
        const backRight = sigEndPage - (2 * s) - 1;

        sheetSides.push({
          sheetIndex: sig * sheetsPerSig + s,
          side: 'back',
          sideNumber: globalSideIndex++,
          leftPageNumber: backLeft <= totalPagesOriginal ? backLeft : null,
          rightPageNumber: backRight <= totalPagesOriginal ? backRight : null,
          leftCreepMm: sheetCreep === 0 ? 0 : -sheetCreep,
          rightCreepMm: sheetCreep,
          signatureIndex: sig,
        });
      }
    }
  }

  return {
    bindingMode,
    totalPagesOriginal,
    totalPagesPadded,
    blankPagesAdded,
    sheetsCount,
    signatureSizePages: signatureSize,
    signaturesCount,
    sheetWidthMm,
    sheetHeightMm,
    pageWidthMm,
    pageHeightMm,
    creepPerSheetMm,
    maxCreepMm,
    sheetSides,
  };
}

/**
 * Renders a single publication page onto a target jsPDF document at specified sheet coordinates.
 */
function renderSinglePageToSheet(
  sourceDoc: jsPDF,
  targetDoc: jsPDF,
  pageIndexZeroBased: number,
  destX: number,
  destY: number,
  pageWidthMm: number,
  pageHeightMm: number
) {
  // We use jsPDF internal canvas / page copying or native vector primitives
  try {
    targetDoc.setFillColor(255, 255, 255);
    targetDoc.rect(destX, destY, pageWidthMm, pageHeightMm, 'F');
  } catch (e) {
    // fallback
  }
}

/**
 * Draws professional imposition printer marks:
 * - Center fold line (dashed line between the two pages)
 * - Sheet corner crop marks
 * - Sheet metadata header
 */
export function drawImpositionSheetMarks(
  doc: jsPDF,
  side: ImpositionSheetSide,
  plan: ImpositionPlan,
  docTitle: string,
  slugMm: number = 10
) {
  const originX = slugMm;
  const originY = slugMm;
  const sheetW = plan.sheetWidthMm;
  const sheetH = plan.sheetHeightMm;
  const halfW = plan.pageWidthMm;

  // 1. Center Fold Guide Line (dashed line along spine)
  (doc as any).setDrawColor(0, 0, 0, 0.8);
  doc.setLineWidth(0.12);
  (doc as any).setLineDashPattern([2, 2], 0);
  doc.line(originX + halfW, originY - 4, originX + halfW, originY + sheetH + 4);
  (doc as any).setLineDashPattern([], 0); // reset to solid

  // 2. Corner Sheet Trim Marks
  const markLen = 5;
  (doc as any).setDrawColor(0, 0, 0, 1);
  doc.setLineWidth(0.1);

  // Top-Left
  doc.line(originX - markLen, originY, originX - 1, originY);
  doc.line(originX, originY - markLen, originX, originY - 1);
  // Top-Right
  doc.line(originX + sheetW + 1, originY, originX + sheetW + markLen, originY);
  doc.line(originX + sheetW, originY - markLen, originX + sheetW, originY - 1);
  // Bottom-Left
  doc.line(originX - markLen, originY + sheetH, originX - 1, originY + sheetH);
  doc.line(originX, originY + sheetH + 1, originX, originY + sheetH + markLen);
  // Bottom-Right
  doc.line(originX + sheetW + 1, originY + sheetH, originX + sheetW + markLen, originY + sheetH);
  doc.line(originX + sheetW, originY + sheetH + 1, originX + sheetW, originY + sheetH + markLen);

  // 3. Imposition Metadata Slug
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');

  const leftLabel = side.leftPageNumber ? `PAGE ${side.leftPageNumber}` : 'BLANK';
  const rightLabel = side.rightPageNumber ? `PAGE ${side.rightPageNumber}` : 'BLANK';
  const sigText = plan.signaturesCount > 1 ? ` | SIG ${side.signatureIndex + 1}/${plan.signaturesCount}` : '';
  const sideLabel = side.side.toUpperCase();

  const metaString = `RECTO STUDIO IMPOSITION | SHEET ${side.sheetIndex + 1} OF ${plan.sheetsCount} (${sideLabel}) | [ ${leftLabel} | ${rightLabel} ]${sigText} | ${plan.bindingMode.toUpperCase()} | ${docTitle.toUpperCase()}`;
  doc.text(metaString, originX, originY - 5);
}

/**
 * Compiles a print-ready duplex booklet PDF with imposed sheets.
 */
export async function exportImposedBookletPdf(
  state: ProjectState,
  options: ImpositionOptions = {}
): Promise<jsPDF> {
  const plan = calculateImpositionPlan(state, options);
  const slugMm = 12;

  const totalSheetWidth = plan.sheetWidthMm + (slugMm * 2);
  const totalSheetHeight = plan.sheetHeightMm + (slugMm * 2);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [totalSheetWidth, totalSheetHeight],
    compress: true,
  });

  doc.setDocumentProperties({
    title: `${state.settings.title} - Imposed Booklet`,
    subject: `Print-Ready Imposition (${plan.bindingMode})`,
    author: 'Abhinav Sidhu',
    creator: 'Recto Studio Imposition Engine',
  });

  // Collect page reference list from state
  const flatPages: { page: Page; spread: Spread }[] = [];
  for (const spread of state.spreads) {
    for (const page of spread.pages) {
      flatPages.push({ page, spread });
    }
  }

  let isFirstSheetSide = true;

  for (const side of plan.sheetSides) {
    if (!isFirstSheetSide) {
      doc.addPage([totalSheetWidth, totalSheetHeight], 'landscape');
    }
    isFirstSheetSide = false;

    // Draw background sheet
    doc.setFillColor(255, 255, 255);
    doc.rect(slugMm, slugMm, plan.sheetWidthMm, plan.sheetHeightMm, 'F');

    // Draw imposition printer marks
    if (options.includeCutMarks !== false) {
      drawImpositionSheetMarks(doc, side, plan, state.settings.title || 'Publication', slugMm);
    }

    // Render Left Page
    const leftOriginX = slugMm + side.leftCreepMm;
    const leftOriginY = slugMm;

    if (side.leftPageNumber && side.leftPageNumber <= flatPages.length) {
      const pageData = flatPages[side.leftPageNumber - 1];
      if (pageData) {
        renderPageElementsToImposedSheet(
          doc,
          state,
          pageData.spread,
          pageData.page,
          leftOriginX,
          leftOriginY,
          plan.pageWidthMm,
          plan.pageHeightMm
        );
      }
    } else {
      // Blank padding page indicator (subtle hairline box)
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.1);
      doc.rect(leftOriginX, leftOriginY, plan.pageWidthMm, plan.pageHeightMm, 'S');
    }

    // Render Right Page
    const rightOriginX = slugMm + plan.pageWidthMm + side.rightCreepMm;
    const rightOriginY = slugMm;

    if (side.rightPageNumber && side.rightPageNumber <= flatPages.length) {
      const pageData = flatPages[side.rightPageNumber - 1];
      if (pageData) {
        renderPageElementsToImposedSheet(
          doc,
          state,
          pageData.spread,
          pageData.page,
          rightOriginX,
          rightOriginY,
          plan.pageWidthMm,
          plan.pageHeightMm
        );
      }
    } else {
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.1);
      doc.rect(rightOriginX, rightOriginY, plan.pageWidthMm, plan.pageHeightMm, 'S');
    }
  }

  return doc;
}

/**
 * Direct vector renderer for placing a page's elements onto the imposed sheet canvas.
 */
function renderPageElementsToImposedSheet(
  doc: jsPDF,
  state: ProjectState,
  spread: Spread,
  page: Page,
  originX: number,
  originY: number,
  pageWidthMm: number,
  pageHeightMm: number
) {
  // Page Border / Bleed Container
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.08);
  doc.rect(originX, originY, pageWidthMm, pageHeightMm, 'S');

  // Master elements first
  if (spread.masterSpreadId) {
    const master = state.masterSpreads?.find(m => m.id === spread.masterSpreadId);
    if (master) {
      for (const mEl of master.elements) {
        if (spread.detachedMasterElementIds?.includes(mEl.id)) continue;
        const masterPage = master.pages.find(p => p.id === mEl.pageId);
        if (masterPage && masterPage.side !== page.side && spread.pages.length > 1) continue;

        const mX = originX + mEl.x;
        const mY = originY + mEl.y;

        if (mEl.type === 'shape') {
          doc.setFillColor(150, 150, 150);
          doc.rect(mX, mY, mEl.width, mEl.height, 'F');
        } else if (mEl.type === 'text') {
          doc.setFontSize(Math.max(6, (mEl as any).fontSizePt || 8));
          doc.setTextColor(100, 100, 100);
          const txt = (mEl as any).text.replace('{{page}}', String(page.pageNumber));
          doc.text(txt, mX, mY + 3);
        }
      }
    }
  }

  // Page Elements
  const pageElements = spread.elements.filter(el => el.pageId === page.id);
  pageElements.sort((a, b) => a.zIndex - b.zIndex);

  for (const el of pageElements) {
    const elX = originX + el.x;
    const elY = originY + el.y;

    if (el.type === 'shape') {
      const shape = el as any;
      if (shape.fillColor && shape.fillColor !== 'transparent') {
        doc.setFillColor(50, 50, 50);
        doc.rect(elX, elY, shape.width, shape.height, 'F');
      } else {
        doc.setDrawColor(50, 50, 50);
        doc.rect(elX, elY, shape.width, shape.height, 'S');
      }
    } else if (el.type === 'text') {
      const textEl = el as any;
      doc.setFontSize(Math.max(6, textEl.fontSizePt || 10));
      doc.setTextColor(20, 20, 20);
      const textContent = textEl.text || '';
      doc.text(textContent, elX, elY + (textEl.fontSizePt * 0.3527), {
        maxWidth: textEl.width,
        align: textEl.alignment || 'left',
      });
    } else if (el.type === 'image') {
      const img = el as ImageElement;
      const fullResSrc = img.src;
      if (fullResSrc && (fullResSrc.startsWith('data:image') || fullResSrc.startsWith('http') || fullResSrc.startsWith('blob:'))) {
        try {
          let imgW = img.originalWidth || 0;
          let imgH = img.originalHeight || 0;
          let fileType = 'JPEG';

          try {
            const props = doc.getImageProperties(fullResSrc);
            if (props && props.width > 0 && props.height > 0) {
              imgW = props.width;
              imgH = props.height;
              if (props.fileType) fileType = props.fileType;
            }
          } catch {
            // Ignore jsPDF inspection failure on non-standard formats
          }

          if (!imgW || !imgH) {
            const dims = stateManager.getImageDimensions(fullResSrc);
            if (dims && dims.width > 0 && dims.height > 0) {
              imgW = dims.width;
              imgH = dims.height;
            }
          }

          const imgWMm = imgW > 0 ? imgW / 3.7795275591 : img.width;
          const imgHMm = imgH > 0 ? imgH / 3.7795275591 : img.height;
          const fitMode = img.fitMode || 'fill';
          const fit = calculateImageFitting(elX, elY, img.width, img.height, imgWMm, imgHMm, fitMode);

          const needsClipping = fitMode === 'fill' || fitMode === 'center';
          if (needsClipping) {
            doc.saveGraphicsState();
            doc.rect(elX, elY, img.width, img.height, null);
            doc.clip();
            doc.discardPath();
          }

          doc.addImage(fullResSrc, fileType, fit.drawX, fit.drawY, fit.drawW, fit.drawH);

          if (needsClipping) {
            doc.restoreGraphicsState();
          }

          if (img.borderWidthMm > 0 && img.borderColor && img.borderColor !== 'transparent') {
            doc.setDrawColor(img.borderColor);
            doc.setLineWidth(img.borderWidthMm);
            doc.rect(elX, elY, img.width, img.height, 'S');
          }
        } catch {
          doc.setFillColor(235, 235, 235);
          doc.rect(elX, elY, img.width, img.height, 'F');
        }
      } else {
        doc.setFillColor(235, 235, 235);
        doc.rect(elX, elY, img.width, img.height, 'F');
        doc.setFontSize(7);
        doc.setTextColor(140, 140, 140);
        doc.text(img.name || 'Image', elX + img.width / 2, elY + img.height / 2, { align: 'center' });
      }
    }
  }

  // Running Folio watermark
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(`[ ${page.pageNumber} ]`, originX + pageWidthMm / 2, originY + pageHeightMm - 3, { align: 'center' });
}
