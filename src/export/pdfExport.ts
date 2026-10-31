/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { jsPDF } from 'jspdf';
import { masterTargetPage } from '../engine/pageLabels';
import { colorToCmyk, applyCmykTextColor, applyCmykFillColor, applyCmykDrawColor, applySpotColor } from './pdfColors';
export { colorToCmyk, applyCmykTextColor, applyCmykFillColor, applyCmykDrawColor, applySpotColor } from './pdfColors';
import { fontManager } from '../fontManager';
import { isDesktop, savePublicationFile } from '../desktop';
import { layoutStory } from '../engine/storyLayout';
import { drawFontText, fontTextWidth, wrapFontText } from './fontOutlines';
import { ProjectState, Page, Spread, TextElement, ImageElement, ShapeElement, VectorPathElement, TableElement } from '../types/index';
import { stateManager, numberToSuperscript } from '../state';
import { calculateImageFitting } from '../canvas';
import { assetStore } from '../engine/assetStore';
import { tableEngine } from '../engine/tableEngine';
import { getFreeToneColor, getSafeSpotName, generatePdfSeparationDict, FreeToneSpotColor } from '../engine/spotColors';

export interface ExportOptions {
  download?: boolean;
  includeCropMarks?: boolean;
  includeBleed?: boolean;
  includeRegistrationMarks?: boolean;
  includeColorBars?: boolean;
  exportFormat?: 'pages' | 'spreads';
  spreadRange?: 'all' | 'current' | number[];
  compress?: boolean;
  overprintBlack?: boolean;
  onWarning?: (warning: string) => void;
}

function drawBezierSegmentInPdf(
  doc: any,
  originX: number,
  originY: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): void {
  const isStraight =
    Math.abs(p1.x - p0.x) < 0.001 &&
    Math.abs(p1.y - p0.y) < 0.001 &&
    Math.abs(p2.x - p3.x) < 0.001 &&
    Math.abs(p2.y - p3.y) < 0.001;

  if (isStraight) {
    doc.line(originX + p0.x, originY + p0.y, originX + p3.x, originY + p3.y);
    return;
  }

  const STEPS = 16;
  let lastX = originX + p0.x;
  let lastY = originY + p0.y;
  for (let s = 1; s <= STEPS; s++) {
    const t = s / STEPS;
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const curX = originX + (uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x);
    const curY = originY + (uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y);
    doc.line(lastX, lastY, curX, curY);
    lastX = curX;
    lastY = curY;
  }
}

export async function exportDocumentToPdf(
  state: ProjectState,
  options: ExportOptions = {}
): Promise<jsPDF> {
  await fontManager.restoreFonts(state.embeddedFonts);
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

  // Helpers always emit the knockout state, including when overprint is disabled.
  {
    const baseGState = new (doc as any).GState({ opacity: 1 });
    (doc as any).setGState(baseGState);
    (doc.internal.events as any).subscribe('putGStateDict', () => {
      (doc.internal as any).write('/GSOverprint << /Type /ExtGState /OP true /op true /OPM 1 >>');
      (doc.internal as any).write('/GSKnockout << /Type /ExtGState /OP false /op false /OPM 0 >>');
    });
  }

  doc.setDocumentProperties({
    title: state.settings.title || 'Recto Document',
    subject: 'Publication exported from Recto Studio',
    author: 'Recto Studio',
    keywords: 'publication, desktop publishing',
    creator: 'Recto Studio (Open-Source DTP Architecture)',
  });

  const storyOverflowMap = new Map<string, string[]>();
  const preflightWarnings: string[] = [];
  (doc as any).preflightWarnings = preflightWarnings;

  let isFirstPage = true;

  // Determine spreads to export
  let targetSpreads: Spread[] = state.spreads;
  if (spreadRange === 'current') {
    targetSpreads = [state.spreads[state.activeSpreadIndex] || state.spreads[0]];
  } else if (Array.isArray(spreadRange)) {
    targetSpreads = state.spreads.filter((_, idx) => spreadRange.includes(idx));
  }

  // Register FreeTone Spot Colors in PDF ColorSpace Resource Dictionary
  const usedSpotColors = new Map<string, FreeToneSpotColor>();
  for (const spread of targetSpreads) {
    for (const el of spread.elements) {
      if (el.spotColor) {
        const spot = getFreeToneColor(el.spotColor);
        if (spot) usedSpotColors.set(spot.name, spot);
      }
    }
  }

  if (usedSpotColors.size > 0) {
    (doc.internal.events as any).subscribe('putResources', () => {
      let csDict = '/ColorSpace << ';
      for (const [_, spot] of usedSpotColors) {
        const safeName = getSafeSpotName(spot.name);
        csDict += `/CS_${safeName} ${generatePdfSeparationDict(spot)} `;
      }
      csDict += '>>';
      (doc.internal as any).write(csDict);
    });
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
    // jsPDF page boxes use points measured from the bottom-left corner.
    const pointsPerMm = 72 / 25.4;
    const box = (insetMm: number) => ({
      bottomLeftX: insetMm * pointsPerMm,
      bottomLeftY: insetMm * pointsPerMm,
      topRightX: (pdfPageWidth - insetMm) * pointsPerMm,
      topRightY: (pdfPageHeight - insetMm) * pointsPerMm,
    });
    const pageContext = (doc.internal as any).getCurrentPageInfo().pageContext;
    pageContext.trimBox = box(slug + bleed);
    pageContext.bleedBox = box(slug);

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
          if (masterTargetPage(master.pages, spread.pages, mEl.pageId)?.id !== page.id) {
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
            const masterFont = fontManager.getFont(textEl.fontFamily);
            if (masterFont) {
              applyCmykFillColor(doc, textEl.color || '#000000');
              const width = fontTextWidth(masterFont, evalText, textEl.fontSizePt);
              const x = mAlign === 'center' ? mTargetX - width / 2 : mAlign === 'right' ? mTargetX - width : mTargetX;
              drawFontText(doc, masterFont, evalText, x, mY + textEl.fontSizePt * 0.3527, textEl.fontSizePt);
            } else doc.text(evalText, mTargetX, mY + (textEl.fontSizePt * 0.3527), {
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
        if (shape.spotColor) {
          applySpotColor(doc, shape.spotColor, false);
        } else {
          applyCmykFillColor(doc, shape.fillColor);
        }
        applyCmykDrawColor(doc, shape.strokeColor);
        doc.setLineWidth(shape.strokeWidthMm || 0.2);

        if (shape.shapeKind === 'rectangle') {
          doc.rect(elX, elY, shape.width, shape.height, (shape.fillColor && shape.fillColor !== 'transparent') || shape.spotColor ? 'FD' : 'S');
        } else if (shape.shapeKind === 'ellipse') {
          doc.ellipse(elX + shape.width / 2, elY + shape.height / 2, shape.width / 2, shape.height / 2, (shape.fillColor && shape.fillColor !== 'transparent') || shape.spotColor ? 'FD' : 'S');
        } else if (shape.shapeKind === 'line') {
          doc.line(elX, elY, elX + shape.width, elY + shape.height);
        }
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        if (pathEl.nodes.length >= 2) {
          if (pathEl.spotColor) {
            applySpotColor(doc, pathEl.spotColor, true);
          } else {
            applyCmykDrawColor(doc, pathEl.strokeColor);
          }
          doc.setLineWidth(pathEl.strokeWidthMm || 0.3);
          for (let i = 1; i < pathEl.nodes.length; i++) {
            const prev = pathEl.nodes[i - 1];
            const curr = pathEl.nodes[i];
            const p0 = { x: prev.x, y: prev.y };
            const p1 = { x: prev.x + (prev.handleOut?.x || 0), y: prev.y + (prev.handleOut?.y || 0) };
            const p2 = { x: curr.x + (curr.handleIn?.x || 0), y: curr.y + (curr.handleIn?.y || 0) };
            const p3 = { x: curr.x, y: curr.y };
            drawBezierSegmentInPdf(doc, elX, elY, p0, p1, p2, p3);
          }
          if (pathEl.closed && pathEl.nodes.length >= 3) {
            const first = pathEl.nodes[0];
            const last = pathEl.nodes[pathEl.nodes.length - 1];
            const p0 = { x: last.x, y: last.y };
            const p1 = { x: last.x + (last.handleOut?.x || 0), y: last.y + (last.handleOut?.y || 0) };
            const p2 = { x: first.x + (first.handleIn?.x || 0), y: first.y + (first.handleIn?.y || 0) };
            const p3 = { x: first.x, y: first.y };
            drawBezierSegmentInPdf(doc, elX, elY, p0, p1, p2, p3);
          }
        }
      } else if (el.type === 'text') {
        const text = el as TextElement;
        const customFont = fontManager.getFont(text.fontFamily);
        if (text.backgroundColor && text.backgroundColor !== 'transparent') {
          applyCmykFillColor(doc, text.backgroundColor);
          doc.rect(elX, elY, text.width, text.height, 'F');
        }
        if (text.borderWidthMm > 0 && text.borderColor !== 'transparent') {
          applyCmykDrawColor(doc, text.borderColor);
          doc.setLineWidth(text.borderWidthMm);
          doc.rect(elX, elY, text.width, text.height, 'S');
        }

        if (text.spotColor) {
          applySpotColor(doc, text.spotColor, false);
        } else {
          applyCmykTextColor(doc, text.color || '#000000', overprintBlack);
        }
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

        const colCount = text.spanColumns
          ? 1
          : (text.splitColumns && text.splitColumns > 1 ? text.splitColumns : Math.max(1, text.columns || 1));
        const colGutter = text.columnGutterMm || 4;
        const colWidth = Math.max(2, (availableWidth - (colGutter * (colCount - 1))) / colCount);

        const lineHeight = text.lineHeight || 1.3;
        if (typeof (doc as any).setLineHeightFactor === 'function') {
          (doc as any).setLineHeightFactor(lineHeight);
        }
        const lineSpacingMm = (text.fontSizePt * lineHeight * 25.4) / 72;
        const maxLinesPerCol = Math.max(1, Math.floor((availableHeight - (text.fontSizePt * 0.3527)) / lineSpacingMm) + 1);

        if (text.textContent) {
          const layout = layoutStory(text.textContent, text, state.paragraphStyles, state.characterStyles, undefined, totalFnHtMm,
            { obstacles: spread.elements, baselineGrid: state.settings.baselineGrid });
          for (const line of layout.lines) for (const segment of line.segments) {
            const style = segment.style;
            const font = fontManager.getFont(style.fontFamily);
            const x = elX + segment.x;
            const y = elY + line.y + style.fontSizePt * 25.4 / 72;
            applyCmykTextColor(doc, style.color, overprintBlack);
            if (font) {
              applyCmykFillColor(doc, style.color);
              drawFontText(doc, font, segment.text, x, y, style.fontSizePt);
            } else {
              applyFont(doc, style.fontFamily);
              doc.setFont(doc.getFont().fontName, style.bold ? (style.italic ? 'bolditalic' : 'bold') : (style.italic ? 'italic' : 'normal'));
              doc.setFontSize(style.fontSizePt);
              doc.setCharSpace(style.letterSpacingPt * 25.4 / 72);
              doc.text(segment.text, x, y);
              doc.setCharSpace(0);
            }
            if (style.underline) {
              applyCmykDrawColor(doc, style.color);
              doc.setLineWidth(0.15);
              doc.line(x, y + 0.3, x + segment.width, y + 0.3);
            }
          }
          if (layout.overset && !text.nextFrameId) {
            const warning = `Page ${page.pageNumber}: Text frame "${text.id}" has overset manuscript text.`;
            preflightWarnings.push(warning);
            options.onWarning?.(warning);
          }
        } else {
        let linesToRender: string[];
        if (text.prevFrameId && storyOverflowMap.has(text.id)) {
          linesToRender = storyOverflowMap.get(text.id)!;
        } else {
          let evalText = stateManager.evaluateTokens(text.text || '', page.pageNumber);
          if (evalText.includes('{cond:')) {
            evalText = stateManager.evaluateConditions(evalText);
          }
          if (evalText.includes('{xref:')) {
            evalText = stateManager.resolveCrossReferences(evalText);
          }
          if (evalText.includes('{index:')) {
            evalText = evalText.replace(/\{index:[^}]+\}/g, '');
          }
          linesToRender = customFont
            ? wrapFontText(customFont, evalText, text.fontSizePt, colWidth)
            : doc.splitTextToSize(evalText, colWidth);
        }

        const totalCapacity = colCount * maxLinesPerCol;
        const visibleLines = linesToRender.slice(0, totalCapacity);
        const overflowLines = linesToRender.slice(totalCapacity);

        if (overflowLines.length > 0) {
          if (text.nextFrameId) {
            storyOverflowMap.set(text.nextFrameId, overflowLines);
          } else {
            const warningMsg = `Page ${page.pageNumber}: Text frame "${text.id}" overset by ${overflowLines.length} lines.`;
            preflightWarnings.push(warningMsg);
            if (options.onWarning) options.onWarning(warningMsg);
          }
        }

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

          if (customFont) {
            if (text.spotColor) applySpotColor(doc, text.spotColor, false);
            else applyCmykFillColor(doc, text.color || '#000000');
            colLines.forEach((line, index) => {
              const width = fontTextWidth(customFont, line, text.fontSizePt);
              const alignedX = alignOpt === 'center' ? textX - width / 2 : alignOpt === 'right' ? textX - width : textX;
              drawFontText(doc, customFont, line, alignedX, startY + index * lineSpacingMm, text.fontSizePt);
            });
          } else doc.text(colLines, textX, startY, {
            maxWidth: colWidth,
            align: alignOpt,
          });
        }

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
            if (customFont) {
              applyCmykFillColor(doc, text.color || '#222222');
              drawFontText(doc, customFont, `${marker} ${fn.text}`, elX + padding, lineY, fnFontSizePt);
            } else doc.text(`${marker} ${fn.text}`, elX + padding, lineY);
          });
        }
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        const fullResSrc = (assetStore.getFullResolution(img.assetId || img.src) as string) || img.src;
        if (img.equation) {
          if (typeof DOMParser === 'undefined') throw new Error('Equation PDF export requires the Recto desktop app or a browser. Headless exports can use EPUB or SVG.');
          // Re-typeset the stored source, never inject SVG supplied by an imported project.
          const { renderEquation } = await import('../engine/equations');
          const { svg2pdf } = await import('svg2pdf.js');
          const rendered = renderEquation(img.equation);
          const svg = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml').documentElement;
          const fit = calculateImageFitting(elX, elY, img.width, img.height, rendered.widthMm, rendered.heightMm, img.fitMode || 'fit');
          doc.saveGraphicsState();
          try {
            doc.rect(elX, elY, img.width, img.height, null);
            doc.clip();
            doc.discardPath();
            await svg2pdf(svg, doc, { x: fit.drawX, y: fit.drawY, width: fit.drawW, height: fit.drawH });
          } finally { doc.restoreGraphicsState(); }
          if (img.borderWidthMm > 0 && img.borderColor !== 'transparent') {
            applyCmykDrawColor(doc, img.borderColor);
            doc.setLineWidth(img.borderWidthMm);
            doc.rect(elX, elY, img.width, img.height, 'S');
          }
        } else if (fullResSrc && (fullResSrc.startsWith('data:image') || fullResSrc.startsWith('http') || fullResSrc.startsWith('blob:'))) {
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
              // Ignore jsPDF inspection errors for unsupported types
            }

            if (!imgW || !imgH) {
              const dims = stateManager.getImageDimensions(fullResSrc) || stateManager.getImageDimensions(img.src);
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
              applyCmykDrawColor(doc, img.borderColor);
              doc.setLineWidth(img.borderWidthMm);
              doc.rect(elX, elY, img.width, img.height, 'S');
            }

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

      // 4b. AcroForm Interactive PDF Form Field
      if (el.interactiveField && typeof (doc as any).addField === 'function') {
        const field = el.interactiveField;
        const fieldX = elX;
        const fieldY = elY;
        const fieldW = el.width;
        const fieldH = el.height;

        if (field.type === 'text') {
          const tf = new (doc as any).AcroFormTextField();
          tf.fieldName = field.fieldName;
          tf.value = field.defaultValue || '';
          tf.Rect = [fieldX, fieldY, fieldW, fieldH];
          if (field.multiline) tf.multiline = true;
          if (field.required) tf.required = true;
          (doc as any).addField(tf);
        } else if (field.type === 'checkbox') {
          const cb = new (doc as any).AcroFormCheckBox();
          cb.fieldName = field.fieldName;
          cb.Rect = [fieldX, fieldY, fieldW, fieldH];
          if (field.defaultValue === 'true' || field.defaultValue === 'yes' || field.defaultValue === 'checked') {
            cb.appearanceState = 'Yes';
          }
          (doc as any).addField(cb);
        } else if (field.type === 'button') {
          const btn = new (doc as any).AcroFormButton();
          btn.fieldName = field.fieldName;
          btn.caption = field.defaultValue || field.fieldName;
          btn.Rect = [fieldX, fieldY, fieldW, fieldH];
          (doc as any).addField(btn);
        }
      }
    }

  }

  // Content is not tagged with MCIDs; do not advertise PDF/UA or PDF/X conformance.
  (doc.internal.events as any).subscribe('putCatalog', () => {
    (doc.internal as any).write('/Lang (en-US)');
  });

  const filename = `${state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-document'}.pdf`;
  if (options.download !== false) {
    if (isDesktop()) await savePublicationFile(filename, doc.output('arraybuffer'), 'application/pdf');
    else doc.save(filename);
  }
  return doc;
}


// shortcut: custom font embedding requires TTF base64, falls back to PostScript standard 14 when unavailable
function applyFont(doc: any, fontFamily?: string) {
  if (!fontFamily) {
    doc.setFont('times', 'normal');
    return;
  }
  const cleanName = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  const fontList = typeof (doc as any).getFontList === 'function' ? (doc as any).getFontList() : {};
  if (fontList && (fontList[cleanName] || fontList[cleanName.toLowerCase()])) {
    doc.setFont(cleanName, 'normal');
    return;
  }
  const fam = cleanName.toLowerCase();
  if (fam.includes('sans') || fam.includes('inter') || fam.includes('grotesk') || fam.includes('arial')) {
    doc.setFont('helvetica', 'normal');
  } else if (fam.includes('mono') || fam.includes('courier')) {
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
  doc.setDrawColor(0, 0, 0, 1);
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
  doc.setDrawColor(1, 1, 1, 1);
  doc.setFillColor(1, 1, 1, 1);
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
  doc.setDrawColor(0, 0, 0, 0.4);

  swatches.forEach(([c, m, y, k], i) => {
    doc.setFillColor(c / 100, m / 100, y / 100, k / 100);
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
  const metaText = `RECTO STUDIO | ${title.toUpperCase()} | PAGE ${safePageNum} OF ${totalPages} | ${timestamp} | COLOR SETTING: ${colorMode.toUpperCase()} (${iccProfile})`;
  doc.text(metaText, x, y + h + 11.5);
}

function escapePdfText(str: string): string {
  return str ? str.replace(/[\\()]/g, (c) => '\\' + c) : '';
}
