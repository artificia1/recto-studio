import { instantiateMasterItem, resolveMaster } from '../engine/masterInheritance';
import { layoutFrameNotes, notesForFrame, publicationSnapshot, publicationText } from '../engine/publicationReferences';
import { publicationPreflight } from '../engine/publicationPreflight';
import { embeddedAsset, prepareExportAssets } from './publicationAssets';
import { registerPdfFonts } from './pdfFonts';
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
import { layoutStory, measureStoryText } from '../engine/storyLayout';
import { drawFontText, fontTextWidth, wrapFontText } from './fontOutlines';
import { ProjectState, Page, Spread, TextElement, ImageElement, ShapeElement, VectorPathElement, TableElement, CanvasElement } from '../types/index';
import { stateManager, numberToSuperscript } from '../state';
import { calculateImageFitting } from '../canvas';
import { assetStore } from '../engine/assetStore';
import { tableEngine } from '../engine/tableEngine';
import { tableThread } from '../engine/tableCells';
import { prepareManagedPdf } from './iccPdf';
import { publicationWrapObjects, wrappedPlainContent } from '../engine/publicationWrap';
import { formatOpenTypeText } from '../engine/legacyTypography';
import { drawVectorPathPdf } from './vectorPathPdf';
import { documentColor } from './pdfColors';
import type { PdfContentTag } from './pdfStructure';
import type { PressStandard } from './pdfPress';
import { getFreeToneColor, FreeToneSpotColor } from '../engine/spotColors';

export interface ExportOptions {
  pressStandard?: PressStandard;
  accessibility?: 'pdfua1';
  transparency?: 'live' | 'flatten';
  flattenDpi?: number;
  trapping?: { widthPt: number; tacLimit?: number };
  tagged?: boolean;
  strict?: boolean;
  fetchExternalAssets?: boolean;
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

export async function exportDocumentToPdf(
  source: ProjectState,
  options: ExportOptions = {}
): Promise<jsPDF> {
  if (options.pressStandard) {
    if (!['pdfx1a-2003', 'pdfx4'].includes(options.pressStandard)) throw new Error('Unsupported PDF/X target.');
    if (options.tagged || options.accessibility) throw new Error('Export separate accessible screen and PDF/X print editions.');
    if (options.pressStandard === 'pdfx4' && options.transparency === 'flatten') throw new Error('Use the PDF/X-1a target for flattened output or PDF/X-4 for live transparency.');
    options = { ...options, strict: true, transparency: options.pressStandard === 'pdfx1a-2003' ? 'flatten' : 'live' };
  }
  if (options.exportFormat === 'spreads') throw new Error('Spread PDF output is not implemented. Export individual pages or use booklet imposition.');
  if (options.accessibility && options.accessibility !== 'pdfua1') throw new Error('Only PDF/UA-1 (PDF 1.7) output is supported. PDF/UA-2 requires a separate PDF 2.0 pipeline.');
  if (options.accessibility && options.spreadRange && options.spreadRange !== 'all') throw new Error('Accessible PDF currently exports the whole publication so linked tables and story structure remain complete.');
  if (options.transparency === 'flatten' && (options.tagged || options.accessibility)) throw new Error('Use separate tagged screen and flattened print exports; a flattened print PDF is not an accessible screen edition.');
  await fontManager.restoreFonts(source.embeddedFonts);
  const state = publicationSnapshot(await prepareExportAssets(source, options.fetchExternalAssets ?? typeof window !== 'undefined'));
  const publicationIssues = publicationPreflight(state, options.strict ? 'print' : 'editor');
  const tableErrors = publicationIssues.filter(issue => issue.code === 'TABLE_LAYOUT' && issue.severity === 'error');
  if (tableErrors.length) throw new Error(tableErrors.map(issue => `Page ${issue.pageNumber}: ${issue.message}`).join('\n'));
  if (options.strict || options.accessibility) {
    const errors = publicationIssues.filter(issue => issue.severity === 'error');
    if (errors.length) throw new Error(errors.map(issue => `Page ${issue.pageNumber}: ${issue.message}`).join('\n'));
    if (state.settings.footnotes?.some(note => note.kind === 'endnote') && !state.spreads.some(spread => spread.elements.some(element => element.type === 'text' && element.generated?.kind === 'endnotes'))) {
      throw new Error('Create the endnotes list in Pages before exporting print PDF.');
    }
  }
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
    putOnlyUsedFonts: options.transparency === 'flatten' || !!options.accessibility || !!options.pressStandard,
  });
  const managedPdf = await prepareManagedPdf(doc, state);

  // Helpers always emit the knockout state, including when overprint is disabled.
  (doc as any).__private__.setPdfVersion('1.7');
  {
    const baseGState = new (doc as any).GState({ opacity: 1 });
    (doc as any).setGState(baseGState);
    (doc.internal.events as any).subscribe('putGStateDict', () => {
      for (const name of ['Normal', 'Multiply', 'Screen', 'Overlay']) (doc.internal as any).write(`/GSBlend${name} << /Type /ExtGState /BM /${name} >>`);
      (doc.internal as any).write('/GSOverprint << /Type /ExtGState /OP true /op true /OPM 1 >>');
      (doc.internal as any).write('/GSKnockout << /Type /ExtGState /OP false /op false /OPM 0 >>');
    });
  }

  doc.setDocumentProperties({
    title: state.settings.title || 'Recto Document',
    subject: 'Publication exported from Recto Studio',
    author: state.settings.author || 'Recto Studio',
    keywords: 'publication, desktop publishing',
    creator: 'Recto Studio (Open-Source DTP Architecture)',
  });

  const storyOverflowMap = new Map<string, string[]>();
  doc.setLanguage((state.settings.language || 'en-US') as Parameters<typeof doc.setLanguage>[0]);
  const preflightWarnings: string[] = registerPdfFonts(doc, state.embeddedFonts);
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
  const trapEngine = options.trapping ? await import('../engine/processTrapping') : undefined;
  const trapGeometry = options.trapping ? await import('../engine/prepressGeometry') : undefined;
  for (const spread of targetSpreads) {
    for (const el of spread.elements) {
      if (el.spotColor) {
        const spot = getFreeToneColor(el.spotColor);
        if (spot) usedSpotColors.set(spot.name, spot);
      }
    }
  }

  // Colour spaces belong inside Resources, never as floating serialization tokens.
  // The final object pass installs spot resources after jsPDF has finished writing.
  const structure = options.tagged || options.accessibility ? await import('./pdfStructure') : undefined;
  const semantic = options.accessibility ? new (await import('./pdfSemantics')).PdfSemantics(doc, state) : undefined;
  const tags: PdfContentTag[] = [];

  const pagesToExport: { page: Page; spread: Spread }[] = [];
  const flattenArtwork: CanvasElement[][] = [];
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
    if (structure) (doc.internal as any).write('/Artifact BMC');

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
    if (structure) (doc.internal as any).write('EMC');

    // Use the same renderer for master and page artwork, keeping masters behind page objects.
    const master = resolveMaster(state.masterSpreads, spread.masterSpreadId);
    const masterElements = (master?.elements || []).filter(element =>
      masterTargetPage(master!.pages, spread.pages, element.pageId)?.id === page.id &&
      !spread.detachedMasterElementIds?.includes(element.id) &&
      !spread.elements.some(candidate => candidate.masterSourceId === element.id && candidate.pageId === page.id))
      .map(element => instantiateMasterItem(element, page.id, text => publicationText(state, text, page.pageNumber)));
    semantic?.furniture(masterElements.map(element => element.id));
    const paintOrder = (a: CanvasElement, b: CanvasElement) => (state.layers.find(layer => layer.id === a.layerId)?.order || 0) - (state.layers.find(layer => layer.id === b.layerId)?.order || 0) || a.zIndex - b.zIndex;
    const pageElements = [...masterElements.sort(paintOrder), ...spread.elements.filter(element => element.pageId === page.id).sort(paintOrder)]
      .filter(element => element.opacity > 0 && !element.pasteboard && !element.editorialOnly && state.layers?.find(layer => layer.id === element.layerId)?.visible !== false);
    const pageArtwork: CanvasElement[] = [];
    if (options.transparency === 'flatten') flattenArtwork.push(pageArtwork);
    if (options.pressStandard && pageElements.some(element => element.shadow)) throw new Error('Render object shadows into an image before preparing PDF/X; this exporter does not reproduce live shadows.');

    const trapResult = trapEngine ? trapEngine.calculateProcessTraps(pageElements, css => documentColor(doc, css), options.trapping!.widthPt, options.trapping!.tacLimit || state.settings.colorManagement?.tacLimit || 320) : undefined;
    if (trapResult) preflightWarnings.push(...trapResult.warnings.map(warning => `Page ${page.pageNumber}: ${warning}`));
    for (const el of pageElements) {
      const fullResSrc = el.type === 'image' ? (assetStore.getFullResolution(el.assetId || el.src) as string) || el.src : undefined;
      if (options.transparency === 'flatten') pageArtwork.push(el.type === 'image' && fullResSrc ? { ...el, src: fullResSrc } : el);
      if (el.spotColor) { const spot = getFreeToneColor(el.spotColor); if (spot) usedSpotColors.set(spot.name, spot); }
      if (structure) {
        if (semantic) {
          if (el.interactiveField || (el as any).hyperlink) throw new Error('Interactive fields and links need annotation tagging; remove them or use the ordinary tagged screen preset.');
          semantic.image(el);
        } else {
        const pageNumber = doc.getNumberOfPages();
        const mcid = tags.filter(tag => tag.page === pageNumber).length;
        const tag = structure.elementPdfTag(state, el, pageNumber, mcid);
        if (tag) {
          tags.push(tag);
          const actualText = tag.text === undefined ? '' : ` /ActualText <FEFF${Array.from({ length: tag.text.length }, (_, index) => tag.text!.charCodeAt(index).toString(16).padStart(4, '0')).join('')}>`;
          (doc.internal as any).write(`/${tag.role} << /MCID ${tag.mcid}${actualText} >> BDC`);
        } else (doc.internal as any).write('/Artifact BMC');
        }
      }
      const elX = originX + el.x;
      const elY = originY + el.y;
      doc.saveGraphicsState();
      if (el.opacity !== 1) doc.setGState(doc.GState({ opacity: el.opacity, 'stroke-opacity': el.opacity }));
      const blend = ({ normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay' } as const)[el.blendMode || 'normal'];
      if (!blend) throw new Error('Unsupported object blend mode. Choose Normal, Multiply, Screen or Overlay.');
      (doc.internal as any).write(`/GSBlend${blend} gs`);
      if (el.rotation) {
        const angle = -el.rotation * Math.PI / 180, a = Math.cos(angle), b = Math.sin(angle), c = -b, d = a;
        const scale = doc.internal.scaleFactor;
        const cx = (elX + el.width / 2) * scale, cy = (pdfPageHeight - elY - el.height / 2) * scale;
        doc.setCurrentTransformationMatrix(doc.Matrix(a, b, c, d, cx - a * cx - c * cy, cy - b * cx - d * cy));
      }

      if (el.type === 'shape') {
        const shape = el as ShapeElement;
        const fill = !!shape.spotColor || !!shape.fillColor && !['transparent', 'none'].includes(shape.fillColor);
        const stroke = shape.strokeWidthMm > 0 && !!shape.strokeColor && !['transparent', 'none'].includes(shape.strokeColor);
        if (shape.spotColor) {
          applySpotColor(doc, shape.spotColor, false);
        } else {
          applyCmykFillColor(doc, shape.fillColor);
        }
        applyCmykDrawColor(doc, shape.strokeColor);
        if (stroke) doc.setLineWidth(shape.strokeWidthMm);
        doc.setLineDashPattern(shape.strokeDash === 'dashed' ? [2, 1] : [], 0);
        const paint = fill && stroke ? 'FD' : fill ? 'F' : stroke ? 'S' : undefined;

        if (shape.shapeKind === 'rectangle') {
          if (paint) doc.rect(elX, elY, shape.width, shape.height, paint);
        } else if (shape.shapeKind === 'ellipse') {
          if (paint) doc.ellipse(elX + shape.width / 2, elY + shape.height / 2, shape.width / 2, shape.height / 2, paint);
        } else if (shape.shapeKind === 'line') {
          if (stroke) { if (shape.spotColor) applySpotColor(doc, shape.spotColor, true); doc.line(elX, elY, elX + shape.width, elY + shape.height); }
        }
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        drawVectorPathPdf(doc, pathEl, elX, elY);
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
        // Match the canvas optical-margin clip and bound glyph overhangs for flattening.
        doc.rect(elX - 25.4 / 24, elY, text.width + 25.4 / 12, text.height, null); doc.clip(); doc.discardPath();

        if (text.spotColor) {
          applySpotColor(doc, text.spotColor, false);
        } else {
          applyCmykTextColor(doc, text.color || '#000000', overprintBlack);
        }
        doc.setFontSize(text.fontSizePt);
        applyFont(doc, text.fontFamily);

        const padding = text.paddingMm ?? 0;
        const availableWidth = Math.max(2, text.width - (padding * 2));

        const footnotes = notesForFrame(state, text);
        const fnSettings = state.settings.footnoteSettings || {
          numberingStyle: 'superscript',
          separatorRuleWidthMm: 30,
          separatorRuleThicknessPt: 0.5,
          fontSizePt: 8,
        };
        const fnFontSizePt = fnSettings.fontSizePt || 8;
        const fnLineHeightMm = fnFontSizePt * 0.3527 * 1.35;
        const noteLayout = layoutFrameNotes(state, text, footnotes);
        const totalFnHtMm = noteLayout.height;
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

        const wrapObjects = publicationWrapObjects(state, spread);
        const hasWrap = wrapObjects.some(object => object.id !== text.id && object.pageId === text.pageId);
        const flowContent = text.textContent || (hasWrap || semantic ? wrappedPlainContent(text, formatOpenTypeText(publicationText(state, text.text || '', page.pageNumber).replace(/\{index:[^}]+\}/g, ''), text.openTypeFeatures)) : undefined);
        if (flowContent) {
          const layout = layoutStory(flowContent, text, state.paragraphStyles, state.characterStyles, undefined, totalFnHtMm,
            { obstacles: wrapObjects, baselineGrid: state.settings.baselineGrid });
          for (const line of layout.lines) {
          const lineSemantics = semantic?.line(text, flowContent, line.start);
          for (const original of line.segments) {
          const parts = lineSemantics?.parts(original.text) || [{ text: original.text, parent: '' }];
          let advance = 0;
          for (const part of parts) {
            const segment = { ...original, text: part.text, x: original.x + advance };
            const style = segment.style;
            semantic?.assertFont(style.fontFamily, segment.text);
            const end = lineSemantics?.begin(segment.text, part.parent);
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
            end?.(); advance += measureStoryText(part.text, style) + (style.letterSpacingPt || 0) * 25.4 / 72 * Array.from(part.text).length;
          }
          }
          }
          if (layout.overset && !text.nextFrameId) {
            const warning = `Page ${page.pageNumber}: Text frame "${text.id}" has overset manuscript text.`;
            preflightWarnings.push(warning);

          }
        } else {
        let linesToRender: string[];
        if (text.prevFrameId && storyOverflowMap.has(text.id)) {
          linesToRender = storyOverflowMap.get(text.id)!;
        } else {
          let evalText = publicationText(state, text.text || '', page.pageNumber);
          if (evalText.includes('{cond:')) {
            evalText = publicationText(state, evalText, page.pageNumber);
          }
          if (evalText.includes('{xref:')) {
            evalText = publicationText(state, evalText, page.pageNumber);
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
          const fnStartY = elY + text.height - padding - totalFnHtMm;
          const ruleWidthMm = Math.min(noteLayout.columnWidth * 0.45, fnSettings.separatorRuleWidthMm || 30);

          applyCmykDrawColor(doc, '#808080');
          doc.setLineWidth((fnSettings.separatorRuleThicknessPt || 0.5) * 0.3527);
          for (const x of new Set(noteLayout.lines.map(line => line.x))) doc.line(elX + padding + x, fnStartY, elX + padding + x + ruleWidthMm, fnStartY);

          doc.setFontSize(fnFontSizePt);
          applyCmykTextColor(doc, text.color || '#222222');
          const noteFont = fontManager.getFont(noteLayout.family);
          applyFont(doc, noteLayout.family);
          noteLayout.lines.forEach(line => {
            semantic?.assertFont(noteLayout.family, line.text);
            const end = semantic?.note(text, line.noteId, line.text);
            const lineY = fnStartY + 3 + noteLayout.size * 25.4 / 72 + line.y;
            if (noteFont) {
              applyCmykFillColor(doc, text.color || '#222222');
              drawFontText(doc, noteFont, line.text, elX + padding + line.x, lineY, noteLayout.size);
            } else doc.text(line.text, elX + padding + line.x, lineY);
            end?.();
          });
        }
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        const source = fullResSrc ?? img.src;
        if (img.equation || source.startsWith('data:image/svg+xml')) {
          if (options.pressStandard) throw new Error('For PDF/X preparation, supply SVG/equation artwork as an sRGB raster image.');
          const svgSource = img.equation ? (await import('../engine/equations')).renderEquation(img.equation).svg : new TextDecoder().decode(embeddedAsset(source).bytes);
          doc.saveGraphicsState();
          try {
            doc.rect(elX, elY, img.width, img.height, null); doc.clip(); doc.discardPath();
            const { drawSvgPdf } = await import('./svgPdf');
            await drawSvgPdf(doc, svgSource, img, elX, elY);
          } finally { doc.restoreGraphicsState(); }
          if (img.borderWidthMm > 0 && img.borderColor !== 'transparent') {
            applyCmykDrawColor(doc, img.borderColor);
            doc.setLineWidth(img.borderWidthMm);
            doc.rect(elX, elY, img.width, img.height, 'S');
          }
        } else if (source && (source.startsWith('data:image') || source.startsWith('http') || source.startsWith('blob:'))) {
          try {
            const managedImage = managedPdf ? await managedPdf.raster(source) : undefined;
            let imgW = img.originalWidth || 0;
            let imgH = img.originalHeight || 0;
            let fileType = 'JPEG';

            try {
              const props = managedImage || doc.getImageProperties(source);
              if (props && props.width > 0 && props.height > 0) {
                imgW = props.width;
                imgH = props.height;
                if ('fileType' in props && props.fileType) fileType = props.fileType;
              }
            } catch {
              // Ignore jsPDF inspection errors for unsupported types
            }

            if (!imgW || !imgH) {
              const dims = stateManager.getImageDimensions(source) || stateManager.getImageDimensions(img.src);
              if (dims && dims.width > 0 && dims.height > 0) {
                imgW = dims.width;
                imgH = dims.height;
              }
            }

            const imgWMm = imgW > 0 ? imgW / 3.7795275591 : img.width;
            const imgHMm = imgH > 0 ? imgH / 3.7795275591 : img.height;
            const fitMode = img.fitMode || 'fill';
            const fit = calculateImageFitting(elX, elY, img.width, img.height, imgWMm, imgHMm, fitMode, img.focalPoint);

            const needsClipping = fitMode === 'fill' || fitMode === 'center';
            if (needsClipping) {
              doc.saveGraphicsState();
              doc.rect(elX, elY, img.width, img.height, null);
              doc.clip();
              doc.discardPath();
            }

            if (managedImage) doc.addImage(managedImage.bytes, 'RECTOCMYK', fit.drawX, fit.drawY, fit.drawW, fit.drawH, managedImage.alias);
            else doc.addImage(source, fileType, fit.drawX, fit.drawY, fit.drawW, fit.drawH);

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
            throw new Error(`Image “${img.name || img.id}” could not be rendered. Relink it before exporting. ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          drawPlaceholderImage(doc, elX, elY, img.width, img.height, img.caption);
        }
      } else if (el.type === 'table') {
        const table = el as TableElement;
        const tableFrames = tableThread(state.spreads, table);
        tableEngine.exportPdfTable(doc, table, elX, elY, table.width, table.height, tableFrames, overprintBlack, semantic?.table(table, tableFrames[0]));
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
      doc.restoreGraphicsState();
      for (const trap of trapResult?.traps.filter(trap => trap.afterElementId === el.id) || []) {
        doc.saveGraphicsState();
        applyCmykFillColor(doc, `cmyk(${trap.cmyk.join(',')})`);
        const operations = trapGeometry!.inkCoordinates(trap.paths).flatMap(path => [
          { op: 'm', c: [originX + path[0].x, originY + path[0].y] },
          ...path.slice(1).map(point => ({ op: 'l', c: [originX + point.x, originY + point.y] })), { op: 'h', c: [] },
        ]);
        doc.path(operations); doc.fillEvenOdd(); doc.restoreGraphicsState();
      }
      if (structure) (doc.internal as any).write('EMC');
    }

  }

  if ((options.strict || options.accessibility) && preflightWarnings.some(warning => /overset/i.test(warning))) {
    throw new Error(preflightWarnings.filter(warning => /overset/i.test(warning)).join('\n'));
  }
  for (const warning of preflightWarnings) options.onWarning?.(warning);
  semantic?.validate();

  let finalized = (structure || usedSpotColors.size) ? await (structure || await import('./pdfStructure')).finishPdf(doc, state, [...usedSpotColors.values()], semantic?.tags || (structure ? tags : undefined), options.compress !== false, semantic?.groups) : undefined;
  if (options.transparency === 'flatten') {
    const { flattenPdfTransparency } = await import('./transparencyFlatten');
    const result = await flattenPdfTransparency(new Uint8Array(doc.output('arraybuffer')), state, flattenArtwork, slug + bleed, options.flattenDpi || 300);
    finalized = result.bytes; (doc as any).flatteningReport = { rasterTiles: result.rasterTiles, flattenedPages: result.flattenedPages };
    (await import('./pdfStructure')).bindFinalizedPdf(doc, finalized);
  }
  if (options.accessibility) {
    finalized = await (await import('./pdfUa')).identifyPdfUa1(new Uint8Array(doc.output('arraybuffer')), state);
    (await import('./pdfStructure')).bindFinalizedPdf(doc, finalized);
    (doc as any).accessibilityReport = { standard: 'PDF/UA-1', humanReviewRequired: true, limits: ['No interactive annotation tagging', 'Embedded static TTF fonts required', 'Content-sized tables required'] };
    options.onWarning?.('Accessible PDF/UA-1 prepared. Validate the final publication and review image descriptions and reading order with assistive technology.');
  }
  if (options.pressStandard) {
    const result = await (await import('./pdfPress')).preparePressPdf(new Uint8Array(doc.output('arraybuffer')), state, options.pressStandard);
    finalized = result.bytes; (doc as any).pressReport = result.report;
    (await import('./pdfStructure')).bindFinalizedPdf(doc, finalized);
    options.onWarning?.('PDF/X candidate prepared. Independent ISO preflight and printer approval are required; this export is not GWG certified.');
  }

  const filename = `${state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-document'}.pdf`;
  if (options.download !== false) {
    if (isDesktop() || finalized) await savePublicationFile(filename, doc.output('arraybuffer'), 'application/pdf');
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
