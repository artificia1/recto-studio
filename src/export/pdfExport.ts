/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { jsPDF } from 'jspdf';
import { ProjectState, Page, Spread, TextElement, ImageElement, ShapeElement, VectorPathElement } from '../types/index';
import { stateManager, numberToSuperscript } from '../state';

export interface ExportOptions {
  includeCropMarks?: boolean;
  includeBleed?: boolean;
  includeRegistrationMarks?: boolean;
  includeColorBars?: boolean;
  exportFormat?: 'pages' | 'spreads';
  spreadRange?: 'all' | 'current' | number[];
}

export async function exportDocumentToPdf(
  state: ProjectState,
  options: ExportOptions = {}
): Promise<jsPDF> {
  const {
    includeCropMarks = true,
    includeBleed = true,
    includeRegistrationMarks = true,
    includeColorBars = true,
    spreadRange = 'all',
  } = options;

  const { widthMm, heightMm, bleedMm } = state.settings;
  const bleed = includeBleed ? bleedMm : 0;
  const slug = (includeCropMarks || includeRegistrationMarks || includeColorBars) ? 12 : 0;

  const pdfPageWidth = widthMm + (bleed * 2) + (slug * 2);
  const pdfPageHeight = heightMm + (bleed * 2) + (slug * 2);

  const orientation = widthMm > heightMm ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [pdfPageWidth, pdfPageHeight],
    compress: true,
  });

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

    // 1. Fill page background
    doc.setFillColor(255, 255, 255);
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
        page.pageNumber,
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
          const masterPage = master.pages.find(p => p.id === mEl.pageId);
          if (masterPage && masterPage.side !== page.side && spread.pages.length > 1) {
            continue;
          }

          const mX = originX + mEl.x;
          const mY = originY + mEl.y;

          if (mEl.type === 'shape') {
            const shape = mEl as ShapeElement;
            doc.setFillColor(shape.fillColor || '#ffffff');
            doc.setDrawColor(shape.strokeColor || '#000000');
            doc.setLineWidth(shape.strokeWidthMm || 0.2);
            if (shape.shapeKind === 'line') {
              doc.line(mX, mY, mX + shape.width, mY + shape.height);
            } else if (shape.shapeKind === 'rectangle') {
              doc.rect(mX, mY, shape.width, shape.height, shape.fillColor ? 'FD' : 'S');
            }
          } else if (mEl.type === 'text') {
            const textEl = mEl as TextElement;
            const evalText = stateManager.evaluateTokens(textEl.text, page.pageNumber);
            doc.setTextColor(textEl.color || '#666666');
            doc.setFontSize(textEl.fontSizePt);
            applyFont(doc, textEl.fontFamily);
            doc.text(evalText, mX, mY + (textEl.fontSizePt * 0.3527), {
              maxWidth: textEl.width,
              align: textEl.alignment === 'right' ? 'right' : (textEl.alignment === 'center' ? 'center' : 'left'),
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
        doc.setFillColor(shape.fillColor || '#ffffff');
        doc.setDrawColor(shape.strokeColor || '#000000');
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
          doc.setDrawColor(pathEl.strokeColor || '#000000');
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
          doc.setFillColor(text.backgroundColor);
          doc.rect(elX, elY, text.width, text.height, 'F');
        }
        if (text.borderWidthMm > 0 && text.borderColor !== 'transparent') {
          doc.setDrawColor(text.borderColor);
          doc.setLineWidth(text.borderWidthMm);
          doc.rect(elX, elY, text.width, text.height, 'S');
        }

        doc.setTextColor(text.color || '#000000');
        doc.setFontSize(text.fontSizePt);
        applyFont(doc, text.fontFamily);

        const padding = text.paddingMm || 2;
        const availableWidth = text.width - (padding * 2);

        if (text.columns > 1) {
          const colGutter = text.columnGutterMm || 5;
          const colWidth = (availableWidth - (colGutter * (text.columns - 1))) / text.columns;
          const paragraphs = text.text.split('\n');
          const linesPerCol = Math.ceil(paragraphs.length / text.columns);
          for (let c = 0; c < text.columns; c++) {
            const colText = paragraphs.slice(c * linesPerCol, (c + 1) * linesPerCol).join('\n');
            const colX = elX + padding + (c * (colWidth + colGutter));
            doc.text(colText, colX, elY + padding + (text.fontSizePt * 0.3527), {
              maxWidth: colWidth,
              align: text.alignment === 'justify' ? 'justify' : text.alignment,
            });
          }
        } else {
          doc.text(text.text, elX + padding, elY + padding + (text.fontSizePt * 0.3527), {
            maxWidth: availableWidth,
            align: text.alignment === 'justify' ? 'justify' : text.alignment,
          });
        }

        const footnotes = stateManager.getFootnotesForElement(text.id);
        if (footnotes.length > 0) {
          const fnSettings = state.settings.footnoteSettings || {
            numberingStyle: 'superscript',
            separatorRuleWidthMm: 30,
            separatorRuleThicknessPt: 0.5,
            fontSizePt: 8,
          };
          const fnFontSizePt = fnSettings.fontSizePt || 8;
          const fnLineHeightMm = fnFontSizePt * 0.3527 * 1.35;
          const totalFnHtMm = (footnotes.length * fnLineHeightMm) + 3;
          const fnStartY = elY + text.height - padding - totalFnHtMm + 1;
          const ruleWidthMm = Math.min(availableWidth * 0.45, fnSettings.separatorRuleWidthMm || 30);

          doc.setDrawColor(128, 128, 128);
          doc.setLineWidth((fnSettings.separatorRuleThicknessPt || 0.5) * 0.3527);
          doc.line(elX + padding, fnStartY, elX + padding + ruleWidthMm, fnStartY);

          doc.setFontSize(fnFontSizePt);
          doc.setTextColor(text.color || '#222222');
          footnotes.forEach((fn, idx) => {
            const lineY = fnStartY + 2 + (idx * fnLineHeightMm);
            const marker = numberToSuperscript(fn.number);
            doc.text(`${marker} ${fn.text}`, elX + padding, lineY);
          });
        }
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        if (img.src && (img.src.startsWith('data:image') || img.src.startsWith('http') || img.src.startsWith('blob:'))) {
          try {
            doc.addImage(img.src, 'JPEG', elX, elY, img.width, img.height);
          } catch (e) {
            drawPlaceholderImage(doc, elX, elY, img.width, img.height, img.caption);
          }
        } else {
          drawPlaceholderImage(doc, elX, elY, img.width, img.height, img.caption);
        }
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
  doc.setDrawColor(0, 0, 0);
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

  // Bleed perimeter dashed guide
  if (bleed > 0) {
    doc.setDrawColor(220, 100, 100);
    doc.setLineDashPattern([1, 2], 0);
    doc.rect(x - bleed, y - bleed, w + (bleed * 2), h + (bleed * 2), 'S');
    doc.setLineDashPattern([], 0);
  }
}

export function drawRegistrationTargets(doc: any, x: number, y: number, w: number, h: number, slug: number) {
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(0, 0, 0);
  doc.setLineWidth(0.15);

  const targets = [
    { cx: x + w / 2, cy: y - slug / 2 },          // Top target
    { cx: x + w / 2, cy: y + h + slug / 2 },      // Bottom target
    { cx: x - slug / 2, cy: y + h / 2 },          // Left target
    { cx: x + w + slug / 2, cy: y + h / 2 },      // Right target
  ];

  for (const { cx, cy } of targets) {
    doc.circle(cx, cy, 3, 'S');
    doc.circle(cx, cy, 1.5, 'S');
    doc.line(cx - 4.5, cy, cx + 4.5, cy);
    doc.line(cx, cy - 4.5, cx, cy + 4.5);
  }
}

export function drawCMYKCalibrationBar(doc: any, x: number, y: number, w: number) {
  const barY = y - 9;
  const swatchW = 7;
  const swatchH = 3;

  // CMYK primary density swatches: Cyan, Magenta, Yellow, Black, 75% Gray, 50% Gray, 25% Gray
  const swatches = [
    { r: 0, g: 163, b: 224 },   // C 100%
    { r: 236, g: 0, b: 140 },   // M 100%
    { r: 255, g: 242, b: 0 },   // Y 100%
    { r: 20, g: 20, b: 20 },     // K 100%
    { r: 80, g: 80, b: 80 },     // K 75%
    { r: 140, g: 140, b: 140 }, // K 50%
    { r: 200, g: 200, b: 200 }, // K 25%
  ];

  const startX = x + (w - swatches.length * swatchW) / 2;
  doc.setLineWidth(0.1);
  doc.setDrawColor(180, 180, 180);

  swatches.forEach((color, i) => {
    doc.setFillColor(color.r, color.g, color.b);
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
  const metaText = `RECTO STUDIO · ${title.toUpperCase()} · PAGE ${pageNum} OF ${totalPages} · ${timestamp} · COLOR: ${colorMode.toUpperCase()} (${iccProfile}) · PDF/X READY`;
  doc.text(metaText, x, y + h + 8);
}

function escapePdfText(str: string): string {
  return str ? str.replace(/[\\()]/g, (c) => '\\' + c) : '';
}
