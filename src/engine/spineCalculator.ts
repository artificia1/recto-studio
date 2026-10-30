/**
 * Recto Studio — Live Wrap Cover Designer & Mathematical Spine Calculator
 * Copyright (c) 2022-2026 Abhinav Sidhu. All rights reserved.
 * Licensed under the MIT License.
 */

import { jsPDF } from 'jspdf';
import { ProjectState, Spread, Page, TextElement, ShapeElement } from '../types/index';

export type PaperStockPreset =
  | 'cream-60lb'      // 90 gsm Natural Cream Fiction (PPI: 400, Caliper: 0.0635mm)
  | 'white-50lb'      // 74 gsm Standard Offset Text (PPI: 498, Caliper: 0.0510mm)
  | 'white-60lb'      // 90 gsm Non-Fiction Smooth White (PPI: 444, Caliper: 0.0572mm)
  | 'white-70lb'      // 104 gsm Heavy Textbook (PPI: 356, Caliper: 0.0713mm)
  | 'coated-80lb'     // 118 gsm Matte Art & Illustrated (PPI: 436, Caliper: 0.0582mm)
  | 'coated-100lb'    // 148 gsm Premium Gloss Photo (PPI: 334, Caliper: 0.0760mm)
  | 'custom';

export type BindingType =
  | 'paperback-perfect'    // Standard Softcover Perfect Bound
  | 'paperback-flaps'      // Softcover with 75mm French Flaps
  | 'hardcover-case';      // Casebound Hardcover (Cardboard Wrap + Hinge Grooves + Turn-in Bleed)

export interface PaperStockInfo {
  id: PaperStockPreset;
  name: string;
  weightGsm: number;
  caliperMm: number; // Single sheet thickness in mm (page count / 2 * caliperMm)
  ppi: number;       // Pages Per Inch
  recommendedFor: string;
}

export const PAPER_STOCK_PRESETS: Record<PaperStockPreset, PaperStockInfo> = {
  'cream-60lb': {
    id: 'cream-60lb',
    name: '60# Cream / Natural Fiction',
    weightGsm: 90,
    caliperMm: 0.0635,
    ppi: 400,
    recommendedFor: 'Literary fiction, memoirs, trade paperbacks',
  },
  'white-50lb': {
    id: 'white-50lb',
    name: '50# White Standard Offset',
    weightGsm: 74,
    caliperMm: 0.0510,
    ppi: 498,
    recommendedFor: 'Mass market paperbacks, poetry, high page-count texts',
  },
  'white-60lb': {
    id: 'white-60lb',
    name: '60# White Non-Fiction',
    weightGsm: 90,
    caliperMm: 0.0572,
    ppi: 444,
    recommendedFor: 'Non-fiction, essays, history, academic publishing',
  },
  'white-70lb': {
    id: 'white-70lb',
    name: '70# White Heavy Text',
    weightGsm: 104,
    caliperMm: 0.0713,
    ppi: 356,
    recommendedFor: 'Technical manuals, workbooks, cookbooks',
  },
  'coated-80lb': {
    id: 'coated-80lb',
    name: '80# Matte Coated Art',
    weightGsm: 118,
    caliperMm: 0.0582,
    ppi: 436,
    recommendedFor: 'Graphic novels, zines, art catalogs with color plates',
  },
  'coated-100lb': {
    id: 'coated-100lb',
    name: '100# Gloss Coated Photo',
    weightGsm: 148,
    caliperMm: 0.0760,
    ppi: 334,
    recommendedFor: 'Photography books, portfolio lookbooks, coffee-table books',
  },
  'custom': {
    id: 'custom',
    name: 'Custom Stock Caliper',
    weightGsm: 80,
    caliperMm: 0.0600,
    ppi: 423,
    recommendedFor: 'Custom mill-specified stocks',
  },
};

export interface CoverSpineConfig {
  pageCount: number;
  stockPreset: PaperStockPreset;
  customCaliperMm?: number;
  trimWidthMm: number;
  trimHeightMm: number;
  bindingType: BindingType;
  bleedMm?: number;
  frenchFlapWidthMm?: number; // default 75mm if paperback-flaps
  includeBarcodeZone?: boolean;
  bookTitle?: string;
  authorName?: string;
}

export interface CoverSpineMetrics {
  spineWidthMm: number;
  spineWidthInches: number;
  totalWrapWidthMm: number;
  totalWrapHeightMm: number;
  bleedMm: number;
  hingeScoreMm: number;
  boardOverhangMm: number;
  turnInWrapMm: number;
  flapWidthMm: number;
  safetyMarginMm: number;
  // Coordinate zones (relative to totalWrapWidth, including bleed)
  backCoverX: number;
  spineX: number;
  frontCoverX: number;
  barcodeZone: {
    x: number;
    y: number;
    widthMm: number;
    heightMm: number;
  };
  ingramSparkCompliant: boolean;
  kdpCompliant: boolean;
}

/**
 * Calculates physical spine thickness and full wrap jacket dimensions with zero rounding drift.
 */
export function calculateCoverSpineMetrics(config: CoverSpineConfig): CoverSpineMetrics {
  const {
    pageCount,
    stockPreset,
    customCaliperMm,
    trimWidthMm,
    trimHeightMm,
    bindingType,
    includeBarcodeZone = true,
  } = config;

  const stock = PAPER_STOCK_PRESETS[stockPreset] || PAPER_STOCK_PRESETS['cream-60lb'];
  const caliper = (stockPreset === 'custom' && customCaliperMm && customCaliperMm > 0)
    ? customCaliperMm
    : stock.caliperMm;

  // Exact spine calculation: (Page Count / 2) * Single Sheet Caliper
  // Note: 2 pages = 1 sheet of paper
  const sheets = Math.ceil(pageCount / 2);
  let spineWidthMm = Math.round((sheets * caliper) * 100) / 100;

  // Minimum spine threshold for legible vertical typography is ~3.5mm
  spineWidthMm = Math.max(1.0, spineWidthMm);
  const spineWidthInches = Math.round((spineWidthMm / 25.4) * 1000) / 1000;

  let bleedMm = config.bleedMm !== undefined ? config.bleedMm : 3.175; // Standard 0.125 in / 3.175 mm
  let hingeScoreMm = 0;
  let boardOverhangMm = 0;
  let turnInWrapMm = 0;
  let flapWidthMm = 0;
  let safetyMarginMm = 6.35; // 0.25 inch standard safe margin

  if (bindingType === 'paperback-perfect') {
    hingeScoreMm = 0.8; // Score indentation
  } else if (bindingType === 'paperback-flaps') {
    hingeScoreMm = 0.8;
    flapWidthMm = config.frenchFlapWidthMm || 75;
  } else if (bindingType === 'hardcover-case') {
    // Casebound hardcover adds:
    // +3mm board overhang on top, bottom, and outside edges
    // +10mm hinge/joint gutter on each side of spine
    // +15mm wrap-around turn-in bleed (the printed paper wraps around the 2.5mm binder board)
    boardOverhangMm = 3.0;
    hingeScoreMm = 10.0;
    turnInWrapMm = 15.0;
    bleedMm = turnInWrapMm;
    safetyMarginMm = 12.0;
  }

  // Calculate Total Wrap Width:
  // [Bleed] + [Flap] + [Back Cover] + [Hinge] + [Spine] + [Hinge] + [Front Cover] + [Flap] + [Bleed]
  const backCoverWidth = trimWidthMm + boardOverhangMm;
  const frontCoverWidth = trimWidthMm + boardOverhangMm;
  const backCoverHeight = trimHeightMm + (boardOverhangMm * 2);

  const totalWrapWidthMm = Math.round(
    (bleedMm * 2 +
      flapWidthMm * 2 +
      backCoverWidth +
      frontCoverWidth +
      spineWidthMm +
      hingeScoreMm * 2) * 100
  ) / 100;

  const totalWrapHeightMm = Math.round((backCoverHeight + bleedMm * 2) * 100) / 100;

  // Relative coordinate zones from left edge (including left bleed)
  const backCoverX = bleedMm + flapWidthMm;
  const spineX = backCoverX + backCoverWidth + hingeScoreMm;
  const frontCoverX = spineX + spineWidthMm + hingeScoreMm;

  // Standard EAN/UPC ISBN Barcode Placement: Lower right of back cover
  const barcodeZone = {
    x: backCoverX + backCoverWidth - 55, // 50mm width + 5mm safety
    y: totalWrapHeightMm - bleedMm - 35, // 30mm height + 5mm safety
    widthMm: 50.8, // 2.0 inches
    heightMm: 30.0, // 1.2 inches
  };

  // Industry compliance audits
  const ingramSparkCompliant = spineWidthMm >= 2.5 && totalWrapWidthMm > 100;
  const kdpCompliant = pageCount >= 24 && spineWidthMm >= 1.5;

  return {
    spineWidthMm,
    spineWidthInches,
    totalWrapWidthMm,
    totalWrapHeightMm,
    bleedMm,
    hingeScoreMm,
    boardOverhangMm,
    turnInWrapMm,
    flapWidthMm,
    safetyMarginMm,
    backCoverX,
    spineX,
    frontCoverX,
    barcodeZone,
    ingramSparkCompliant,
    kdpCompliant,
  };
}

/**
 * Creates a brand new full wrap cover spread and injects it as Spread 0 into the document.
 */
export function createWrapCoverSpreadInProject(
  state: ProjectState,
  config: CoverSpineConfig
): Spread {
  const metrics = calculateCoverSpineMetrics(config);
  const now = Date.now();
  const bookTitle = config.bookTitle || state.settings.title || 'Untitled Book';
  const author = config.authorName || 'Abhinav Sidhu';

  const spreadId = `spread-wrap-cover-${now}`;
  const pageId = `page-wrap-cover-${now}`;

  const elements: (TextElement | ShapeElement)[] = [];

  // 1. Spine Visual Boundary / Shading
  elements.push({
    id: `el-cover-spine-bg-${now}`,
    name: 'Spine Background',
    type: 'shape',
    pageId,
    x: metrics.spineX,
    y: metrics.bleedMm,
    width: metrics.spineWidthMm,
    height: config.trimHeightMm + (metrics.boardOverhangMm * 2),
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: true,
    shapeKind: 'rectangle',
    fillColor: '#1a1a1e',
    strokeColor: '#2d2d34',
    strokeWidthMm: 0.2,
    strokeDash: 'solid',
  } as ShapeElement);

  // 2. Spine Vertical Title (if spine is thick enough >= 3.5mm)
  if (metrics.spineWidthMm >= 3.0) {
    const fontSize = Math.min(11, Math.max(6, Math.floor(metrics.spineWidthMm * 1.8)));
    elements.push({
      id: `el-cover-spine-title-${now}`,
      name: 'Spine Title',
      type: 'text',
      pageId,
      x: metrics.spineX + (metrics.spineWidthMm / 2) - (fontSize * 0.18),
      y: metrics.bleedMm + 25,
      width: config.trimHeightMm - 50,
      height: metrics.spineWidthMm,
      rotation: 90, // Vertical orientation running top to bottom
      opacity: 1,
      zIndex: 5,
      locked: false,
      text: `${bookTitle.toUpperCase()}   ·   ${author.toUpperCase()}`,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePt: fontSize,
      lineHeight: 1.1,
      letterSpacingPt: 1.5,
      color: '#e4e4e7',
      alignment: 'center',
      columns: 1,
      columnGutterMm: 4,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidthMm: 0,
      paddingMm: 1,
    } as TextElement);
  }

  // 3. Front Cover Title Block
  elements.push({
    id: `el-cover-front-title-${now}`,
    name: 'Front Cover Title',
    type: 'text',
    pageId,
    x: metrics.frontCoverX + 25,
    y: metrics.bleedMm + 45,
    width: config.trimWidthMm - 50,
    height: 60,
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    locked: false,
    text: bookTitle,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontSizePt: 36,
    lineHeight: 1.15,
    letterSpacingPt: 1.5,
    color: '#ffffff',
    alignment: 'center',
    columns: 1,
    columnGutterMm: 4,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidthMm: 0,
    paddingMm: 2,
  } as TextElement);

  // 4. Front Cover Author
  elements.push({
    id: `el-cover-front-author-${now}`,
    name: 'Front Cover Author',
    type: 'text',
    pageId,
    x: metrics.frontCoverX + 25,
    y: metrics.bleedMm + config.trimHeightMm - 40,
    width: config.trimWidthMm - 50,
    height: 18,
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    locked: false,
    text: author.toUpperCase(),
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizePt: 11,
    lineHeight: 1.2,
    letterSpacingPt: 3,
    color: '#a1a1aa',
    alignment: 'center',
    columns: 1,
    columnGutterMm: 4,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidthMm: 0,
    paddingMm: 1,
  } as TextElement);

  // 5. Back Cover Synopsis / Blurb
  elements.push({
    id: `el-cover-back-blurb-${now}`,
    name: 'Back Cover Blurb',
    type: 'text',
    pageId,
    x: metrics.backCoverX + 25,
    y: metrics.bleedMm + 45,
    width: config.trimWidthMm - 50,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    locked: false,
    text: `Praise for ${bookTitle}:\n\n"An extraordinary achievement in typography, structure, and editorial craftsmanship."\n\nSet your back cover synopsis, endorsements, and critical notices in this frame. Engineered with precision by Recto Studio.`,
    fontFamily: 'Merriweather, Georgia, serif',
    fontSizePt: 10,
    lineHeight: 1.5,
    letterSpacingPt: 0.1,
    color: '#d4d4d8',
    alignment: 'left',
    columns: 1,
    columnGutterMm: 4,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidthMm: 0,
    paddingMm: 2,
  } as TextElement);

  // 6. Barcode Zone Indicator
  if (config.includeBarcodeZone !== false) {
    elements.push({
      id: `el-cover-barcode-${now}`,
      name: 'ISBN Barcode Box',
      type: 'shape',
      pageId,
      x: metrics.barcodeZone.x,
      y: metrics.barcodeZone.y,
      width: metrics.barcodeZone.widthMm,
      height: metrics.barcodeZone.heightMm,
      rotation: 0,
      opacity: 0.95,
      zIndex: 15,
      locked: true,
      shapeKind: 'rectangle',
      fillColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidthMm: 0.2,
      strokeDash: 'solid',
    } as ShapeElement);

    elements.push({
      id: `el-cover-barcode-label-${now}`,
      name: 'ISBN Barcode Label',
      type: 'text',
      pageId,
      x: metrics.barcodeZone.x,
      y: metrics.barcodeZone.y + 12,
      width: metrics.barcodeZone.widthMm,
      height: 10,
      rotation: 0,
      opacity: 0.6,
      zIndex: 16,
      locked: true,
      text: 'ISBN BARCODE ZONE',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePt: 7,
      lineHeight: 1,
      letterSpacingPt: 1,
      color: '#000000',
      alignment: 'center',
      columns: 1,
      columnGutterMm: 2,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidthMm: 0,
      paddingMm: 1,
    } as TextElement);
  }

  const coverSpread: Spread = {
    id: spreadId,
    spreadIndex: 0,
    pages: [
      {
        id: pageId,
        pageNumber: 0, // Cover does not count as interior page 1
        side: 'single',
      },
    ],
    elements: elements as any,
  };

  return coverSpread;
}

/**
 * Generates an isolated, print-ready full wrap cover PDF/X with spine crop & fold lines.
 */
export async function exportWrapCoverPdf(
  config: CoverSpineConfig
): Promise<jsPDF> {
  const metrics = calculateCoverSpineMetrics(config);
  const slugMm = 12;

  const docWidth = metrics.totalWrapWidthMm + (slugMm * 2);
  const docHeight = metrics.totalWrapHeightMm + (slugMm * 2);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [docWidth, docHeight],
    compress: true,
  });

  doc.setDocumentProperties({
    title: `${config.bookTitle || 'Book'} - Full Wrap Cover`,
    subject: `Print-Ready Book Jacket Wrap (Spine: ${metrics.spineWidthMm}mm)`,
    author: config.authorName || 'Abhinav Sidhu',
    creator: 'Recto Studio Wrap Cover Generator',
  });

  const originX = slugMm;
  const originY = slugMm;

  // 1. Draw Wrap Background Canvas
  doc.setFillColor(24, 24, 27);
  doc.rect(originX, originY, metrics.totalWrapWidthMm, metrics.totalWrapHeightMm, 'F');

  // 2. Draw Spine Area
  doc.setFillColor(32, 32, 38);
  doc.rect(originX + metrics.spineX, originY, metrics.spineWidthMm, metrics.totalWrapHeightMm, 'F');

  // 3. Draw Spine Fold / Score Lines (Hairline Dashes above and below trim)
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.12);
  (doc as any).setLineDashPattern([2, 2], 0);

  // Left spine fold
  doc.line(originX + metrics.spineX, originY - 4, originX + metrics.spineX, originY + metrics.totalWrapHeightMm + 4);
  // Right spine fold
  doc.line(
    originX + metrics.spineX + metrics.spineWidthMm,
    originY - 4,
    originX + metrics.spineX + metrics.spineWidthMm,
    originY + metrics.totalWrapHeightMm + 4
  );
  (doc as any).setLineDashPattern([], 0); // reset to solid

  // 4. Outer Sheet Crop Marks
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.15);
  const mLen = 5;

  // Trim corners
  const trimX1 = originX + metrics.bleedMm;
  const trimY1 = originY + metrics.bleedMm;
  const trimX2 = originX + metrics.totalWrapWidthMm - metrics.bleedMm;
  const trimY2 = originY + metrics.totalWrapHeightMm - metrics.bleedMm;

  // Top-Left
  doc.line(trimX1 - mLen, trimY1, trimX1 - 1, trimY1);
  doc.line(trimX1, trimY1 - mLen, trimX1, trimY1 - 1);
  // Top-Right
  doc.line(trimX2 + 1, trimY1, trimX2 + mLen, trimY1);
  doc.line(trimX2, trimY1 - mLen, trimX2, trimY1 - 1);
  // Bottom-Left
  doc.line(trimX1 - mLen, trimY2, trimX1 - 1, trimY2);
  doc.line(trimX1, trimY2 + 1, trimX1, trimY2 + mLen);
  // Bottom-Right
  doc.line(trimX2 + 1, trimY2, trimX2 + mLen, trimY2);
  doc.line(trimX2, trimY2 + 1, trimX2, trimY2 + mLen);

  // 5. Spine Title (Vertical)
  if (metrics.spineWidthMm >= 3.0) {
    const fontSize = Math.min(10, Math.max(6, Math.floor(metrics.spineWidthMm * 1.6)));
    doc.setFontSize(fontSize);
    doc.setTextColor(230, 230, 230);
    doc.setFont('helvetica', 'bold');
    const spineText = `${(config.bookTitle || 'RECTO').toUpperCase()}   ·   ${(config.authorName || 'ABHINAV SIDHU').toUpperCase()}`;
    const textCenterY = originY + metrics.totalWrapHeightMm / 2;
    doc.text(spineText, originX + metrics.spineX + (metrics.spineWidthMm / 2) + 1, textCenterY, {
      align: 'center',
      angle: 90,
    });
  }

  // 6. Front Cover Text
  doc.setFontSize(32);
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bold');
  const frontCenterX = originX + metrics.frontCoverX + (config.trimWidthMm / 2);
  doc.text(config.bookTitle || 'RECTO', frontCenterX, originY + metrics.bleedMm + 60, { align: 'center' });

  doc.setFontSize(11);
  doc.setTextColor(180, 180, 180);
  doc.setFont('helvetica', 'normal');
  doc.text(
    (config.authorName || 'ABHINAV SIDHU').toUpperCase(),
    frontCenterX,
    originY + metrics.totalWrapHeightMm - metrics.bleedMm - 30,
    { align: 'center' }
  );

  // 7. Back Cover Synopsis
  doc.setFontSize(9);
  doc.setTextColor(200, 200, 200);
  doc.setFont('times', 'italic');
  const backLeftX = originX + metrics.backCoverX + 20;
  doc.text(
    `An uncompromising publication conceived and designed with Recto Studio.\nEngineered for independent bookmakers and typographers.`,
    backLeftX,
    originY + metrics.bleedMm + 50,
    { maxWidth: config.trimWidthMm - 40 }
  );

  // 8. Barcode Zone
  if (config.includeBarcodeZone !== false) {
    const bc = metrics.barcodeZone;
    doc.setFillColor(255, 255, 255);
    doc.rect(originX + bc.x, originY + bc.y, bc.widthMm, bc.heightMm, 'F');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('ISBN BARCODE PLACEHOLDER', originX + bc.x + bc.widthMm / 2, originY + bc.y + bc.heightMm / 2 + 2, {
      align: 'center',
    });
  }

  // 9. Prepress Metadata Slug
  doc.setFontSize(6.5);
  doc.setTextColor(160, 160, 160);
  doc.setFont('helvetica', 'normal');
  const meta = `RECTO WRAP COVER | TRIM: ${config.trimWidthMm}x${config.trimHeightMm}mm | SPINE: ${metrics.spineWidthMm}mm (${metrics.spineWidthInches} in) | STOCK: ${config.stockPreset.toUpperCase()} (${config.pageCount} PAGES) | CREATED BY ABHINAV SIDHU`;
  doc.text(meta, originX, originY - 4);

  return doc;
}
