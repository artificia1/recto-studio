/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import {
  ProjectState,
  PagePreset,
  CanvasElement,
  Spread,
  PAGE_PRESETS,
  TextElement,
  ImageElement,
  ImageFitMode,
  ShapeElement,
  ParagraphStyle,
  BaselineGridSettings,
  MasterSpread,
  PreflightIssue,
  TextWrapSettings,
  TableElement,
  VersionSnapshot,
  AssetLink,
  Layer,
  DEFAULT_LAYERS,
  Footnote,
  FootnoteSettings,
  CopyfitResult,
  GrepStyleRule,
  CommentPin,
  ObjectStyle,
  CrossReference,
  IndexEntry,
  ConditionTag,
  AnchoredObjectSettings,
} from '../types/index';
import { generateEan13DataUrl } from '../engine/barcodeEngine';
import { generateQrDataUrl } from '../engine/qrEngine';
import { RectoDB } from './persistence';
import { parseIdmlPackage } from '../idmlImport';
import { parseInddToProjectState, isInddBuffer } from '../engine/inddParser';
import { parseCsv, generateMergedSpreads, substituteElementTokens } from '../dataMerge';
import { KnuthPlassComposer, ComposerOptions } from '../engine/knuthPlass';
import { psdEngine } from '../engine/psdParser';
import { assetStore } from '../engine/assetStore';
import { colorEngine, GamutAuditResult, IccProfileName } from '../engine/colorEngine';

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};
const REVERSE_SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

export function numberToSuperscript(num: number): string {
  return String(num).split('').map((d) => SUPERSCRIPTS[d] || d).join('');
}

export function superscriptToNumber(str: string): number {
  const normal = str.split('').map((ch) => REVERSE_SUPERSCRIPTS[ch] || ch).join('');
  const val = parseInt(normal, 10);
  return isNaN(val) ? 1 : val;
}

export interface GrepMatch {
  start: number;
  end: number;
  text: string;
  rule: GrepStyleRule;
}

export interface TocEntry {
  title: string;
  pageNumber: number;
  level: number;
  elementId: string;
}

export interface FindChangeQuery {
  findText: string;
  changeText: string;
  isGrep?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  scope?: 'document' | 'spread' | 'story';
}

export interface FindResult {
  elementId: string;
  spreadIndex: number;
  matchText: string;
  index: number;
  length: number;
  totalMatches: number;
  currentMatchIndex: number;
}

// Local-first persistent storage keys
const STORAGE_KEY = 'recto_project_autosave';
const SNAPSHOTS_STORAGE_KEY = 'recto_version_snapshots';

export const DEFAULT_PARAGRAPH_STYLES: ParagraphStyle[] = [
  {
    id: 'style-title',
    name: 'Title Display',
    fontFamily: 'Playfair Display, Georgia, serif',
    fontSizePt: 48,
    lineHeight: 1.05,
    letterSpacingPt: 2,
    color: '#1a1a1a',
    alignment: 'center',
    snapToBaseline: false,
    dropCapLines: 0,
    pdfTag: 'Title',
  },
  {
    id: 'style-h1',
    name: 'Headline 1',
    fontFamily: 'Playfair Display, Georgia, serif',
    fontSizePt: 28,
    lineHeight: 1.15,
    letterSpacingPt: 0.5,
    color: '#111111',
    alignment: 'left',
    snapToBaseline: true,
    dropCapLines: 0,
    pdfTag: 'H1',
  },
  {
    id: 'style-h2',
    name: 'Header 2',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizePt: 14,
    lineHeight: 1.25,
    letterSpacingPt: 0.5,
    color: '#222222',
    alignment: 'left',
    snapToBaseline: true,
    dropCapLines: 0,
    pdfTag: 'H2',
  },
  {
    id: 'style-body',
    name: 'Body Text',
    fontFamily: 'Merriweather, Georgia, serif',
    fontSizePt: 9.5,
    lineHeight: 1.5,
    letterSpacingPt: 0.1,
    color: '#222222',
    alignment: 'justify',
    snapToBaseline: true,
    dropCapLines: 3,
    opticalMarginAlignment: true,
    openTypeFeatures: { ligatures: true, fractions: true },
    pdfTag: 'P',
    grepStyles: [
      {
        id: 'grep-digits',
        pattern: '\\b[0-9]+(?:\\.[0-9]+)?\\b',
        bold: true,
        color: '#1a1a1a',
      },
    ],
  },
  {
    id: 'style-pullquote',
    name: 'Pullquote',
    fontFamily: 'Playfair Display, Georgia, serif',
    fontSizePt: 18,
    lineHeight: 1.35,
    letterSpacingPt: 0,
    color: '#1a1a1a',
    alignment: 'left',
    snapToBaseline: false,
    dropCapLines: 0,
    opticalMarginAlignment: true,
    pdfTag: 'BlockQuote',
  },
  {
    id: 'style-caption',
    name: 'Caption / Folio',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizePt: 7,
    lineHeight: 1.2,
    letterSpacingPt: 1.5,
    color: '#888888',
    alignment: 'left',
    snapToBaseline: false,
    dropCapLines: 0,
    pdfTag: 'Caption',
  },
];

export const DEFAULT_MASTER_SPREADS: MasterSpread[] = [
  {
    id: 'master-a',
    name: 'A-Master Spread',
    prefix: 'A',
    pages: [
      { id: 'master-a-p1', pageNumber: 1, side: 'left' },
      { id: 'master-a-p2', pageNumber: 2, side: 'right' },
    ],
    elements: [
      {
        id: 'master-a-line-left',
        type: 'shape',
        pageId: 'master-a-p1',
        x: 18,
        y: 12,
        width: 174,
        height: 1,
        rotation: 0,
        opacity: 0.25,
        zIndex: 1,
        locked: true,
        shapeKind: 'line',
        fillColor: '#888888',
        strokeColor: '#888888',
        strokeWidthMm: 0.3,
        strokeDash: 'solid',
      } as ShapeElement,
      {
        id: 'master-a-hdr-left',
        type: 'text',
        pageId: 'master-a-p1',
        x: 18,
        y: 6,
        width: 174,
        height: 6,
        rotation: 0,
        opacity: 0.6,
        zIndex: 2,
        locked: true,
        text: 'RECTO STUDIO · SPECIAL REPORT',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSizePt: 7,
        lineHeight: 1,
        letterSpacingPt: 1.5,
        color: '#666666',
        alignment: 'left',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      } as TextElement,
      {
        id: 'master-a-ftr-left',
        type: 'text',
        pageId: 'master-a-p1',
        x: 18,
        y: 282,
        width: 174,
        height: 8,
        rotation: 0,
        opacity: 0.7,
        zIndex: 2,
        locked: true,
        text: '{{page}}',
        fontFamily: 'Playfair Display, Georgia, serif',
        fontSizePt: 9,
        lineHeight: 1,
        letterSpacingPt: 1,
        color: '#555555',
        alignment: 'left',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      } as TextElement,
      {
        id: 'master-a-line-right',
        type: 'shape',
        pageId: 'master-a-p2',
        x: 18,
        y: 12,
        width: 174,
        height: 1,
        rotation: 0,
        opacity: 0.25,
        zIndex: 1,
        locked: true,
        shapeKind: 'line',
        fillColor: '#888888',
        strokeColor: '#888888',
        strokeWidthMm: 0.3,
        strokeDash: 'solid',
      } as ShapeElement,
      {
        id: 'master-a-hdr-right',
        type: 'text',
        pageId: 'master-a-p2',
        x: 18,
        y: 6,
        width: 174,
        height: 6,
        rotation: 0,
        opacity: 0.6,
        zIndex: 2,
        locked: true,
        text: '{{docTitle}}',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSizePt: 7,
        lineHeight: 1,
        letterSpacingPt: 1.5,
        color: '#666666',
        alignment: 'right',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      } as TextElement,
      {
        id: 'master-a-ftr-right',
        type: 'text',
        pageId: 'master-a-p2',
        x: 18,
        y: 282,
        width: 174,
        height: 8,
        rotation: 0,
        opacity: 0.7,
        zIndex: 2,
        locked: true,
        text: 'Page {{page}} of {{totalPages}}',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSizePt: 8,
        lineHeight: 1,
        letterSpacingPt: 1,
        color: '#666666',
        alignment: 'right',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      } as TextElement,
    ],
  },
];

export const DEFAULT_OBJECT_STYLES: ObjectStyle[] = [
  {
    id: 'obj-none',
    name: '[None]',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidthMm: 0,
    paddingMm: 0,
  },
  {
    id: 'obj-callout',
    name: 'Callout Box',
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
    borderWidthMm: 0.5,
    paddingMm: 4,
    shadow: {
      color: 'rgba(0,0,0,0.08)',
      blurMm: 2,
      offsetX: 1,
      offsetY: 1,
    },
    textWrap: {
      mode: 'boundingBox',
      standoffMm: 3,
    },
  },
  {
    id: 'obj-sidebar',
    name: 'Sidebar Frame',
    backgroundColor: '#fafafa',
    borderColor: '#0d99ff',
    borderWidthMm: 1,
    paddingMm: 5,
    textWrap: {
      mode: 'boundingBox',
      standoffMm: 4,
    },
  },
  {
    id: 'obj-pullquote',
    name: 'Pull Quote Frame',
    backgroundColor: 'transparent',
    borderColor: '#111827',
    borderWidthMm: 1.5,
    paddingMm: 3,
  },
];

export const DEFAULT_CONDITIONS: ConditionTag[] = [
  { id: 'cond-student', name: 'Student Edition', visible: true, colorHex: '#0d99ff' },
  { id: 'cond-teacher', name: 'Teacher Edition', visible: false, colorHex: '#e63946' },
];

export const INITIAL_STATE: ProjectState = {
  settings: {
    title: 'Recto Editorial Spread',
    preset: 'A4',
    widthMm: PAGE_PRESETS['A4'].widthMm,
    heightMm: PAGE_PRESETS['A4'].heightMm,
    facingPages: true,
    bleedMm: 3,
    margins: {
      topMm: 20,
      bottomMm: 20,
      insideMm: 25,
      outsideMm: 18,
    },
    columnCount: 2,
    columnGutterMm: 6,
    baselineGrid: {
      enabled: true,
      incrementPt: 12,
      startMm: 20,
    },
    colorMode: 'cmyk',
    iccProfile: 'FOGRA39',
    footnotes: [],
    footnoteSettings: {
      numberingStyle: 'superscript',
      separatorRuleWidthMm: 30,
      separatorRuleThicknessPt: 0.5,
      fontSizePt: 8,
      scope: 'document',
    },
  },
  spreads: [
    {
      id: 'spread-1',
      spreadIndex: 0,
      pages: [
        { id: 'page-1', pageNumber: 1, side: 'right' },
      ],
      elements: [
        {
          id: 'elem-cover-title',
          type: 'text',
          pageId: 'page-1',
          x: 20,
          y: 60,
          width: 170,
          height: 50,
          rotation: 0,
          opacity: 1,
          zIndex: 10,
          locked: false,
          text: 'RECTO',
          fontFamily: 'Playfair Display, Georgia, serif',
          fontSizePt: 54,
          lineHeight: 1.05,
          letterSpacingPt: 3,
          color: '#1a1a1a',
          alignment: 'center',
          columns: 1,
          columnGutterMm: 5,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 2,
        } as TextElement,
        {
          id: 'elem-cover-sub',
          type: 'text',
          pageId: 'page-1',
          x: 35,
          y: 115,
          width: 140,
          height: 25,
          rotation: 0,
          opacity: 1,
          zIndex: 11,
          locked: false,
          text: 'The Open Source Publishing Revolution\nIssue 01 • October 2026',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSizePt: 12,
          lineHeight: 1.4,
          letterSpacingPt: 1,
          color: '#666666',
          alignment: 'center',
          columns: 1,
          columnGutterMm: 5,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 2,
        } as TextElement,
        {
          id: 'elem-cover-frame',
          type: 'image',
          pageId: 'page-1',
          x: 30,
          y: 145,
          width: 150,
          height: 110,
          rotation: 0,
          opacity: 1,
          zIndex: 5,
          locked: false,
          src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440"><rect width="100%" height="100%" fill="%23242424"/><line x1="0" y1="0" x2="600" y2="440" stroke="%233a3a3a" stroke-width="2"/><line x1="600" y1="0" x2="0" y2="440" stroke="%233a3a3a" stroke-width="2"/><circle cx="300" cy="220" r="80" fill="%231a1a1a" stroke="%230d99ff" stroke-width="3"/><text x="300" y="226" font-family="sans-serif" font-size="16" fill="%23e0e0e0" text-anchor="middle" letter-spacing="2">COVER VISUAL FRAME</text></svg>',
          fitMode: 'fill',
          borderColor: '#cccccc',
          borderWidthMm: 0.5,
          caption: 'Cover Visual Frame (Click to replace with photo)',
          altText: 'Cover visual frame with geometric publisher symbol',
        } as ImageElement,
      ],
    },
    {
      id: 'spread-2',
      spreadIndex: 1,
      masterSpreadId: 'master-a',
      pages: [
        { id: 'page-2', pageNumber: 2, side: 'left' },
        { id: 'page-3', pageNumber: 3, side: 'right' },
      ],
      elements: [
        {
          id: 'elem-header-left',
          type: 'text',
          pageId: 'page-2',
          x: 18,
          y: 10,
          width: 80,
          height: 8,
          rotation: 0,
          opacity: 0.7,
          zIndex: 2,
          locked: false,
          text: 'RECTO JOURNAL • SPECIAL REPORT',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSizePt: 7,
          lineHeight: 1,
          letterSpacingPt: 1.5,
          color: '#888888',
          alignment: 'left',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 1,
        } as TextElement,
        {
          id: 'elem-page-num-2',
          type: 'text',
          pageId: 'page-2',
          x: 18,
          y: 282,
          width: 20,
          height: 8,
          rotation: 0,
          opacity: 0.8,
          zIndex: 2,
          locked: false,
          text: '{{page}}',
          fontFamily: 'Playfair Display, serif',
          fontSizePt: 10,
          lineHeight: 1,
          letterSpacingPt: 0,
          color: '#333333',
          alignment: 'left',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 0,
        } as TextElement,
        {
          id: 'elem-img-left',
          type: 'image',
          pageId: 'page-2',
          x: 18,
          y: 22,
          width: 174,
          height: 180,
          rotation: 0,
          opacity: 1,
          zIndex: 5,
          locked: false,
          src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="696" height="720" viewBox="0 0 696 720"><rect width="100%" height="100%" fill="%231f1f1f"/><circle cx="348" cy="360" r="140" fill="%23141414" stroke="%23d82676" stroke-width="3"/><text x="348" y="365" font-family="Georgia,serif" font-size="18" fill="%23f0f0f0" text-anchor="middle" font-style="italic">Plate 1: The Modern Printing Press</text><line x1="50" y1="50" x2="646" y2="670" stroke="%232c2c2c" stroke-width="1.5"/><line x1="646" y1="50" x2="50" y2="670" stroke="%232c2c2c" stroke-width="1.5"/></svg>',
          fitMode: 'fill',
          borderColor: '#111111',
          borderWidthMm: 0.3,
          caption: 'Plate 1: The Modern Printing Press',
          altText: 'Archival plate illustration depicting the modern printing press in workshop',
        } as ImageElement,
        {
          id: 'elem-pullquote-left',
          type: 'text',
          pageId: 'page-2',
          x: 25,
          y: 212,
          width: 160,
          height: 55,
          rotation: 0,
          opacity: 1,
          zIndex: 6,
          locked: false,
          text: '“Why should the craft of arranging thought upon paper require rent paid to a landlord in San Jose?”',
          fontFamily: 'Playfair Display, Georgia, serif',
          fontSizePt: 19,
          lineHeight: 1.35,
          letterSpacingPt: 0,
          color: '#1a1a1a',
          alignment: 'left',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: '#fafafa',
          borderColor: '#e5e5e5',
          borderWidthMm: 0.5,
          paddingMm: 5,
        } as TextElement,
        {
          id: 'elem-header-right',
          type: 'text',
          pageId: 'page-3',
          x: 110,
          y: 10,
          width: 82,
          height: 8,
          rotation: 0,
          opacity: 0.7,
          zIndex: 2,
          locked: false,
          text: 'THE ESSENTIAL TOOLKIT',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSizePt: 7,
          lineHeight: 1,
          letterSpacingPt: 1.5,
          color: '#888888',
          alignment: 'right',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 1,
        } as TextElement,
        {
          id: 'elem-page-num-3',
          type: 'text',
          pageId: 'page-3',
          x: 172,
          y: 282,
          width: 20,
          height: 8,
          rotation: 0,
          opacity: 0.8,
          zIndex: 2,
          locked: false,
          text: '{{page}}',
          fontFamily: 'Playfair Display, serif',
          fontSizePt: 10,
          lineHeight: 1,
          letterSpacingPt: 0,
          color: '#333333',
          alignment: 'right',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 0,
        } as TextElement,
        {
          id: 'elem-headline-right',
          type: 'text',
          pageId: 'page-3',
          x: 25,
          y: 22,
          width: 167,
          height: 42,
          rotation: 0,
          opacity: 1,
          zIndex: 8,
          locked: false,
          text: 'The Architecture of the Bound Page',
          fontFamily: 'Playfair Display, Georgia, serif',
          fontSizePt: 30,
          lineHeight: 1.15,
          letterSpacingPt: 0.5,
          color: '#111111',
          alignment: 'left',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 1,
        } as TextElement,
        {
          id: 'elem-divider-line',
          type: 'shape',
          pageId: 'page-3',
          x: 25,
          y: 67,
          width: 167,
          height: 1,
          rotation: 0,
          opacity: 1,
          zIndex: 7,
          locked: false,
          shapeKind: 'line',
          fillColor: '#111111',
          strokeColor: '#111111',
          strokeWidthMm: 0.5,
          strokeDash: 'solid',
        } as ShapeElement,
        {
          id: 'elem-body-columns-right',
          type: 'text',
          pageId: 'page-3',
          x: 25,
          y: 72,
          width: 167,
          height: 200,
          rotation: 0,
          opacity: 1,
          zIndex: 9,
          locked: false,
          text: `For three decades, desktop publishing has been held hostage behind monolithic, proprietary walls. When an independent author sits down to set type, or a student editor arranges the columns of an underground gazette, they find themselves confronted by multi-gigabyte suites demanding perpetual tribute.

Yet the mathematical purity of typesetting belongs to no corporate entity. The algorithms formulated by Donald Knuth—the harmonious balance of hyphens, the distribution of glue across a justified line, the relationship between margins and golden proportions—are cultural commons. 

Recto was engineered from a simple conviction: creative freedom must never depend upon the luxury of flagship silicon. Built to execute flawlessly upon a modest dual-core machine, it renders facing pages, magnetic snap grids, and multi-column frames with instantaneous response. Here, the layout artist is restored to sovereignty.`,
          fontFamily: 'Merriweather, Georgia, serif',
          fontSizePt: 9.5,
          lineHeight: 1.5,
          letterSpacingPt: 0.1,
          color: '#222222',
          alignment: 'justify',
          columns: 2,
          columnGutterMm: 6,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 2,
        } as TextElement,
      ],
    },
  ],
  activeSpreadIndex: 1,
  selectedElementId: null,
  selectedElementIds: [],
  activeTool: 'select',
  zoom: 1.0,
  panX: 0,
  panY: 0,
  showGuides: true,
  showBleed: true,
  showBaselineGrid: true,
  snapToGuides: true,
  displayQuality: 'typical',
  paragraphStyles: DEFAULT_PARAGRAPH_STYLES,
  masterSpreads: DEFAULT_MASTER_SPREADS,
  linkingFromFrameId: null,
  layers: DEFAULT_LAYERS,
  activeLayerId: 'layer-1',
  previewMode: false,
  objectStyles: DEFAULT_OBJECT_STYLES,
  crossReferences: [],
  indexEntries: [],
  conditions: DEFAULT_CONDITIONS,
};

export type StateListener = (state: ProjectState) => void;

export class StateManager {
  private state: ProjectState;
  private listeners: Set<StateListener> = new Set();
  private history: ProjectState[] = [];
  private historyIndex: number = -1;
  private snapshots: VersionSnapshot[] = [];
  public onMutation?: (mutation: { type: 'add' | 'update' | 'delete'; elementId: string; element?: CanvasElement; updates?: Partial<CanvasElement> }) => void;

  constructor() {
    this.state = this.loadFromStorage() || INITIAL_STATE;
    this.snapshots = this.loadSnapshotsFromStorage();
    this.renumberPages();

    // Auto-clamp master footers and elements to page boundaries
    const curH = this.state.settings?.heightMm || 297;
    const curW = this.state.settings?.widthMm || 210;
    const btmM = this.state.settings?.margins?.bottomMm || 15;
    const inM = this.state.settings?.margins?.insideMm || 20;
    const outM = this.state.settings?.margins?.outsideMm || 15;

    for (const master of this.state.masterSpreads || []) {
      for (const mEl of master.elements) {
        if (mEl.id.includes('ftr') || mEl.y >= curH - 5) {
          mEl.y = Math.max(10, curH - btmM - (mEl.height || 8) + 2);
          mEl.width = Math.max(40, curW - (inM + outM));
        }
      }
    }
    for (const spread of this.state.spreads || []) {
      for (const el of spread.elements) {
        if (el.y + (el.height || 0) > curH - 2) {
          el.y = Math.max(10, curH - btmM - (el.height || 8) + 2);
        }
      }
    }

    if (!Array.isArray(this.state.selectedElementIds)) {
      this.state.selectedElementIds = this.state.selectedElementId ? [this.state.selectedElementId] : [];
    }
    if (!this.state.settings.baselineGrid) {
      this.state.settings.baselineGrid = {
        enabled: true,
        incrementPt: 12,
        startMm: 20,
      };
    }
    if (this.state.showBaselineGrid === undefined) {
      this.state.showBaselineGrid = true;
    }
    if (!Array.isArray(this.state.paragraphStyles) || this.state.paragraphStyles.length === 0) {
      this.state.paragraphStyles = DEFAULT_PARAGRAPH_STYLES;
    }
    if (!Array.isArray(this.state.masterSpreads) || this.state.masterSpreads.length === 0) {
      this.state.masterSpreads = DEFAULT_MASTER_SPREADS;
    }
    if (this.state.linkingFromFrameId === undefined) {
      this.state.linkingFromFrameId = null;
    }
    if (!Array.isArray(this.state.layers) || this.state.layers.length === 0) {
      this.state.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
    }
    if (!this.state.activeLayerId) {
      this.state.activeLayerId = this.state.layers[0]?.id || 'layer-1';
    }
    if (!Array.isArray(this.state.settings.footnotes)) {
      this.state.settings.footnotes = [];
    }
    if (!this.state.settings.footnoteSettings) {
      this.state.settings.footnoteSettings = {
        numberingStyle: 'superscript',
        separatorRuleWidthMm: 30,
        separatorRuleThicknessPt: 0.5,
        fontSizePt: 8,
        scope: 'document',
      };
    }
    if (!this.state.settings.colorMode) {
      this.state.settings.colorMode = 'cmyk';
    }
    if (!this.state.settings.iccProfile) {
      this.state.settings.iccProfile = 'FOGRA39';
    }
    if (!Array.isArray(this.state.objectStyles) || this.state.objectStyles.length === 0) {
      this.state.objectStyles = JSON.parse(JSON.stringify(DEFAULT_OBJECT_STYLES));
    }
    if (!Array.isArray(this.state.crossReferences)) {
      this.state.crossReferences = [];
    }
    if (!Array.isArray(this.state.indexEntries)) {
      this.state.indexEntries = [];
    }
    if (!Array.isArray(this.state.conditions) || this.state.conditions.length === 0) {
      this.state.conditions = JSON.parse(JSON.stringify(DEFAULT_CONDITIONS));
    }

    // Heal older placeholder image frames if loaded from previous unmigrated local storage cache
    for (const spread of this.state.spreads) {
      for (const el of spread.elements) {
        if (el.type === 'image' && el.id === 'elem-cover-frame') {
          const img = el as ImageElement;
          if (!img.src || img.src.trim() === '') {
            img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440"><rect width="100%" height="100%" fill="%23242424"/><line x1="0" y1="0" x2="600" y2="440" stroke="%233a3a3a" stroke-width="2"/><line x1="600" y1="0" x2="0" y2="440" stroke="%233a3a3a" stroke-width="2"/><circle cx="300" cy="220" r="80" fill="%231a1a1a" stroke="%230d99ff" stroke-width="3"/><text x="300" y="226" font-family="sans-serif" font-size="16" fill="%23e0e0e0" text-anchor="middle" letter-spacing="2">COVER VISUAL FRAME</text></svg>';
          }
          if (!img.altText || !img.altText.trim()) {
            img.altText = 'Cover visual frame with geometric publisher symbol';
          }
        }
      }
    }
    this.pushHistory();
  }

  public getState(): ProjectState {
    if (!this.state.settings.colorMode) {
      this.state.settings.colorMode = 'cmyk';
    }
    if (!this.state.settings.iccProfile) {
      this.state.settings.iccProfile = 'FOGRA39';
    }
    if (!Array.isArray(this.state.objectStyles) || this.state.objectStyles.length === 0) {
      this.state.objectStyles = JSON.parse(JSON.stringify(DEFAULT_OBJECT_STYLES));
    }
    if (!Array.isArray(this.state.crossReferences)) {
      this.state.crossReferences = [];
    }
    if (!Array.isArray(this.state.indexEntries)) {
      this.state.indexEntries = [];
    }
    if (!Array.isArray(this.state.conditions) || this.state.conditions.length === 0) {
      this.state.conditions = JSON.parse(JSON.stringify(DEFAULT_CONDITIONS));
    }
    return this.state;
  }

  public subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.saveToStorage();
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private pushHistory() {
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    this.history.push(JSON.parse(JSON.stringify(this.state)));
    if (this.history.length > 30) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  public undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.state = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
      this.notify();
    }
  }

  public redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.state = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
      this.notify();
    }
  }

  public updateSettings(partial: Partial<ProjectState['settings']>) {
    const prevH = this.state.settings.heightMm;
    const prevW = this.state.settings.widthMm;
    this.state.settings = { ...this.state.settings, ...partial };
    const newH = this.state.settings.heightMm;
    const newW = this.state.settings.widthMm;

    // Dynamically adjust master footer/header positions to fit new page geometry
    if ((newH !== prevH || newW !== prevW) && this.state.masterSpreads) {
      const bottomM = this.state.settings.margins.bottomMm || 15;
      const insideM = this.state.settings.margins.insideMm || 20;
      const outsideM = this.state.settings.margins.outsideMm || 15;
      const printableW = Math.max(40, newW - (insideM + outsideM));

      for (const master of this.state.masterSpreads) {
        for (const mEl of master.elements) {
          if (mEl.id.includes('ftr') || mEl.y >= 200) {
            mEl.y = Math.max(10, newH - bottomM - mEl.height + 2);
            mEl.width = printableW;
          } else if (mEl.id.includes('hdr') || mEl.y <= 20) {
            mEl.width = printableW;
          }
        }
      }

      for (const spread of this.state.spreads) {
        for (const el of spread.elements) {
          if (el.y + (el.height || 0) > newH - 2) {
            el.y = Math.max(10, newH - bottomM - (el.height || 8) + 2);
          }
          if (el.x + (el.width || 0) > newW - 2) {
            el.width = Math.max(20, Math.min(el.width, newW - (insideM + outsideM)));
            el.x = Math.max(insideM, Math.min(el.x, newW - outsideM - el.width));
          }
        }
      }
    }

    this.renumberPages();
    this.pushHistory();
    this.notify();
  }

  public nudgeSelectedElements(dxMm: number, dyMm: number) {
    const ids = this.state.selectedElementIds && this.state.selectedElementIds.length > 0
      ? this.state.selectedElementIds
      : (this.state.selectedElementId ? [this.state.selectedElementId] : []);
    if (ids.length === 0) return;

    const spread = this.getActiveSpread();
    const idSet = new Set(ids);
    let moved = 0;

    for (const el of spread.elements) {
      if (idSet.has(el.id) && !el.locked) {
        el.x = Math.round((el.x + dxMm) * 100) / 100;
        el.y = Math.round((el.y + dyMm) * 100) / 100;
        moved++;
      }
    }

    if (moved > 0) {
      this.pushHistory();
      this.notify();
    }
  }

  public setTool(tool: ProjectState['activeTool']) {
    this.state.activeTool = tool;
    this.notify();
  }

  public setZoom(zoom: number) {
    this.state.zoom = Math.max(0.2, Math.min(3.0, zoom));
    this.notify();
  }

  public setPan(x: number, y: number) {
    this.state.panX = x;
    this.state.panY = y;
    this.notify();
  }

  public setZoomAndPan(zoom: number, panX: number, panY: number) {
    this.state.zoom = Math.max(0.2, Math.min(3.0, zoom));
    this.state.panX = panX;
    this.state.panY = panY;
    this.notify();
  }

  public toggleGuides() {
    this.state.showGuides = !this.state.showGuides;
    this.notify();
  }

  public togglePreviewMode() {
    this.state.previewMode = !this.state.previewMode;
    this.notify();
  }

  public toggleBleed() {
    this.state.showBleed = !this.state.showBleed;
    this.notify();
  }

  public toggleBaselineGrid() {
    this.state.showBaselineGrid = !this.state.showBaselineGrid;
    this.notify();
  }

  public toggleSnapToGuides() {
    this.state.snapToGuides = !this.state.snapToGuides;
    this.notify();
  }

  public toggleReadingOrder() {
    this.state.showReadingOrder = !this.state.showReadingOrder;
    this.notify();
  }

  public toggleSlugBanner() {
    this.state.showSlugBanner = !this.state.showSlugBanner;
    this.notify();
  }

  public setMeasureData(measure: ProjectState['activeMeasure']) {
    this.state.activeMeasure = measure;
    this.notify();
  }

  public addComment(spreadIndex: number, x: number, y: number, text: string, author: string = 'Art Director'): CommentPin {
    if (!this.state.comments) this.state.comments = [];
    const pin: CommentPin = {
      id: `comment-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      spreadIndex,
      x,
      y,
      text,
      author,
      timestamp: Date.now(),
      resolved: false,
    };
    this.state.comments.push(pin);
    this.pushHistory();
    this.notify();
    return pin;
  }

  public resolveComment(commentId: string) {
    if (!this.state.comments) return;
    const pin = this.state.comments.find(c => c.id === commentId);
    if (pin) {
      pin.resolved = !pin.resolved;
      this.pushHistory();
      this.notify();
    }
  }

  public deleteComment(commentId: string) {
    if (!this.state.comments) return;
    this.state.comments = this.state.comments.filter(c => c.id !== commentId);
    this.pushHistory();
    this.notify();
  }

  public addFinishingLayer(type: 'dieline' | 'crease' | 'spot_uv' | 'foil'): Layer {
    const config = {
      dieline: { name: 'Dieline (Cut Contour)', colorHex: '#e6007e' },
      crease: { name: 'Crease (Score Line)', colorHex: '#00b050' },
      spot_uv: { name: 'Spot UV (Varnish)', colorHex: '#00e5ff' },
      foil: { name: 'Hot Foil Stamp (Gold)', colorHex: '#d4af37' },
    }[type] || { name: 'Specialty Finish', colorHex: '#ff00aa' };

    return this.createLayer(config.name, config.colorHex);
  }

  public insertBarcode(rawDigits: string, options: { widthMm?: number; heightMm?: number } = {}) {
    const spread = this.getActiveSpread();
    const page = spread.pages[0];
    const dataUrl = generateEan13DataUrl(rawDigits);
    const w = options.widthMm || 38;
    const h = options.heightMm || 26;
    const barcodeEl: ImageElement = {
      id: `barcode-${Date.now()}`,
      name: `Barcode (${rawDigits})`,
      type: 'image',
      pageId: page.id,
      x: 20,
      y: 20,
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      zIndex: spread.elements.length + 1,
      locked: false,
      src: dataUrl,
      fitMode: 'fit',
      borderColor: 'transparent',
      borderWidthMm: 0,
      altText: `EAN-13 / ISBN Barcode for ${rawDigits}`,
    };
    this.addElement(barcodeEl);
    return barcodeEl;
  }

  public fitFrameToContent(elementId?: string): boolean {
    const targetId = elementId || this.state.selectedElementId;
    if (!targetId) return false;
    const el = this.getElementById(targetId);
    if (!el) return false;

    if (el.type === 'text') {
      const textEl = el as TextElement;
      const textContent = textEl.text || '';
      const padding = textEl.paddingMm ?? 2;
      const cols = Math.max(1, textEl.columns || 1);
      const gutter = textEl.columnGutterMm ?? 4;
      const fontPt = textEl.fontSizePt || 10;
      const lineH = textEl.lineHeight || 1.3;
      const lineSpacingMm = (fontPt * lineH * 25.4) / 72;
      const availW = Math.max(10, (textEl.width - (padding * 2) - ((cols - 1) * gutter)) / cols);
      const avgCharWidthMm = (fontPt * 0.45 * 25.4) / 72;
      const charsPerLine = Math.max(10, Math.floor(availW / avgCharWidthMm));

      const explicitLines = textContent.split('\n');
      let approxRenderedLines = 0;
      for (const line of explicitLines) {
        approxRenderedLines += Math.max(1, Math.ceil(line.length / charsPerLine));
      }
      const requiredTotalLines = Math.max(approxRenderedLines, Math.ceil(textContent.length / (charsPerLine * 1.15)));
      const requiredLinesPerCol = Math.ceil(requiredTotalLines / cols);
      const requiredHeightMm = Math.ceil((requiredLinesPerCol * lineSpacingMm + (padding * 2) + 2) * 10) / 10;
      textEl.height = Math.max(15, requiredHeightMm);
      this.pushHistory();
      this.notify();
      return true;
    }
    return false;
  }

  public setDisplayQuality(quality: ProjectState['displayQuality']) {
    this.state.displayQuality = quality;
    this.notify();
  }

  public setPlateSolo(plate: ProjectState['plateSolo']) {
    this.state.plateSolo = plate;
    this.notify();
  }

  public toggleTacHeatmap() {
    this.state.tacHeatmap = !this.state.tacHeatmap;
    this.notify();
  }

  public setBaselineGrid(partial: Partial<BaselineGridSettings>) {
    this.state.settings.baselineGrid = {
      ...this.state.settings.baselineGrid,
      ...partial,
    };
    this.pushHistory();
    this.notify();
  }

  public createParagraphStyle(style: ParagraphStyle) {
    this.state.paragraphStyles.push(style);
    this.pushHistory();
    this.notify();
  }

  public updateParagraphStyle(id: string, updates: Partial<ParagraphStyle>) {
    const idx = this.state.paragraphStyles.findIndex(s => s.id === id);
    if (idx === -1) return;

    this.state.paragraphStyles[idx] = {
      ...this.state.paragraphStyles[idx],
      ...updates,
    };

    const updatedStyle = this.state.paragraphStyles[idx];
    for (const spread of this.state.spreads) {
      for (const el of spread.elements) {
        if (el.type === 'text' && (el as TextElement).paragraphStyleId === id) {
          const textEl = el as TextElement;
          if (updates.fontFamily !== undefined) textEl.fontFamily = updatedStyle.fontFamily;
          if (updates.fontSizePt !== undefined) textEl.fontSizePt = updatedStyle.fontSizePt;
          if (updates.lineHeight !== undefined) textEl.lineHeight = updatedStyle.lineHeight;
          if (updates.letterSpacingPt !== undefined) textEl.letterSpacingPt = updatedStyle.letterSpacingPt;
          if (updates.color !== undefined) textEl.color = updatedStyle.color;
          if (updates.alignment !== undefined) textEl.alignment = updatedStyle.alignment;
          if (updates.snapToBaseline !== undefined) textEl.snapToBaseline = updatedStyle.snapToBaseline;
          if (updates.dropCapLines !== undefined) textEl.dropCapLines = updatedStyle.dropCapLines;
          if (updates.opticalMarginAlignment !== undefined) textEl.opticalMarginAlignment = updatedStyle.opticalMarginAlignment;
          if (updates.openTypeFeatures !== undefined) textEl.openTypeFeatures = updatedStyle.openTypeFeatures ? { ...updatedStyle.openTypeFeatures } : undefined;
        }
      }
    }

    this.pushHistory();
    this.notify();
  }

  public deleteParagraphStyle(id: string) {
    this.state.paragraphStyles = this.state.paragraphStyles.filter(s => s.id !== id);
    for (const spread of this.state.spreads) {
      for (const el of spread.elements) {
        if (el.type === 'text' && (el as TextElement).paragraphStyleId === id) {
          (el as TextElement).paragraphStyleId = undefined;
        }
      }
    }
    this.pushHistory();
    this.notify();
  }

  public applyParagraphStyle(elementId: string, styleId: string) {
    const style = this.state.paragraphStyles.find(s => s.id === styleId);
    if (!style) return;

    const spread = this.getActiveSpread();
    const el = spread.elements.find(e => e.id === elementId);
    if (!el || el.type !== 'text') return;

    const textEl = el as TextElement;
    textEl.paragraphStyleId = styleId;
    textEl.fontFamily = style.fontFamily;
    textEl.fontSizePt = style.fontSizePt;
    textEl.lineHeight = style.lineHeight;
    textEl.letterSpacingPt = style.letterSpacingPt;
    textEl.color = style.color;
    textEl.alignment = style.alignment;
    textEl.snapToBaseline = style.snapToBaseline;
    textEl.dropCapLines = style.dropCapLines;
    textEl.opticalMarginAlignment = style.opticalMarginAlignment;
    textEl.openTypeFeatures = style.openTypeFeatures ? { ...style.openTypeFeatures } : undefined;

    this.pushHistory();
    this.notify();
  }

  public selectElement(id: string | null) {
    this.state.selectedElementId = id;
    this.state.selectedElementIds = id ? [id] : [];
    this.notify();
  }

  public selectElements(ids: string[]) {
    this.state.selectedElementIds = [...ids];
    this.state.selectedElementId = ids.length > 0 ? ids[0] : null;
    this.notify();
  }

  public toggleElementSelection(id: string) {
    const exists = this.state.selectedElementIds.includes(id);
    if (exists) {
      this.state.selectedElementIds = this.state.selectedElementIds.filter(item => item !== id);
    } else {
      this.state.selectedElementIds = [...this.state.selectedElementIds, id];
    }
    this.state.selectedElementId = this.state.selectedElementIds.length > 0 ? this.state.selectedElementIds[0] : null;
    this.notify();
  }

  public getActiveSpread(): Spread {
    return this.state.spreads[this.state.activeSpreadIndex] || this.state.spreads[0];
  }

  public setActiveSpread(index: number) {
    if (index >= 0 && index < this.state.spreads.length) {
      this.state.activeSpreadIndex = index;
      this.state.selectedElementId = null;
      this.state.selectedElementIds = [];
      this.notify();
    }
  }

  public addElement(element: CanvasElement) {
    if (!element.layerId) {
      element.layerId = this.state.activeLayerId || 'layer-1';
    }
    const spread = this.getActiveSpread();
    spread.elements.push(element);
    this.state.selectedElementId = element.id;
    this.state.selectedElementIds = [element.id];
    this.pushHistory();
    this.notify();
    this.onMutation?.({ type: 'add', elementId: element.id, element });
  }

  public commitHistory() {
    this.pushHistory();
  }

  public updateElement(id: string, updates: Partial<CanvasElement>, recordHistory: boolean = true) {
    const spread = this.getActiveSpread();
    const idx = spread.elements.findIndex(el => el.id === id);
    if (idx !== -1) {
      if (spread.elements[idx].locked && updates.locked === undefined) return;
      spread.elements[idx] = { ...spread.elements[idx], ...updates } as CanvasElement;
      const el = spread.elements[idx];
      if (el.type === 'text') {
        const textEl = el as TextElement;
        const textUpdates = updates as Partial<TextElement>;
        if (textUpdates.text !== undefined && !textEl.prevFrameId) {
          textEl.rawStoryText = textEl.text;
        }
        if (textEl.nextFrameId || textEl.prevFrameId) {
          this.reflowStory(id);
        }
        this.updateAnchoredPositions(id);
      }
      if (recordHistory) {
        this.pushHistory();
      }
      this.notify();
      this.onMutation?.({ type: 'update', elementId: id, updates });
    }
  }

  public updateElements(updates: { id: string; partial: Partial<CanvasElement> }[], recordHistory: boolean = true) {
    const spread = this.getActiveSpread();
    let changed = false;
    for (const { id, partial } of updates) {
      const idx = spread.elements.findIndex(el => el.id === id);
      if (idx !== -1) {
        if (spread.elements[idx].locked && partial.locked === undefined) continue;
        spread.elements[idx] = { ...spread.elements[idx], ...partial } as CanvasElement;
        const el = spread.elements[idx];
        if (el.type === 'text') {
          const textEl = el as TextElement;
          const textPartial = partial as Partial<TextElement>;
          if (textPartial.text !== undefined && !textEl.prevFrameId) {
            textEl.rawStoryText = textEl.text;
          }
          if (textEl.nextFrameId || textEl.prevFrameId) {
            this.reflowStory(id);
          }
        }
        changed = true;
        this.onMutation?.({ type: 'update', elementId: id, updates: partial });
      }
    }
    if (changed) {
      if (recordHistory) {
        this.pushHistory();
      }
      this.notify();
    }
  }

  private imageAspectRatios: Map<string, number> = new Map();

  public registerImageAspectRatio(src: string, width: number, height: number): void {
    if (src && width > 0 && height > 0) {
      this.imageAspectRatios.set(src, width / height);
    }
  }

  public getImageAspectRatio(src: string): number | null {
    if (!src) return null;
    if (this.imageAspectRatios.has(src)) {
      return this.imageAspectRatios.get(src)!;
    }
    if (typeof Image !== 'undefined') {
      try {
        const img = new Image();
        img.src = src;
        if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const aspect = img.naturalWidth / img.naturalHeight;
          this.imageAspectRatios.set(src, aspect);
          return aspect;
        }
      } catch (e) {
        // ignore in non-browser env
      }
    }
    return null;
  }

  public applyImageFitMode(mode: ImageFitMode, elementId?: string): boolean {
    const targetId = elementId || this.state.selectedElementId;
    if (!targetId) return false;

    const spread = this.getActiveSpread();
    const el = spread.elements.find((e) => e.id === targetId);
    if (!el || el.type !== 'image') return false;

    const imgEl = el as ImageElement;

    if (mode === 'frameToContent') {
      const aspect = this.getImageAspectRatio(imgEl.src);
      if (aspect && aspect > 0) {
        const newHeight = Math.round((imgEl.width / aspect) * 10) / 10;
        this.updateElement(targetId, {
          height: newHeight,
          fitMode: 'frameToContent',
        });
        return true;
      }
      this.updateElement(targetId, { fitMode: 'frameToContent' });
      return true;
    }

    this.updateElement(targetId, { fitMode: mode });
    return true;
  }

  private imageDimensionsCache: Map<string, { width: number; height: number; sizeBytes?: number; format?: string; name?: string }> = new Map();

  public registerImageDimensions(
    src: string,
    width: number,
    height: number,
    sizeBytes?: number,
    format?: string,
    name?: string
  ): void {
    if (!src || width <= 0 || height <= 0) return;
    const existing = this.imageDimensionsCache.get(src);
    if (existing && existing.width === width && existing.height === height) return;
    this.registerImageAspectRatio(src, width, height);
    this.imageDimensionsCache.set(src, {
      width,
      height,
      sizeBytes,
      format,
      name,
    });
  }

  public getImageDimensions(src: string): { width: number; height: number; sizeBytes?: number; format?: string; name?: string } | null {
    if (!src) return null;
    if (this.imageDimensionsCache.has(src)) {
      return this.imageDimensionsCache.get(src)!;
    }
    if (typeof Image !== 'undefined') {
      try {
        const img = new Image();
        img.src = src;
        if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const dims = { width: img.naturalWidth, height: img.naturalHeight };
          this.imageDimensionsCache.set(src, dims);
          this.registerImageAspectRatio(src, dims.width, dims.height);
          return dims;
        }
      } catch (e) {
        // ignore in non-browser env
      }
    }
    return null;
  }

  public getAssetLinks(): AssetLink[] {
    const links: AssetLink[] = [];
    const formatBytes = (bytes: number) => {
      if (!bytes || bytes <= 0) return '0 KB';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    this.state.spreads.forEach((spread, spreadIdx) => {
      spread.elements.forEach((el) => {
        if (el.type === 'image') {
          const img = el as ImageElement;
          const cached = this.getImageDimensions(img.src);
          const pixelW = img.originalWidth || cached?.width || 800;
          const pixelH = img.originalHeight || cached?.height || 600;

          const widthInches = Math.max(0.1, img.width / 25.4);
          const heightInches = Math.max(0.1, img.height / 25.4);
          const effectiveDpi = Math.round(pixelW / widthInches);
          const effectiveDpiY = Math.round(pixelH / heightInches);
          const isLowRes = effectiveDpi < 250;

          let format = img.format || cached?.format || 'JPG';
          if (img.src) {
            if (img.src.includes('image/png') || img.src.toLowerCase().endsWith('.png')) format = 'PNG';
            else if (img.src.includes('image/svg') || img.src.toLowerCase().endsWith('.svg')) format = 'SVG';
            else if (img.src.includes('image/webp') || img.src.toLowerCase().endsWith('.webp')) format = 'WEBP';
            else if (img.src.includes('image/jpeg') || img.src.toLowerCase().endsWith('.jpg') || img.src.toLowerCase().endsWith('.jpeg')) format = 'JPG';
          }

          let sizeBytes = img.fileSize || cached?.sizeBytes || 0;
          if (!sizeBytes && img.src && img.src.startsWith('data:')) {
            const b64 = img.src.split(',')[1];
            if (b64) sizeBytes = Math.round((b64.length * 3) / 4);
          }

          let name = img.name || img.caption || cached?.name || '';
          if (!name && img.src) {
            if (img.src.startsWith('data:')) {
              name = `Asset_${img.id.slice(-6)}.${format.toLowerCase()}`;
            } else {
              const parts = img.src.split('/');
              name = parts[parts.length - 1].split('?')[0] || `Asset_${img.id.slice(-6)}`;
            }
          }
          if (!name) name = `Asset_${img.id.slice(-6)}.${format.toLowerCase()}`;

          const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === img.pageId));
          const pageNumber = spread.pages[pageIdx]?.pageNumber ?? (spreadIdx * 2 + 1);

          links.push({
            id: img.id,
            elementId: img.id,
            name,
            src: img.src,
            format: format.toUpperCase(),
            sizeBytes,
            sizeFormatted: formatBytes(sizeBytes),
            pixelWidth: pixelW,
            pixelHeight: pixelH,
            actualDpi: img.actualDpi || 72,
            effectiveDpi,
            effectiveDpiY,
            isLowRes,
            spreadIndex: spreadIdx,
            spreadNumber: spreadIdx + 1,
            pageNumber,
            widthMm: img.width,
            heightMm: img.height,
            status: !img.src ? 'missing' : (isLowRes ? 'warning' : 'ok'),
          });
        }
      });
    });

    return links;
  }

  public relinkAsset(
    elementId: string,
    newSrc: string,
    metadata?: { name?: string; fileSize?: number; format?: string; width?: number; height?: number }
  ): boolean {
    for (let sIdx = 0; sIdx < this.state.spreads.length; sIdx++) {
      const spread = this.state.spreads[sIdx];
      const elIdx = spread.elements.findIndex((e) => e.id === elementId);
      if (elIdx !== -1 && spread.elements[elIdx].type === 'image') {
        const updates: Partial<ImageElement> = {
          src: newSrc,
          ...(metadata?.name ? { name: metadata.name, caption: metadata.name } : {}),
          ...(metadata?.fileSize ? { fileSize: metadata.fileSize } : {}),
          ...(metadata?.format ? { format: metadata.format } : {}),
          ...(metadata?.width ? { originalWidth: metadata.width } : {}),
          ...(metadata?.height ? { originalHeight: metadata.height } : {}),
        };

        if (metadata?.width && metadata?.height) {
          this.registerImageDimensions(
            newSrc,
            metadata.width,
            metadata.height,
            metadata.fileSize,
            metadata.format,
            metadata.name
          );
        }

        spread.elements[elIdx] = { ...spread.elements[elIdx], ...updates } as ImageElement;
        this.pushHistory();
        this.notify();
        this.onMutation?.({ type: 'update', elementId, updates });
        return true;
      }
    }
    return false;
  }

  public zoomToElement(elementId: string): boolean {
    for (let sIdx = 0; sIdx < this.state.spreads.length; sIdx++) {
      const spread = this.state.spreads[sIdx];
      const el = spread.elements.find((e) => e.id === elementId);
      if (el) {
        this.setActiveSpread(sIdx);
        this.selectElement(elementId);
        return true;
      }
    }
    return false;
  }

  public deleteElement(id: string) {
    const spread = this.getActiveSpread();
    const el = spread.elements.find(item => item.id === id);
    if (!el || el.locked) return;

    if (el.type === 'text') {
      this.unlinkTextFrame(id, true, false);
    } else if (el.type === 'table') {
      this.unlinkTableFrame(id, true, false);
    }

    spread.elements = spread.elements.filter(item => item.id !== id);
    this.state.selectedElementIds = this.state.selectedElementIds.filter(item => item !== id);
    if (this.state.selectedElementId === id) {
      this.state.selectedElementId = this.state.selectedElementIds[0] || null;
    }
    this.pushHistory();
    this.notify();
    this.onMutation?.({ type: 'delete', elementId: id });
  }

  public duplicateElement(id: string): string | undefined {
    const spread = this.getActiveSpread();
    const el = spread.elements.find(item => item.id === id);
    if (!el) return undefined;
    const cloned: CanvasElement = JSON.parse(JSON.stringify(el));
    cloned.id = `elem-dup-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    cloned.x = Math.round((cloned.x + 8) * 10) / 10;
    cloned.y = Math.round((cloned.y + 8) * 10) / 10;
    cloned.locked = false;
    if (cloned.type === 'text') {
      const textCloned = cloned as TextElement;
      delete textCloned.prevFrameId;
      delete textCloned.nextFrameId;
    } else if (cloned.type === 'table') {
      const tableCloned = cloned as TableElement;
      delete tableCloned.prevFrameId;
      delete tableCloned.nextFrameId;
    }
    this.addElement(cloned);
    return cloned.id;
  }

  public findElementById(id: string): { element: CanvasElement; spread: Spread } | null {
    for (const sp of this.state.spreads) {
      const el = sp.elements.find(e => e.id === id);
      if (el) return { element: el, spread: sp };
    }
    return null;
  }

  public estimateFrameLineCapacity(textEl: TextElement): number {
    const paddingMm = textEl.paddingMm || 2;
    const availHeightMm = Math.max(10, textEl.height - (paddingMm * 2));
    const fontSizeMm = (textEl.fontSizePt * 25.4) / 72;
    const lineSpacingMm = fontSizeMm * (textEl.lineHeight || 1.3);
    const linesPerCol = Math.max(1, Math.floor(availHeightMm / lineSpacingMm));
    const colCount = Math.max(1, textEl.columns || 1);
    return linesPerCol * colCount;
  }

  public estimateCharsPerLine(textEl: TextElement): number {
    const paddingMm = textEl.paddingMm || 2;
    const availWidthMm = Math.max(10, textEl.width - (paddingMm * 2));
    const colCount = Math.max(1, textEl.columns || 1);
    const gutterMm = textEl.columnGutterMm || 4;
    const singleColWidthMm = Math.max(10, (availWidthMm - (gutterMm * (colCount - 1))) / colCount);
    const avgCharWidthMm = Math.max(1.2, (textEl.fontSizePt * 25.4 / 72) * 0.5);
    return Math.max(15, Math.floor(singleColWidthMm / avgCharWidthMm));
  }

  public reflowStory(frameId: string) {
    // 1. Traverse backward to find head frame
    let headId = frameId;
    const visitedBack = new Set<string>();
    while (headId && !visitedBack.has(headId)) {
      visitedBack.add(headId);
      const found = this.findElementById(headId);
      if (!found || found.element.type !== 'text') break;
      const textEl = found.element as TextElement;
      if (textEl.prevFrameId) {
        headId = textEl.prevFrameId;
      } else {
        break;
      }
    }

    // 2. Collect all frames in the chain in order
    const chain: TextElement[] = [];
    let currId: string | undefined = headId;
    const visitedFwd = new Set<string>();
    while (currId && !visitedFwd.has(currId)) {
      visitedFwd.add(currId);
      const found = this.findElementById(currId);
      if (!found || found.element.type !== 'text') break;
      const textEl = found.element as TextElement;
      chain.push(textEl);
      currId = textEl.nextFrameId;
    }

    if (chain.length === 0) return;

    // 3. Obtain full story manuscript
    const headFrame = chain[0];
    if (!headFrame.rawStoryText) {
      headFrame.rawStoryText = chain.map(f => f.text).join('\n\n').trim();
    }
    const fullStory = headFrame.rawStoryText;

    if (chain.length === 1) {
      headFrame.text = fullStory;
      return;
    }

    // 4. Distribute text across chain based on geometric capacities
    const words = fullStory.split(/\s+/).filter(Boolean);
    let wordIdx = 0;

    for (let i = 0; i < chain.length; i++) {
      const frame = chain[i];
      if (wordIdx >= words.length) {
        frame.text = '';
        continue;
      }

      const isLastFrame = (i === chain.length - 1);
      if (isLastFrame) {
        frame.text = words.slice(wordIdx).join(' ');
        wordIdx = words.length;
      } else {
        const lineCapacity = this.estimateFrameLineCapacity(frame);
        const charsPerLine = this.estimateCharsPerLine(frame);
        const wordsPerLine = Math.max(3, Math.floor(charsPerLine / 5.5));
        const frameWordCapacity = Math.max(5, lineCapacity * wordsPerLine);

        const frameWords = words.slice(wordIdx, wordIdx + frameWordCapacity);
        frame.text = frameWords.join(' ');
        wordIdx += frameWordCapacity;
      }
    }
  }

  public linkTextFrames(sourceId: string, targetId: string): boolean {
    if (sourceId === targetId) return false;
    const sourceFound = this.findElementById(sourceId);
    const targetFound = this.findElementById(targetId);
    if (!sourceFound || !targetFound) return false;
    if (sourceFound.element.type !== 'text' || targetFound.element.type !== 'text') return false;

    const source = sourceFound.element as TextElement;
    const target = targetFound.element as TextElement;

    // Target cannot already have another predecessor
    if (target.prevFrameId && target.prevFrameId !== sourceId) return false;

    // Cycle detection: follow target's nextFrameId chain to ensure it never loops to source
    let testId: string | undefined = targetId;
    const visited = new Set<string>();
    while (testId) {
      if (testId === sourceId) return false; // Cycle detected and blocked
      if (visited.has(testId)) break;
      visited.add(testId);
      const el = this.findElementById(testId)?.element as TextElement | undefined;
      testId = el?.nextFrameId;
    }

    // If source was linked elsewhere, unlink old target's prevFrameId
    if (source.nextFrameId && source.nextFrameId !== targetId) {
      const oldTarget = this.findElementById(source.nextFrameId)?.element as TextElement | undefined;
      if (oldTarget) oldTarget.prevFrameId = undefined;
    }

    const storyId = source.storyId || target.storyId || `story-${Date.now()}`;
    source.nextFrameId = targetId;
    source.storyId = storyId;
    target.prevFrameId = sourceId;
    target.storyId = storyId;

    if (!source.rawStoryText) {
      source.rawStoryText = source.text;
    }

    this.reflowStory(sourceId);
    this.state.linkingFromFrameId = null;
    this.pushHistory();
    this.notify();
    return true;
  }

  public unlinkTextFrame(frameId: string, restitch: boolean = false, recordHistory: boolean = true) {
    const found = this.findElementById(frameId);
    if (!found || found.element.type !== 'text') return;
    const frame = found.element as TextElement;

    const prev = frame.prevFrameId ? (this.findElementById(frame.prevFrameId)?.element as TextElement | undefined) : undefined;
    const next = frame.nextFrameId ? (this.findElementById(frame.nextFrameId)?.element as TextElement | undefined) : undefined;

    if (restitch && prev && next) {
      prev.nextFrameId = next.id;
      next.prevFrameId = prev.id;
      frame.prevFrameId = undefined;
      frame.nextFrameId = undefined;
      this.reflowStory(prev.id);
    } else {
      if (prev) {
        prev.nextFrameId = undefined;
        this.reflowStory(prev.id);
      }
      if (next) {
        next.prevFrameId = undefined;
      }
      frame.prevFrameId = undefined;
      frame.nextFrameId = undefined;
    }

    this.state.linkingFromFrameId = null;
    if (recordHistory) {
      this.pushHistory();
      this.notify();
    }
  }

  /**
   * Links two table frames across pages for dynamic overflow row threading.
   */
  public linkTableFrames(sourceFrameId: string, targetFrameId: string): boolean {
    const source = this.getElementById(sourceFrameId);
    const target = this.getElementById(targetFrameId);
    if (!source || !target || source.type !== 'table' || target.type !== 'table') return false;

    const srcTable = source as TableElement;
    const tgtTable = target as TableElement;

    srcTable.nextFrameId = tgtTable.id;
    tgtTable.prevFrameId = srcTable.id;

    if (srcTable.cells && (!tgtTable.cells || tgtTable.cells.length === 0)) {
      tgtTable.cells = srcTable.cells;
      tgtTable.rows = srcTable.rows;
      tgtTable.cols = srcTable.cols;
      tgtTable.headerRowCount = srcTable.headerRowCount;
      tgtTable.headerFillColor = srcTable.headerFillColor;
      tgtTable.headerTextColor = srcTable.headerTextColor;
      tgtTable.repeatHeaderOnOverflow = srcTable.repeatHeaderOnOverflow !== false;
    }

    this.pushHistory();
    this.notify();
    return true;
  }

  /**
   * Unlinks a table frame from its thread chain.
   */
  public unlinkTableFrame(frameId: string, restitch: boolean = false, recordHistory: boolean = true): boolean {
    const el = this.getElementById(frameId);
    if (!el || el.type !== 'table') return false;
    const table = el as TableElement;

    const prev = table.prevFrameId ? (this.getElementById(table.prevFrameId) as TableElement | undefined) : undefined;
    const next = table.nextFrameId ? (this.getElementById(table.nextFrameId) as TableElement | undefined) : undefined;

    if (restitch && prev && next) {
      prev.nextFrameId = next.id;
      next.prevFrameId = prev.id;
    } else {
      if (prev) prev.nextFrameId = undefined;
      if (next) next.prevFrameId = undefined;
    }

    table.prevFrameId = undefined;
    table.nextFrameId = undefined;
    if (recordHistory) {
      this.pushHistory();
      this.notify();
    }
    return true;
  }

  public setLinkingFromFrame(frameId: string | null) {
    this.state.linkingFromFrameId = frameId;
    this.notify();
  }

  public createMasterSpread(name: string, prefix: string): MasterSpread {
    const id = `master-${Date.now()}`;
    const newMaster: MasterSpread = {
      id,
      name,
      prefix,
      pages: [
        { id: `master-p-${Date.now()}-1`, pageNumber: 1, side: 'left' },
        { id: `master-p-${Date.now()}-2`, pageNumber: 2, side: 'right' },
      ],
      elements: [
        {
          id: `master-hdr-${Date.now()}`,
          type: 'text',
          pageId: `master-p-${Date.now()}-1`,
          x: 18,
          y: 6,
          width: 174,
          height: 6,
          rotation: 0,
          opacity: 0.6,
          zIndex: 1,
          locked: true,
          text: `${name.toUpperCase()} · {{docTitle}}`,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSizePt: 7,
          lineHeight: 1,
          letterSpacingPt: 1.5,
          color: '#666666',
          alignment: 'left',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 0,
        } as TextElement,
        {
          id: `master-ftr-${Date.now()}`,
          type: 'text',
          pageId: `master-p-${Date.now()}-2`,
          x: 18,
          y: 282,
          width: 174,
          height: 8,
          rotation: 0,
          opacity: 0.7,
          zIndex: 1,
          locked: true,
          text: 'Page {{page}} of {{totalPages}}',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSizePt: 8,
          lineHeight: 1,
          letterSpacingPt: 1,
          color: '#666666',
          alignment: 'right',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 0,
        } as TextElement,
      ],
    };
    this.state.masterSpreads.push(newMaster);
    this.pushHistory();
    this.notify();
    return newMaster;
  }

  public deleteMasterSpread(masterSpreadId: string): boolean {
    if (!this.state.masterSpreads || this.state.masterSpreads.length <= 1) {
      return false;
    }
    const idx = this.state.masterSpreads.findIndex((m) => m.id === masterSpreadId);
    if (idx === -1) return false;

    this.state.masterSpreads.splice(idx, 1);
    for (const spread of this.state.spreads) {
      if (spread.masterSpreadId === masterSpreadId) {
        spread.masterSpreadId = null;
      }
    }
    this.pushHistory();
    this.notify();
    return true;
  }

  public assignMasterSpread(spreadIndex: number, masterSpreadId: string | null) {
    if (spreadIndex < 0 || spreadIndex >= this.state.spreads.length) return;
    this.state.spreads[spreadIndex].masterSpreadId = masterSpreadId;
    this.pushHistory();
    this.notify();
  }

  /**
   * Overrides and detaches a Master Page item for the target spread.
   * Clones the master element into the spread's local element tree, unlocked and editable.
   */
  public overrideMasterElement(spreadId: string, masterElementId: string): CanvasElement | null {
    const spread = this.state.spreads.find((s) => s.id === spreadId) || this.getActiveSpread();
    if (!spread || !spread.masterSpreadId) return null;

    const master = (this.state.masterSpreads || []).find((m) => m.id === spread.masterSpreadId);
    if (!master) return null;

    const mEl = master.elements.find((e) => e.id === masterElementId);
    if (!mEl) return null;

    const masterPage = master.pages.find((p) => p.id === mEl.pageId);
    let targetPage = spread.pages.find((p) => masterPage && p.side === masterPage.side);
    if (!targetPage) targetPage = spread.pages[0];
    if (!targetPage) return null;

    // Return existing clone if already overridden
    const existing = spread.elements.find((e) => e.masterSourceId === mEl.id && e.pageId === targetPage.id);
    if (existing) {
      this.selectElements([existing.id]);
      return existing;
    }

    if (!spread.detachedMasterElementIds) {
      spread.detachedMasterElementIds = [];
    }
    if (!spread.detachedMasterElementIds.includes(mEl.id)) {
      spread.detachedMasterElementIds.push(mEl.id);
    }

    // Clone element
    const cloned: CanvasElement = {
      ...JSON.parse(JSON.stringify(mEl)),
      id: `override-${mEl.id}-${Date.now()}`,
      pageId: targetPage.id,
      masterSourceId: mEl.id,
      isOverridden: true,
      locked: false,
    };

    if (cloned.type === 'text') {
      cloned.text = this.evaluateTokens(cloned.text, targetPage.pageNumber);
    }

    spread.elements.push(cloned);
    this.selectElements([cloned.id]);
    this.pushHistory();
    this.notify();
    return cloned;
  }

  /**
   * Restores an overridden master element back to inheriting directly from the Master Spread.
   */
  public restoreMasterElement(spreadId: string, masterElementId: string): boolean {
    const spread = this.state.spreads.find((s) => s.id === spreadId) || this.getActiveSpread();
    if (!spread) return false;

    if (spread.detachedMasterElementIds) {
      spread.detachedMasterElementIds = spread.detachedMasterElementIds.filter((id) => id !== masterElementId);
    }

    spread.elements = spread.elements.filter((e) => e.masterSourceId !== masterElementId);
    this.pushHistory();
    this.notify();
    return true;
  }

  /**
   * Checks if a master item is currently overridden or detached on a spread.
   */
  public isMasterElementOverridden(spreadId: string, masterElementId: string): boolean {
    const spread = this.state.spreads.find((s) => s.id === spreadId) || this.getActiveSpread();
    if (!spread) return false;
    if (spread.detachedMasterElementIds?.includes(masterElementId)) return true;
    return spread.elements.some((e) => e.masterSourceId === masterElementId);
  }

  /**
   * Registers an image asset and generates a 72 DPI screen proxy.
   */
  public async registerImageAsset(elementId: string, data: ArrayBuffer | string, name?: string): Promise<boolean> {
    const el = this.getElementById(elementId);
    if (!el || el.type !== 'image') return false;
    const meta = await assetStore.registerAsset(data, { name });
    const img = el as ImageElement;
    img.assetId = meta.id;
    img.proxySrc = meta.proxyDataUrl;
    img.name = meta.name;
    img.originalWidth = meta.width;
    img.originalHeight = meta.height;
    this.pushHistory();
    this.notify();
    return true;
  }

  public evaluateTokens(text: string, pageNum: number): string {
    let totalPages = 0;
    for (const sp of this.state.spreads) {
      totalPages += sp.pages.length;
    }

    // Resolve chapterTitle / sectionTitle by locating the most recent Heading 1 on or prior to pageNum
    let chapterTitle = '';
    for (const spread of this.state.spreads) {
      const pageMatch = spread.pages.some((p) => p.pageNumber === pageNum);
      for (const el of spread.elements) {
        if (el.type === 'text') {
          const txt = el as TextElement;
          const style = this.state.paragraphStyles.find((s) => s.id === txt.paragraphStyleId);
          const isH1 = txt.paragraphStyleId === 'style-h1' || (style && /head(ing|line)\s*1/i.test(style.name));
          if (isH1 && txt.text.trim()) {
            chapterTitle = txt.text.split('\n')[0].trim();
          }
        }
      }
      if (pageMatch) break;
    }
    if (!chapterTitle) {
      chapterTitle = this.state.settings.title;
    }
    return text
      .replace(/\{\{page\}\}/gi, String(pageNum))
      .replace(/\{\{totalPages\}\}/gi, String(Math.max(1, totalPages)))
      .replace(/\{\{docTitle\}\}/gi, this.state.settings.title)
      .replace(/\{\{chapterTitle\}\}/gi, chapterTitle)
      .replace(/\{\{sectionTitle\}\}/gi, chapterTitle);
  }

  public deleteSelectedElements() {
    const spread = this.getActiveSpread();
    const lockedIds = new Set(spread.elements.filter(el => el.locked).map(el => el.id));
    const idsToDelete = this.state.selectedElementIds.filter(id => !lockedIds.has(id));
    if (idsToDelete.length === 0) return;

    for (const id of idsToDelete) {
      const el = spread.elements.find(e => e.id === id);
      if (el?.type === 'text') {
        this.unlinkTextFrame(id, true, false);
      } else if (el?.type === 'table') {
        this.unlinkTableFrame(id, true, false);
      }
    }

    const deleteSet = new Set(idsToDelete);
    spread.elements = spread.elements.filter(el => !deleteSet.has(el.id));
    this.state.selectedElementIds = this.state.selectedElementIds.filter(id => !deleteSet.has(id));
    this.state.selectedElementId = this.state.selectedElementIds[0] || null;
    this.pushHistory();
    this.notify();
  }

  public toggleLock(ids?: string[]) {
    const targetIds = ids || this.state.selectedElementIds;
    if (targetIds.length === 0) return;
    const spread = this.getActiveSpread();
    const targetSet = new Set(targetIds);
    const targetElements = spread.elements.filter(el => targetSet.has(el.id));
    if (targetElements.length === 0) return;

    const allLocked = targetElements.every(el => el.locked);
    const nextLocked = !allLocked;
    targetElements.forEach(el => {
      el.locked = nextLocked;
    });
    this.pushHistory();
    this.notify();
  }

  public toggleEditorialLock(ids?: string[]) {
    const targetIds = ids || this.state.selectedElementIds;
    if (targetIds.length === 0) return;
    const spread = this.getActiveSpread();
    const targetSet = new Set(targetIds);
    const targetElements = spread.elements.filter(el => targetSet.has(el.id));
    if (targetElements.length === 0) return;

    const allEditorial = targetElements.every(el => el.editorialOnly);
    const nextEditorial = !allEditorial;
    targetElements.forEach(el => {
      el.editorialOnly = nextEditorial;
    });
    this.pushHistory();
    this.notify();
  }

  public alignElements(direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const spread = this.getActiveSpread();
    const selectedElements = spread.elements.filter(el => this.state.selectedElementIds.includes(el.id) && !el.locked && !el.editorialOnly);
    if (selectedElements.length < 2) return;

    const pageWidthMm = this.state.settings.widthMm;
    const elementMeta = selectedElements.map(el => {
      const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
      const globalX = pageIdx * pageWidthMm + el.x;
      const globalY = el.y;
      return { el, pageIdx, globalX, globalY };
    });

    if (direction === 'left') {
      const minX = Math.min(...elementMeta.map(m => m.globalX));
      elementMeta.forEach(m => {
        m.el.x = Math.round((minX - m.pageIdx * pageWidthMm) * 10) / 10;
      });
    } else if (direction === 'center') {
      const minX = Math.min(...elementMeta.map(m => m.globalX));
      const maxX = Math.max(...elementMeta.map(m => m.globalX + m.el.width));
      const targetCenter = (minX + maxX) / 2;
      elementMeta.forEach(m => {
        m.el.x = Math.round((targetCenter - m.el.width / 2 - m.pageIdx * pageWidthMm) * 10) / 10;
      });
    } else if (direction === 'right') {
      const maxX = Math.max(...elementMeta.map(m => m.globalX + m.el.width));
      elementMeta.forEach(m => {
        m.el.x = Math.round((maxX - m.el.width - m.pageIdx * pageWidthMm) * 10) / 10;
      });
    } else if (direction === 'top') {
      const minY = Math.min(...elementMeta.map(m => m.globalY));
      elementMeta.forEach(m => {
        m.el.y = Math.round(minY * 10) / 10;
      });
    } else if (direction === 'middle') {
      const minY = Math.min(...elementMeta.map(m => m.globalY));
      const maxY = Math.max(...elementMeta.map(m => m.globalY + m.el.height));
      const targetMiddle = (minY + maxY) / 2;
      elementMeta.forEach(m => {
        m.el.y = Math.round((targetMiddle - m.el.height / 2) * 10) / 10;
      });
    } else if (direction === 'bottom') {
      const maxY = Math.max(...elementMeta.map(m => m.globalY + m.el.height));
      elementMeta.forEach(m => {
        m.el.y = Math.round((maxY - m.el.height) * 10) / 10;
      });
    }

    this.pushHistory();
    this.notify();
  }

  public distributeElements(axis: 'horizontal' | 'vertical') {
    const spread = this.getActiveSpread();
    const selectedElements = spread.elements.filter(el => this.state.selectedElementIds.includes(el.id) && !el.locked);
    if (selectedElements.length < 3) return;

    const pageWidthMm = this.state.settings.widthMm;
    const elementMeta = selectedElements.map(el => {
      const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
      const globalX = pageIdx * pageWidthMm + el.x;
      const globalY = el.y;
      return { el, pageIdx, globalX, globalY };
    });

    if (axis === 'horizontal') {
      elementMeta.sort((a, b) => a.globalX - b.globalX);
      const first = elementMeta[0];
      const last = elementMeta[elementMeta.length - 1];
      const totalSpan = last.globalX - (first.globalX + first.el.width);
      let interiorWidth = 0;
      for (let i = 1; i < elementMeta.length - 1; i++) {
        interiorWidth += elementMeta[i].el.width;
      }
      const gap = (totalSpan - interiorWidth) / (elementMeta.length - 1);
      let currentGlobalX = first.globalX + first.el.width + gap;
      for (let i = 1; i < elementMeta.length - 1; i++) {
        const m = elementMeta[i];
        m.el.x = Math.round((currentGlobalX - m.pageIdx * pageWidthMm) * 10) / 10;
        currentGlobalX += m.el.width + gap;
      }
    } else {
      elementMeta.sort((a, b) => a.globalY - b.globalY);
      const first = elementMeta[0];
      const last = elementMeta[elementMeta.length - 1];
      const totalSpan = last.globalY - (first.globalY + first.el.height);
      let interiorHeight = 0;
      for (let i = 1; i < elementMeta.length - 1; i++) {
        interiorHeight += elementMeta[i].el.height;
      }
      const gap = (totalSpan - interiorHeight) / (elementMeta.length - 1);
      let currentY = first.globalY + first.el.height + gap;
      for (let i = 1; i < elementMeta.length - 1; i++) {
        const m = elementMeta[i];
        m.el.y = Math.round(currentY * 10) / 10;
        currentY += m.el.height + gap;
      }
    }

    this.pushHistory();
    this.notify();
  }

  public changeElementOrder(id: string, direction: 'front' | 'back' | 'forward' | 'backward') {
    const spread = this.getActiveSpread();
    const idx = spread.elements.findIndex(el => el.id === id);
    if (idx === -1) return;

    const el = spread.elements.splice(idx, 1)[0];
    if (direction === 'front') {
      spread.elements.push(el);
    } else if (direction === 'back') {
      spread.elements.unshift(el);
    } else if (direction === 'forward') {
      spread.elements.splice(Math.min(spread.elements.length, idx + 1), 0, el);
    } else if (direction === 'backward') {
      spread.elements.splice(Math.max(0, idx - 1), 0, el);
    }
    spread.elements.forEach((item, i) => {
      item.zIndex = i + 1;
    });
    this.pushHistory();
    this.notify();
  }

  public renumberPages() {
    let curPage = 1;
    const isFacing = Boolean(this.state.settings.facingPages);

    this.state.spreads.forEach((spread, sIdx) => {
      spread.spreadIndex = sIdx;
      const numPages = spread.pages.length;

      if (numPages === 1) {
        const page = spread.pages[0];
        page.pageNumber = curPage++;
        if (isFacing) {
          page.side = (sIdx === 0 || page.pageNumber % 2 === 1) ? 'right' : 'left';
        } else {
          page.side = 'single';
        }
      } else if (numPages >= 2) {
        spread.pages.forEach((page, pIdx) => {
          page.pageNumber = curPage++;
          page.side = pIdx === 0 ? 'left' : 'right';
        });
      }
    });
  }

  public addSpread() {
    const totalSpreads = this.state.spreads.length;
    const newSpread: Spread = {
      id: `spread-${Date.now()}`,
      spreadIndex: totalSpreads,
      pages: [
        { id: `page-${Date.now()}-1`, pageNumber: 0, side: 'left' },
        { id: `page-${Date.now()}-2`, pageNumber: 0, side: 'right' },
      ],
      elements: [],
    };

    this.state.spreads.push(newSpread);
    this.renumberPages();
    this.state.activeSpreadIndex = totalSpreads;
    this.state.selectedElementId = null;
    this.state.selectedElementIds = [];
    this.pushHistory();
    this.notify();
  }

  public deleteSpread(index: number) {
    if (this.state.spreads.length <= 1) return;
    const targetSpread = this.state.spreads[index];
    if (targetSpread) {
      for (const el of targetSpread.elements) {
        if (el.type === 'text') {
          this.unlinkTextFrame(el.id, true, false);
        } else if (el.type === 'table') {
          this.unlinkTableFrame(el.id, true, false);
        }
      }
    }
    this.state.spreads.splice(index, 1);
    this.renumberPages();
    this.state.activeSpreadIndex = Math.max(0, Math.min(index, this.state.spreads.length - 1));
    this.state.selectedElementId = null;
    this.state.selectedElementIds = [];
    this.pushHistory();
    this.notify();
  }

  public duplicateSpread(index: number) {
    if (index < 0 || index >= this.state.spreads.length) return;
    const src = this.state.spreads[index];
    const pageIdMap = new Map<string, string>();
    const newPages = src.pages.map((p, i) => {
      const newPageId = `page-${Date.now()}-${i}`;
      pageIdMap.set(p.id, newPageId);
      return {
        id: newPageId,
        pageNumber: 0,
        side: p.side,
      };
    });

    const newSpread: Spread = {
      id: `spread-${Date.now()}`,
      spreadIndex: this.state.spreads.length,
      pages: newPages,
      elements: JSON.parse(JSON.stringify(src.elements)).map((el: CanvasElement) => {
        const cloned: CanvasElement = {
          ...el,
          id: `el-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          pageId: pageIdMap.get(el.pageId) || (newPages[0]?.id || el.pageId),
        };
        if (cloned.type === 'text') {
          const textCloned = cloned as TextElement;
          delete textCloned.prevFrameId;
          delete textCloned.nextFrameId;
        } else if (cloned.type === 'table') {
          const tableCloned = cloned as TableElement;
          delete tableCloned.prevFrameId;
          delete tableCloned.nextFrameId;
        }
        return cloned;
      }),
    };
    this.state.spreads.splice(index + 1, 0, newSpread);
    this.renumberPages();
    this.setActiveSpread(index + 1);
    this.pushHistory();
    this.notify();
  }

  public toggleOverprintBlack() {
    const current = this.state.settings.overprintBlack !== false;
    this.updateSettings({ overprintBlack: !current });
  }

  public toggleFacingPages() {
    this.updateSettings({ facingPages: !this.state.settings.facingPages });
  }

  public resetToDefault() {
    this.state = JSON.parse(JSON.stringify(INITIAL_STATE));
    this.pushHistory();
    this.notify();
  }

  /**
   * Initializes a brand new, completely blank publication / book with 0 canvas elements.
   * Cleans spreads, resets selection, master spreads, and history stack.
   */
  public createBlankProject(
    preset: PagePreset = 'A4',
    title: string = 'Untitled Document',
    facingPages: boolean = true
  ) {
    const presetConfig = PAGE_PRESETS[preset] || PAGE_PRESETS['A4'];
    const now = Date.now();

    const blankState: ProjectState = {
      settings: {
        title,
        preset,
        widthMm: presetConfig.widthMm,
        heightMm: presetConfig.heightMm,
        facingPages,
        bleedMm: 3,
        margins: {
          topMm: 20,
          bottomMm: 20,
          insideMm: 25,
          outsideMm: 18,
        },
        columnCount: 1,
        columnGutterMm: 5,
        baselineGrid: {
          enabled: true,
          incrementPt: 12,
          startMm: 20,
        },
        colorMode: 'cmyk',
        iccProfile: 'FOGRA39',
        footnotes: [],
        footnoteSettings: {
          numberingStyle: 'superscript',
          separatorRuleWidthMm: 30,
          separatorRuleThicknessPt: 0.5,
          fontSizePt: 8,
          scope: 'document',
        },
      },
      spreads: [
        {
          id: `spread-blank-${now}`,
          spreadIndex: 0,
          pages: facingPages
            ? [{ id: `page-blank-${now}-1`, pageNumber: 1, side: 'right' }]
            : [{ id: `page-blank-${now}-1`, pageNumber: 1, side: 'single' }],
          elements: [],
        },
      ],
      activeSpreadIndex: 0,
      selectedElementId: null,
      selectedElementIds: [],
      activeTool: 'select',
      zoom: 1.0,
      panX: 0,
      panY: 0,
      showGuides: true,
      showBleed: true,
      showBaselineGrid: true,
      snapToGuides: true,
      displayQuality: 'typical',
      paragraphStyles: JSON.parse(JSON.stringify(DEFAULT_PARAGRAPH_STYLES)),
      masterSpreads: [
        {
          id: 'master-a',
          name: 'A-Master Spread',
          prefix: 'A',
          pages: [
            { id: `master-a-p1-${now}`, pageNumber: 1, side: 'left' },
            { id: `master-a-p2-${now}`, pageNumber: 2, side: 'right' },
          ],
          elements: [],
        },
      ],
      linkingFromFrameId: null,
      layers: JSON.parse(JSON.stringify(DEFAULT_LAYERS)),
      activeLayerId: 'layer-1',
    };

    this.state = blankState;
    this.renumberPages();
    this.history = [];
    this.historyIndex = -1;
    this.pushHistory();
    this.notify();
  }

  public loadFromJson(jsonStr: string) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.settings && parsed.spreads) {
        if (!Array.isArray(parsed.selectedElementIds)) {
          parsed.selectedElementIds = parsed.selectedElementId ? [parsed.selectedElementId] : [];
        }
        if (!parsed.settings.baselineGrid) {
          parsed.settings.baselineGrid = {
            enabled: true,
            incrementPt: 12,
            startMm: 20,
          };
        }
        if (parsed.showBaselineGrid === undefined) {
          parsed.showBaselineGrid = true;
        }
        if (!Array.isArray(parsed.paragraphStyles) || parsed.paragraphStyles.length === 0) {
          parsed.paragraphStyles = DEFAULT_PARAGRAPH_STYLES;
        }
        if (!Array.isArray(parsed.masterSpreads) || parsed.masterSpreads.length === 0) {
          parsed.masterSpreads = DEFAULT_MASTER_SPREADS;
        }
        if (parsed.linkingFromFrameId === undefined) {
          parsed.linkingFromFrameId = null;
        }
        if (!parsed.displayQuality) {
          parsed.displayQuality = 'typical';
        }
        if (!Array.isArray(parsed.layers) || parsed.layers.length === 0) {
          parsed.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
        }
        if (!parsed.activeLayerId) {
          parsed.activeLayerId = parsed.layers[0]?.id || 'layer-1';
        }
        if (!parsed.settings.colorMode) {
          parsed.settings.colorMode = 'cmyk';
        }
        if (!parsed.settings.iccProfile) {
          parsed.settings.iccProfile = 'FOGRA39';
        }
        this.state = parsed;
        this.renumberPages();
        this.pushHistory();
        this.notify();
      }
    } catch (e) {
      console.error('Failed to parse project JSON', e);
    }
  }

  public async loadFromIndd(inddBuffer: ArrayBuffer | Uint8Array, fileName?: string) {
    try {
      const newState = parseInddToProjectState(inddBuffer, fileName);
      if (!Array.isArray(newState.layers) || newState.layers.length === 0) {
        newState.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
      }
      if (!newState.activeLayerId) {
        newState.activeLayerId = newState.layers[0]?.id || 'layer-1';
      }
      this.state = newState;
      this.renumberPages();
      this.pushHistory();
      this.notify();
    } catch (e) {
      console.error('Failed to parse INDD document', e);
      throw e;
    }
  }

  public async loadFromIdml(idmlBuffer: ArrayBuffer | Uint8Array, fileName?: string) {
    if (isInddBuffer(idmlBuffer)) {
      return this.loadFromIndd(idmlBuffer, fileName);
    }
    try {
      const newState = await parseIdmlPackage(idmlBuffer, fileName);
      if (!Array.isArray(newState.layers) || newState.layers.length === 0) {
        newState.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
      }
      if (!newState.activeLayerId) {
        newState.activeLayerId = newState.layers[0]?.id || 'layer-1';
      }
      this.state = newState;
      this.renumberPages();
      this.pushHistory();
      this.notify();
    } catch (e) {
      console.error('Failed to parse IDML package', e);
      throw e;
    }
  }

  public placeTextContent(elementId: string, content: { formattedText: string; detectedStyleId?: string }) {
    const spread = this.getActiveSpread();
    const el = spread.elements.find(e => e.id === elementId);
    if (!el || el.type !== 'text') return;

    const updates: Partial<TextElement> = {
      text: content.formattedText,
    };
    if (content.detectedStyleId) {
      updates.paragraphStyleId = content.detectedStyleId;
    }
    this.updateElement(elementId, updates);
  }

  public updateTableCell(tableId: string, row: number, col: number, text: string) {
    const spread = this.getActiveSpread();
    const el = spread.elements.find(e => e.id === tableId);
    if (!el || el.type !== 'table') return;

    const tableEl = el as TableElement;
    if (tableEl.cells[row] && tableEl.cells[row][col]) {
      const newCells = tableEl.cells.map((r, rIdx) =>
        r.map((c, cIdx) => (rIdx === row && cIdx === col ? { ...c, text } : { ...c }))
      );
      this.updateElement(tableId, { cells: newCells });
    }
  }

  public executeDataMerge(
    csvText: string,
    mode: 'generateSpreads' | 'inPlace' = 'generateSpreads'
  ): { spreadsCreated: number; recordsMerged: number } {
    const parsed = parseCsv(csvText);
    if (parsed.records.length === 0) {
      return { spreadsCreated: 0, recordsMerged: 0 };
    }

    const activeSpread = this.getActiveSpread();

    if (mode === 'inPlace') {
      const firstRecord = parsed.records[0];
      const newElements = activeSpread.elements.map(el => substituteElementTokens(el, firstRecord));
      activeSpread.elements = newElements;
      this.pushHistory();
      this.notify();
      return { spreadsCreated: 1, recordsMerged: 1 };
    }

    // Generate spreads
    const lastSpread = this.state.spreads[this.state.spreads.length - 1];
    const lastPage = lastSpread?.pages[lastSpread.pages.length - 1];
    const startPageNum = lastPage ? lastPage.pageNumber + 1 : 1;

    const newSpreads = generateMergedSpreads(
      activeSpread,
      parsed.records,
      this.state.spreads.length,
      startPageNum
    );

    this.state.spreads.push(...newSpreads);
    this.pushHistory();
    this.notify();

    return {
      spreadsCreated: newSpreads.length,
      recordsMerged: parsed.records.length,
    };
  }

  public exportJson(): string {
    return JSON.stringify(this.state, null, 2);
  }

  public calculateTacPercentage(colorStr?: string): number {
  if (!colorStr || colorStr === 'transparent' || colorStr === 'none') return 0;
  const str = colorStr.trim();
  const cmykMatch = str.match(/cmyk\s*\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)/i);
  if (cmykMatch) {
    const c = parseFloat(cmykMatch[1]) || 0;
    const m = parseFloat(cmykMatch[2]) || 0;
    const y = parseFloat(cmykMatch[3]) || 0;
    const k = parseFloat(cmykMatch[4]) || 0;
    return Math.round(c + m + y + k);
  }

  let hex = str;
  if (hex.startsWith('#')) {
    hex = hex.substring(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      const k = 1 - Math.max(r, g, b);
      if (k >= 0.99) return 100;
      const c = (1 - r - k) / (1 - k);
      const m = (1 - g - k) / (1 - k);
      const y = (1 - b - k) / (1 - k);
      return Math.round((c + m + y + k) * 100);
    }
  }
  return 0;
}

  public runPreflightCheck(): PreflightIssue[] {
    const issues: PreflightIssue[] = [];
    const settings = this.state.settings;
    const pageWidthMm = settings.widthMm;
    const pageHeightMm = settings.heightMm;
    const bleedMm = settings.bleedMm ?? 3;

    let hasSeenH1 = false;
    let lastHeadingLevel = 0;

    this.state.spreads.forEach((spread, spreadIdx) => {
      for (const el of spread.elements) {
        const page = spread.pages.find((p) => p.id === el.pageId) || spread.pages[0];
        const pageNumber = page ? page.pageNumber : spreadIdx + 1;

        // 1. OVERSET_TEXT: Overflowing text frames without continuation nextFrameId
        if (el.type === 'text') {
          const textEl = el as TextElement;
          const textContent = textEl.text || '';
          if (textContent.length > 0 && !textEl.nextFrameId) {
            const padding = textEl.paddingMm ?? 2;
            const cols = Math.max(1, textEl.columns || 1);
            const gutter = textEl.columnGutterMm ?? 4;
            const availW = Math.max(10, (textEl.width - (padding * 2) - ((cols - 1) * gutter)) / cols);
            const availH = Math.max(10, textEl.height - (padding * 2));
            const fontPt = textEl.fontSizePt || 10;
            const lineH = textEl.lineHeight || 1.3;
            const lineSpacingMm = (fontPt * lineH * 25.4) / 72;
            const maxLinesPerCol = Math.max(1, Math.floor(availH / lineSpacingMm));
            const avgCharWidthMm = (fontPt * 0.45 * 25.4) / 72;
            const charsPerLine = Math.max(10, Math.floor(availW / avgCharWidthMm));
            const totalCapacity = maxLinesPerCol * charsPerLine * cols;

            const explicitLines = textContent.split('\n');
            let approxRenderedLines = 0;
            for (const line of explicitLines) {
              approxRenderedLines += Math.max(1, Math.ceil(line.length / charsPerLine));
            }
            const totalLinesCapacity = maxLinesPerCol * cols;

            if (approxRenderedLines > totalLinesCapacity || textContent.length > totalCapacity * 1.15) {
              const overflowAmt = Math.max(
                approxRenderedLines - totalLinesCapacity,
                Math.ceil((textContent.length - totalCapacity) / charsPerLine)
              );
              issues.push({
                id: `preflight-overset-${spreadIdx}-${el.id}`,
                severity: 'error',
                code: 'OVERSET_TEXT',
                message: `Text frame overflows available area by ~${overflowAmt} lines. Link to next frame or enlarge frame.`,
                spreadIndex: spreadIdx,
                pageNumber,
                elementId: el.id,
              });
            }
          }
        }

        // 2. LOW_RES_IMAGE: Empty src or low effective DPI (<220 DPI)
        if (el.type === 'image') {
          const imgEl = el as ImageElement;
          if (!imgEl.src || imgEl.src.trim() === '') {
            issues.push({
              id: `preflight-empty-img-${spreadIdx}-${el.id}`,
              severity: 'error',
              code: 'LOW_RES_IMAGE',
              message: `Image frame is empty placeholder without source photo.`,
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          } else if (imgEl.src.startsWith('data:image') && imgEl.src.length < 250 && imgEl.width > 15) {
            issues.push({
              id: `preflight-lowres-${spreadIdx}-${el.id}`,
              severity: 'warning',
              code: 'LOW_RES_IMAGE',
              message: `Image resolution appears below print threshold (< 220 DPI on spread).`,
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          }
        }

        // 3. TRIM_HAZARD: Text elements placed < 4mm from page trim boundary
        if (el.type === 'text') {
          const trimMargin = 4;
          const rightEdge = el.x + el.width;
          const bottomEdge = el.y + el.height;
          if (
            el.x < trimMargin ||
            el.y < trimMargin ||
            rightEdge > pageWidthMm - trimMargin ||
            bottomEdge > pageHeightMm - trimMargin
          ) {
            issues.push({
              id: `preflight-trim-${spreadIdx}-${el.id}`,
              severity: 'warning',
              code: 'TRIM_HAZARD',
              message: `Text frame placed within 4mm of page trim edge. Risk of clipping during print trimming.`,
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          }
        }

        // 4. BLEED_ERROR: Images touching the trim edge without filling full bleed allowance
        if (el.type === 'image') {
          const rightEdge = el.x + el.width;
          const bottomEdge = el.y + el.height;
          const touchesLeft = Math.abs(el.x) <= 1.0;
          const touchesTop = Math.abs(el.y) <= 1.0;
          const touchesRight = Math.abs(rightEdge - pageWidthMm) <= 1.0;
          const touchesBottom = Math.abs(bottomEdge - pageHeightMm) <= 1.0;

          if (touchesLeft || touchesTop || touchesRight || touchesBottom) {
            const hasProperBleed =
              (!touchesLeft || el.x <= -bleedMm + 0.5) &&
              (!touchesTop || el.y <= -bleedMm + 0.5) &&
              (!touchesRight || rightEdge >= pageWidthMm + bleedMm - 0.5) &&
              (!touchesBottom || bottomEdge >= pageHeightMm + bleedMm - 0.5);

            if (!hasProperBleed) {
              issues.push({
                id: `preflight-bleed-${spreadIdx}-${el.id}`,
                severity: 'warning',
                code: 'BLEED_ERROR',
                message: `Image touches page boundary but lacks ${bleedMm}mm bleed allowance. May show white edge defect when trimmed.`,
                spreadIndex: spreadIdx,
                pageNumber,
                elementId: el.id,
              });
            }
          }
        }

        // 5. MISSING_ALT_TEXT: Images lacking Alt Text for screen readers (PDF/UA Section 508)
        if (el.type === 'image') {
          const imgEl = el as ImageElement;
          if (!imgEl.altText || !imgEl.altText.trim()) {
            issues.push({
              id: `preflight-alt-${spreadIdx}-${el.id}`,
              severity: 'warning',
              code: 'MISSING_ALT_TEXT',
              message: `Image frame "${imgEl.name || imgEl.id}" is missing Alt Text description for screen-reader accessibility (Section 508 / PDF/UA).`,
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          }
        }

        // 6. HEADING_ORDER_HAZARD: Logical heading structure check (H2/H3 before H1 or level skip)
        if (el.type === 'text') {
          const textEl = el as TextElement;
          if (textEl.paragraphStyleId) {
            const style = this.state.paragraphStyles.find((s) => s.id === textEl.paragraphStyleId);
            const tag = style?.pdfTag;
            if (tag && /^H[1-6]$/i.test(tag)) {
              const level = parseInt(tag.substring(1), 10);
              if (level === 1) {
                hasSeenH1 = true;
                lastHeadingLevel = 1;
              } else {
                if (!hasSeenH1) {
                  issues.push({
                    id: `preflight-heading-order-${spreadIdx}-${el.id}`,
                    severity: 'warning',
                    code: 'HEADING_ORDER_HAZARD',
                    message: `Heading hierarchy warning: <${tag}> appears before an <H1> has been defined (PDF/UA Section 508).`,
                    spreadIndex: spreadIdx,
                    pageNumber,
                    elementId: el.id,
                  });
                } else if (level > lastHeadingLevel + 1) {
                  issues.push({
                    id: `preflight-heading-order-${spreadIdx}-${el.id}`,
                    severity: 'warning',
                    code: 'HEADING_ORDER_HAZARD',
                    message: `Heading hierarchy warning: <${tag}> skips heading levels after <H${lastHeadingLevel}> (PDF/UA Section 508).`,
                    spreadIndex: spreadIdx,
                    pageNumber,
                    elementId: el.id,
                  });
                }
                lastHeadingLevel = level;
              }
            }
          }
        }

        // 7. TAC_INK_DENSITY: Total Area Coverage (TAC) exceeding 300%
        if (el.type === 'shape' || el.type === 'text') {
          const colorsToCheck = [
            (el as any).fillColor,
            (el as any).strokeColor,
            (el as any).color,
            (el as any).backgroundColor,
            (el as any).borderColor,
          ].filter(Boolean);

          for (const col of colorsToCheck) {
            const tac = this.calculateTacPercentage(col);
            if (tac > 300) {
              issues.push({
                id: `preflight-tac-${spreadIdx}-${el.id}`,
                severity: 'warning',
                code: 'TAC_INK_DENSITY',
                message: `Ink coverage (${tac}%) exceeds standard press threshold (300% TAC). Risk of wet ink offset and smudging.`,
                spreadIndex: spreadIdx,
                pageNumber,
                elementId: el.id,
              });
              break;
            }
          }
        }

        // 8. Typographic Linter: Straight Quotes, Double Spaces, Hyphenation Ladders
        if (el.type === 'text') {
          const txt = el as TextElement;
          const content = txt.text || '';
          if (content.length > 0) {
            if (/"|'/.test(content)) {
              issues.push({
                id: `preflight-typo-quotes-${spreadIdx}-${el.id}`,
                severity: 'info',
                code: 'TYPO_STRAIGHT_QUOTES',
                message: 'Straight typewriter quote(s) detected. Recommend typographical smart curly quotes (“ ” ‘ ’).',
                spreadIndex: spreadIdx,
                pageNumber,
                elementId: el.id,
              });
            }
            if (/  +/.test(content)) {
              issues.push({
                id: `preflight-typo-spaces-${spreadIdx}-${el.id}`,
                severity: 'info',
                code: 'TYPO_DOUBLE_SPACES',
                message: 'Double or consecutive spaces detected. Recommend single word spacing for professional typesetting.',
                spreadIndex: spreadIdx,
                pageNumber,
                elementId: el.id,
              });
            }
            const lines = content.split('\n');
            let ladderCount = 0;
            let hasLadder = false;
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.endsWith('-') || trimmed.endsWith('‐')) {
                ladderCount++;
                if (ladderCount >= 3) {
                  hasLadder = true;
                  break;
                }
              } else {
                ladderCount = 0;
              }
            }
            if (hasLadder) {
              issues.push({
                id: `preflight-typo-ladder-${spreadIdx}-${el.id}`,
                severity: 'warning',
                code: 'TYPO_HYPHENATION_LADDER',
                message: 'Hyphenation ladder detected: 3 or more consecutive lines end with a hyphen.',
                spreadIndex: spreadIdx,
                pageNumber,
                elementId: el.id,
              });
            }
          }
        }
      }
    });

    return issues;
  }

  public autoFixPreflightIssue(issue: PreflightIssue): boolean {
    if (!issue.elementId) return false;
    const el = this.getElementById(issue.elementId);
    if (!el) return false;

    if (issue.code === 'LOW_RES_IMAGE' && el.type === 'image') {
      const img = el as ImageElement;
      if (!img.src || img.src.trim() === '' || (img.src.startsWith('data:image') && img.src.length < 250)) {
        img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440"><rect width="100%" height="100%" fill="%23242424"/><line x1="0" y1="0" x2="600" y2="440" stroke="%233a3a3a" stroke-width="2"/><line x1="600" y1="0" x2="0" y2="440" stroke="%233a3a3a" stroke-width="2"/><circle cx="300" cy="220" r="80" fill="%231a1a1a" stroke="%230d99ff" stroke-width="3"/><text x="300" y="226" font-family="sans-serif" font-size="16" fill="%23e0e0e0" text-anchor="middle" letter-spacing="2">PUBLICATION ARTWORK</text></svg>';
        img.caption = img.caption || 'Vector artwork illustration';
        img.altText = img.altText || 'Editorial vector artwork illustration';
        this.pushHistory();
        this.notify();
        return true;
      }
    }

    if (issue.code === 'MISSING_ALT_TEXT' && el.type === 'image') {
      const img = el as ImageElement;
      img.altText = img.caption || img.name || 'Editorial publication graphic';
      this.pushHistory();
      this.notify();
      return true;
    }

    if (issue.code === 'OVERSET_TEXT' && el.type === 'text') {
      const textEl = el as TextElement;
      try {
        this.copyfitTextFrame(textEl.id);
      } catch {
        // Continue to robust auto-expansion
      }

      const textContent = textEl.text || '';
      const padding = textEl.paddingMm ?? 2;
      const cols = Math.max(1, textEl.columns || 1);
      const gutter = textEl.columnGutterMm ?? 4;
      let fontPt = textEl.fontSizePt || 10;
      const lineH = textEl.lineHeight || 1.3;
      let lineSpacingMm = (fontPt * lineH * 25.4) / 72;
      const availW = Math.max(10, (textEl.width - (padding * 2) - ((cols - 1) * gutter)) / cols);
      let avgCharWidthMm = (fontPt * 0.45 * 25.4) / 72;
      let charsPerLine = Math.max(10, Math.floor(availW / avgCharWidthMm));

      const explicitLines = textContent.split('\n');
      let approxRenderedLines = 0;
      for (const line of explicitLines) {
        approxRenderedLines += Math.max(1, Math.ceil(line.length / charsPerLine));
      }

      const requiredTotalLines = Math.max(approxRenderedLines, Math.ceil(textContent.length / (charsPerLine * 1.15)));
      const requiredLinesPerCol = Math.ceil(requiredTotalLines / cols);
      const requiredHeightMm = Math.ceil((requiredLinesPerCol * lineSpacingMm + (padding * 2) + 2) * 10) / 10;

      const pageH = this.state.settings.heightMm;
      const maxAllowedH = pageH - 5 - textEl.y;

      if (requiredHeightMm <= maxAllowedH) {
        textEl.height = Math.max(textEl.height, requiredHeightMm);
      } else {
        textEl.height = Math.max(15, maxAllowedH);
        const availH = Math.max(10, textEl.height - (padding * 2));
        while (fontPt > 6) {
          lineSpacingMm = (fontPt * lineH * 25.4) / 72;
          const maxLinesPerCol = Math.max(1, Math.floor(availH / lineSpacingMm));
          avgCharWidthMm = (fontPt * 0.45 * 25.4) / 72;
          charsPerLine = Math.max(10, Math.floor(availW / avgCharWidthMm));
          let lines = 0;
          for (const line of explicitLines) {
            lines += Math.max(1, Math.ceil(line.length / charsPerLine));
          }
          if (lines <= maxLinesPerCol * cols) {
            break;
          }
          fontPt = Math.round((fontPt - 0.5) * 10) / 10;
        }
        textEl.fontSizePt = fontPt;
      }

      this.pushHistory();
      this.notify();
      return true;
    }

    if (issue.code === 'TRIM_HAZARD') {
      const trimMargin = 5;
      const pageW = this.state.settings.widthMm;
      const pageH = this.state.settings.heightMm;

      if (el.width > pageW - (trimMargin * 2)) {
        el.width = Math.round((pageW - (trimMargin * 2)) * 10) / 10;
      }
      if (el.height > pageH - (trimMargin * 2)) {
        el.height = Math.round((pageH - (trimMargin * 2)) * 10) / 10;
      }

      if (el.x < trimMargin) {
        el.x = trimMargin;
      } else if (el.x + el.width > pageW - trimMargin) {
        el.x = Math.max(trimMargin, Math.round((pageW - trimMargin - el.width) * 10) / 10);
      }

      if (el.y < trimMargin) {
        el.y = trimMargin;
      } else if (el.y + el.height > pageH - trimMargin) {
        el.y = Math.max(trimMargin, Math.round((pageH - trimMargin - el.height) * 10) / 10);
      }

      this.pushHistory();
      this.notify();
      return true;
    }

    if (issue.code === 'BLEED_ERROR' && el.type === 'image') {
      const bleed = this.state.settings.bleedMm ?? 3;
      const pageW = this.state.settings.widthMm;
      const pageH = this.state.settings.heightMm;
      if (Math.abs(el.x) <= 1.0) {
        el.width += el.x + bleed;
        el.x = -bleed;
      }
      if (Math.abs(el.y) <= 1.0) {
        el.height += el.y + bleed;
        el.y = -bleed;
      }
      if (Math.abs((el.x + el.width) - pageW) <= 1.0) {
        el.width = (pageW + bleed) - el.x;
      }
      if (Math.abs((el.y + el.height) - pageH) <= 1.0) {
        el.height = (pageH + bleed) - el.y;
      }
      this.pushHistory();
      this.notify();
      return true;
    }

    if (issue.code === 'HEADING_ORDER_HAZARD' && el.type === 'text') {
      const txt = el as TextElement;
      txt.paragraphStyleId = 'style-h1';
      this.pushHistory();
      this.notify();
      return true;
    }

    if (issue.code === 'TAC_INK_DENSITY') {
      if (el.type === 'shape') {
        const shape = el as ShapeElement;
        if (shape.fillColor && this.calculateTacPercentage(shape.fillColor) > 300) {
          shape.fillColor = '#1a1a1a';
        }
        if (shape.strokeColor && this.calculateTacPercentage(shape.strokeColor) > 300) {
          shape.strokeColor = '#1a1a1a';
        }
      } else if (el.type === 'text') {
        const txt = el as TextElement;
        if (txt.color && this.calculateTacPercentage(txt.color) > 300) {
          txt.color = '#1a1a1a';
        }
        if (txt.backgroundColor && this.calculateTacPercentage(txt.backgroundColor) > 300) {
          txt.backgroundColor = '#1a1a1a';
        }
        if (txt.borderColor && this.calculateTacPercentage(txt.borderColor) > 300) {
          txt.borderColor = '#1a1a1a';
        }
      }
      this.pushHistory();
      this.notify();
      return true;
    }

    if (issue.code === 'TYPO_STRAIGHT_QUOTES' && el.type === 'text') {
      const txt = el as TextElement;
      if (txt.text) {
        let s = txt.text;
        s = s.replace(/(^|[\s(\[{<])"/g, '$1\u201C');
        s = s.replace(/"/g, '\u201D');
        s = s.replace(/(^|[\s(\[{<])'/g, '$1\u2018');
        s = s.replace(/'/g, '\u2019');
        txt.text = s;
        this.pushHistory();
        this.notify();
        return true;
      }
    }

    if (issue.code === 'TYPO_DOUBLE_SPACES' && el.type === 'text') {
      const txt = el as TextElement;
      if (txt.text) {
        txt.text = txt.text.replace(/  +/g, ' ');
        this.pushHistory();
        this.notify();
        return true;
      }
    }

    return false;
  }

  public autoFixAllPreflightIssues(): number {
    let issues = this.runPreflightCheck();
    let totalFixed = 0;
    for (let pass = 0; pass < 3 && issues.length > 0; pass++) {
      let passFixed = 0;
      for (const issue of issues) {
        if (this.autoFixPreflightIssue(issue)) {
          passFixed++;
        }
      }
      totalFixed += passFixed;
      if (passFixed === 0) break;
      issues = this.runPreflightCheck();
    }
    return totalFixed;
  }

  public exportProjectFile() {
    if (typeof document !== 'undefined') {
      RectoDB.exportProjectFile(this.state);
    }
  }

  public async importProjectFile(file: File): Promise<void> {
    const state = await RectoDB.importProjectFile(file);
    this.loadFromJson(JSON.stringify(state));
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {}

    // Asynchronous high-capacity IndexedDB persistence
    if (typeof indexedDB !== 'undefined') {
      RectoDB.saveProject(this.state).catch(() => {});
    }
  }

  private loadFromStorage(): ProjectState | null {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  // --- Version Snapshot Manager (Git-style local checkpoints & rollback) ---

  public createSnapshot(message: string, author: string = 'User'): VersionSnapshot {
    const totalElements = this.state.spreads.reduce((acc, s) => acc + s.elements.length, 0);
    const snapId = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const snapshot: VersionSnapshot = {
      id: snapId,
      timestamp: Date.now(),
      message: message.trim() || 'Snapshot checkpoint',
      author,
      spreadCount: this.state.spreads.length,
      elementCount: totalElements,
      state: JSON.parse(JSON.stringify(this.state)),
    };
    this.snapshots.unshift(snapshot);
    if (this.snapshots.length > 50) this.snapshots.pop();
    this.saveSnapshotsToStorage();
    this.notify();
    return snapshot;
  }

  public getSnapshots(): VersionSnapshot[] {
    return [...this.snapshots];
  }

  public rollbackToSnapshot(snapshotId: string): boolean {
    const snap = this.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return false;
    this.state = JSON.parse(JSON.stringify(snap.state));
    this.pushHistory();
    this.notify();
    return true;
  }

  public deleteSnapshot(snapshotId: string): boolean {
    const initialLen = this.snapshots.length;
    this.snapshots = this.snapshots.filter((s) => s.id !== snapshotId);
    if (this.snapshots.length !== initialLen) {
      this.saveSnapshotsToStorage();
      this.notify();
      return true;
    }
    return false;
  }

  public diffSnapshot(snapshotId: string): {
    added: CanvasElement[];
    removed: CanvasElement[];
    modified: CanvasElement[];
    summary: string;
  } {
    const snap = this.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return { added: [], removed: [], modified: [], summary: 'Snapshot not found' };

    const currElements: CanvasElement[] = [];
    for (const sp of this.state.spreads) currElements.push(...sp.elements);

    const snapElements: CanvasElement[] = [];
    for (const sp of snap.state.spreads) snapElements.push(...sp.elements);

    const currMap = new Map<string, CanvasElement>(currElements.map((e) => [e.id, e]));
    const snapMap = new Map<string, CanvasElement>(snapElements.map((e) => [e.id, e]));

    const added: CanvasElement[] = [];
    const modified: CanvasElement[] = [];
    const removed: CanvasElement[] = [];

    for (const [id, currEl] of currMap) {
      const snapEl = snapMap.get(id);
      if (!snapEl) {
        added.push(currEl);
      } else if (JSON.stringify(currEl) !== JSON.stringify(snapEl)) {
        modified.push(currEl);
      }
    }

    for (const [id, snapEl] of snapMap) {
      if (!currMap.has(id)) {
        removed.push(snapEl);
      }
    }

    const summary = `${added.length} added, ${modified.length} modified, ${removed.length} removed`;
    return { added, removed, modified, summary };
  }

  // --- Layer Management ---
  public getLayers(): Layer[] {
    if (!Array.isArray(this.state.layers) || this.state.layers.length === 0) {
      this.state.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
      this.state.activeLayerId = this.state.layers[0]?.id || 'layer-1';
    }
    return [...this.state.layers].sort((a, b) => b.order - a.order);
  }

  public getLayer(layerId?: string): Layer | undefined {
    if (!Array.isArray(this.state.layers) || this.state.layers.length === 0) {
      this.state.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
      this.state.activeLayerId = this.state.layers[0]?.id || 'layer-1';
    }
    if (!layerId) {
      return this.state.layers.find(l => l.id === this.state.activeLayerId) || this.state.layers[0];
    }
    return this.state.layers.find(l => l.id === layerId) || this.state.layers[0];
  }

  public setActiveLayer(layerId: string) {
    if (this.state.layers.some(l => l.id === layerId)) {
      this.state.activeLayerId = layerId;
      this.notify();
    }
  }

  public createLayer(name?: string, colorHex?: string): Layer {
    const palette = ['#0d99ff', '#e63946', '#2a9d8f', '#f4a261', '#9d4edd', '#e9c46a', '#457b9d', '#e76f51'];
    const count = this.state.layers.length;
    const maxOrder = this.state.layers.reduce((max, l) => Math.max(max, l.order), -1);
    const newLayer: Layer = {
      id: `layer-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: name || `Layer ${count + 1}`,
      colorHex: colorHex || palette[count % palette.length],
      visible: true,
      locked: false,
      order: maxOrder + 1,
    };
    this.state.layers.push(newLayer);
    this.state.activeLayerId = newLayer.id;
    this.pushHistory();
    this.notify();
    return newLayer;
  }

  public updateLayer(layerId: string, updates: Partial<Layer>) {
    const layer = this.state.layers.find(l => l.id === layerId);
    if (layer) {
      Object.assign(layer, updates);
      this.pushHistory();
      this.notify();
    }
  }

  public deleteLayer(layerId: string): boolean {
    if (this.state.layers.length <= 1) return false;
    const idx = this.state.layers.findIndex(l => l.id === layerId);
    if (idx === -1) return false;

    this.state.layers.splice(idx, 1);
    if (this.state.activeLayerId === layerId) {
      this.state.activeLayerId = this.state.layers[0].id;
    }
    const targetLayerId = this.state.activeLayerId;

    // Migrate any elements in that layer to targetLayerId
    for (const spread of this.state.spreads) {
      for (const el of spread.elements) {
        if (el.layerId === layerId) {
          el.layerId = targetLayerId;
        }
      }
    }
    for (const master of this.state.masterSpreads || []) {
      for (const el of master.elements) {
        if (el.layerId === layerId) {
          el.layerId = targetLayerId;
        }
      }
    }

    this.pushHistory();
    this.notify();
    return true;
  }

  public reorderLayers(newLayerIds: string[]) {
    newLayerIds.forEach((id, idx) => {
      const layer = this.state.layers.find(l => l.id === id);
      if (layer) {
        layer.order = idx;
      }
    });
    this.state.layers.sort((a, b) => a.order - b.order);
    this.pushHistory();
    this.notify();
  }

  public setElementLayer(elementId: string, layerId: string) {
    if (!this.state.layers.some(l => l.id === layerId)) return;
    for (const spread of this.state.spreads) {
      const el = spread.elements.find(e => e.id === elementId);
      if (el) {
        el.layerId = layerId;
        this.pushHistory();
        this.notify();
        return;
      }
    }
    for (const master of this.state.masterSpreads || []) {
      const el = master.elements.find(e => e.id === elementId);
      if (el) {
        el.layerId = layerId;
        this.pushHistory();
        this.notify();
        return;
      }
    }
  }

  public getFootnotes(): Footnote[] {
    return this.state.settings.footnotes || [];
  }

  public getFootnotesForElement(elementId: string): Footnote[] {
    const fns = this.getFootnotes();
    const txtEl = this.getElementById(elementId) as TextElement | null;
    return fns.filter((fn) => {
      if (fn.elementId === elementId) return true;
      if (txtEl && txtEl.type === 'text') {
        const marker = numberToSuperscript(fn.number);
        return txtEl.text.includes(marker);
      }
      return false;
    });
  }

  public getElementById(elementId: string): CanvasElement | null {
    for (const spread of this.state.spreads) {
      const el = spread.elements.find((item) => item.id === elementId);
      if (el) return el;
    }
    for (const master of this.state.masterSpreads || []) {
      const el = master.elements.find((item) => item.id === elementId);
      if (el) return el;
    }
    return null;
  }

  public insertFootnote(elementId: string, footnoteText?: string): Footnote {
    const el = this.getElementById(elementId);
    if (!el || el.type !== 'text') {
      throw new Error(`Cannot insert footnote: element ${elementId} is not a valid text frame.`);
    }
    const txt = el as TextElement;
    const currentFns = this.getFootnotes();
    const nextNumber = currentFns.length + 1;
    const marker = numberToSuperscript(nextNumber);

    // Append marker to text, separating adjacent footnotes with a comma
    const lastChar = txt.text.slice(-1);
    const isAdjacent = Boolean(REVERSE_SUPERSCRIPTS[lastChar]);
    const separator = isAdjacent ? ',' : '';
    txt.text = txt.text + separator + marker;

    const newFn: Footnote = {
      id: `fn-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      number: nextNumber,
      text: footnoteText || 'Footnote description or citation.',
      elementId,
      pageId: txt.pageId,
    };

    if (!Array.isArray(this.state.settings.footnotes)) {
      this.state.settings.footnotes = [];
    }
    this.state.settings.footnotes.push(newFn);

    this.renumberFootnotes();
    this.pushHistory();
    this.notify();
    return newFn;
  }

  public updateFootnote(id: string, updates: Partial<Footnote>) {
    if (!Array.isArray(this.state.settings.footnotes)) return;
    const fn = this.state.settings.footnotes.find((f) => f.id === id);
    if (!fn) return;
    Object.assign(fn, updates);
    this.pushHistory();
    this.notify();
  }

  public deleteFootnote(id: string) {
    if (!Array.isArray(this.state.settings.footnotes)) return;
    const fn = this.state.settings.footnotes.find((f) => f.id === id);
    if (!fn) return;

    if (fn.elementId) {
      const el = this.getElementById(fn.elementId) as TextElement | null;
      if (el && el.type === 'text') {
        const marker = numberToSuperscript(fn.number);
        el.text = el.text.replace(new RegExp(`,?${marker}|${marker},?`), '');
      }
    }

    this.state.settings.footnotes = this.state.settings.footnotes.filter((f) => f.id !== id);
    this.renumberFootnotes();
    this.pushHistory();
    this.notify();
  }

  public renumberFootnotes() {
    if (!Array.isArray(this.state.settings.footnotes) || this.state.settings.footnotes.length === 0) return;

    const textElements: TextElement[] = [];
    for (const spread of this.state.spreads) {
      const sorted = [...spread.elements]
        .filter((e) => e.type === 'text')
        .sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x) as TextElement[];
      textElements.push(...sorted);
    }

    const markerRegex = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
    let sequenceNumber = 1;
    const updatedFns: Footnote[] = [];
    const claimedFnIds = new Set<string>();

    for (const el of textElements) {
      const matches = Array.from(el.text.matchAll(markerRegex));
      if (matches.length === 0) continue;

      let newText = '';
      let lastIndex = 0;
      for (const match of matches) {
        const oldMarker = match[0];
        const oldNumber = superscriptToNumber(oldMarker);
        const matchIndex = match.index!;

        newText += el.text.slice(lastIndex, matchIndex);
        lastIndex = matchIndex + oldMarker.length;

        let matchedFn = this.state.settings.footnotes.find((f) => !claimedFnIds.has(f.id) && f.number === oldNumber);
        if (!matchedFn) {
          matchedFn = this.state.settings.footnotes.find((f) => !claimedFnIds.has(f.id) && f.elementId === el.id);
        }
        if (!matchedFn) {
          matchedFn = this.state.settings.footnotes.find((f) => !claimedFnIds.has(f.id));
        }

        const newMarker = numberToSuperscript(sequenceNumber);
        newText += newMarker;

        if (matchedFn) {
          claimedFnIds.add(matchedFn.id);
          matchedFn.number = sequenceNumber;
          matchedFn.elementId = el.id;
          matchedFn.pageId = el.pageId;
          updatedFns.push(matchedFn);
        }
        sequenceNumber++;
      }
      newText += el.text.slice(lastIndex);
      el.text = newText;
    }

    for (const fn of this.state.settings.footnotes) {
      if (!claimedFnIds.has(fn.id)) {
        fn.number = sequenceNumber++;
        updatedFns.push(fn);
      }
    }

    updatedFns.sort((a, b) => a.number - b.number);
    this.state.settings.footnotes = updatedFns;
  }

  public updateFootnoteSettings(updates: Partial<FootnoteSettings>) {
    this.state.settings.footnoteSettings = {
      ...(this.state.settings.footnoteSettings || {
        numberingStyle: 'superscript',
        separatorRuleWidthMm: 30,
        separatorRuleThicknessPt: 0.5,
        fontSizePt: 8,
        scope: 'document',
      }),
      ...updates,
    };
    this.pushHistory();
    this.notify();
  }

  public copyfitTextFrame(elementId: string): CopyfitResult {
    const el = this.getElementById(elementId);
    if (!el || el.type !== 'text') {
      throw new Error(`Cannot copyfit element: ${elementId} is not a valid text element`);
    }
    const txt = el as TextElement;
    const adjustments: string[] = [];
    let orphansFixed = 0;
    let trackingAdjustedPt = 0;
    let lineHeightAdjusted = 0;
    let fontSizeAdjustedPt = 0;

    // 1. Orphan Buster: Prevent 1-2 word orphan lines by replacing the space before the last word with a non-breaking space
    const paragraphs = txt.text.split('\n');
    let textModified = false;
    const newParagraphs = paragraphs.map((para) => {
      const trimmed = para.trimEnd();
      if (!trimmed) return para;
      const words = trimmed.split(/\s+/);
      if (words.length >= 3) {
        // Find last space in paragraph
        const lastSpace = para.lastIndexOf(' ');
        if (lastSpace !== -1 && lastSpace > 0) {
          orphansFixed++;
          textModified = true;
          return para.substring(0, lastSpace) + '\u00A0' + para.substring(lastSpace + 1);
        }
      }
      return para;
    });

    if (textModified && orphansFixed > 0) {
      txt.text = newParagraphs.join('\n');
      adjustments.push(`Bound ${orphansFixed} orphan word(s) with non-breaking spaces`);
    }

    // 2. Overflow / Rogue Line Buster:
    const paddingMm = txt.paddingMm || 2;
    const availHeightMm = Math.max(10, txt.height - (paddingMm * 2));
    const currentLineHeight = txt.lineHeight || 1.3;
    const currentFontSizePt = txt.fontSizePt || 12;
    const lineSpacingMm = (currentFontSizePt * 25.4 / 72) * currentLineHeight;
    const linesPerCol = Math.floor(availHeightMm / lineSpacingMm);
    const cols = Math.max(1, txt.columns || 1);
    const totalLineCapacity = linesPerCol * cols;

    // Estimate line count from text length and column width
    const availWidthMm = Math.max(20, (txt.width - (paddingMm * 2) - ((cols - 1) * (txt.columnGutterMm || 4))) / cols);
    const avgCharWidthMm = currentFontSizePt * 0.17;
    const charsPerLine = Math.max(15, Math.floor(availWidthMm / avgCharWidthMm));

    let estLines = 0;
    for (const p of txt.text.split('\n')) {
      const len = p.trim().length;
      if (len === 0) estLines += 1;
      else estLines += Math.max(1, Math.ceil(len / charsPerLine));
    }

    // If estimated lines exceed or near capacity (overflow or tight boundary)
    if (estLines >= totalLineCapacity) {
      // 1. Micro-tracking compression (down to -0.4pt threshold)
      const curTracking = txt.letterSpacingPt || 0;
      if (curTracking > -0.4) {
        const newTracking = Math.round((Math.max(-0.4, curTracking - 0.2)) * 100) / 100;
        trackingAdjustedPt = Math.round((newTracking - curTracking) * 100) / 100;
        txt.letterSpacingPt = newTracking;
        adjustments.push(`Tightened tracking by ${trackingAdjustedPt}pt (${newTracking}pt)`);
      }

      // 2. Micro-leading reduction (minimum 1.15 baseline multiplier)
      if (currentLineHeight > 1.15 && estLines > totalLineCapacity) {
        const newLineHeight = Math.round((Math.max(1.15, currentLineHeight - 0.05)) * 100) / 100;
        lineHeightAdjusted = Math.round((newLineHeight - currentLineHeight) * 100) / 100;
        txt.lineHeight = newLineHeight;
        adjustments.push(`Tightened leading by ${lineHeightAdjusted} (${newLineHeight})`);
      }

      // 3. Proportional glyph scale fallback for multi-line overflow
      if (currentFontSizePt > 6 && estLines > totalLineCapacity + 1) {
        const newFontSize = Math.round((Math.max(6, currentFontSizePt - 0.5)) * 10) / 10;
        fontSizeAdjustedPt = Math.round((newFontSize - currentFontSizePt) * 10) / 10;
        txt.fontSizePt = newFontSize;
        adjustments.push(`Micro-scaled font size by ${fontSizeAdjustedPt}pt (${newFontSize}pt)`);
      }
    }

    if (adjustments.length > 0) {
      this.pushHistory();
      this.notify();
    }

    return {
      success: true,
      elementId,
      orphansFixed,
      trackingAdjustedPt,
      lineHeightAdjusted,
      fontSizeAdjustedPt,
      adjustments,
    };
  }

  /**
   * Evaluates GREP / regex style rules against text for automated character-level formatting
   */
  public evaluateGrepStyles(text: string, styleId?: string): GrepMatch[] {
    if (!text || !styleId) return [];
    const style = this.state.paragraphStyles.find((s) => s.id === styleId);
    if (!style || !style.grepStyles || style.grepStyles.length === 0) return [];

    const matches: GrepMatch[] = [];
    for (const rule of style.grepStyles) {
      try {
        const regex = new RegExp(rule.pattern, 'g');
        let m: RegExpExecArray | null;
        while ((m = regex.exec(text)) !== null) {
          matches.push({
            start: m.index,
            end: m.index + m[0].length,
            text: m[0],
            rule,
          });
          if (m.index === regex.lastIndex) {
            regex.lastIndex++;
          }
        }
      } catch {
        // Skip invalid regex gracefully
      }
    }
    return matches.sort((a, b) => a.start - b.start);
  }

  public addGrepStyleRule(styleId: string, rule: Omit<GrepStyleRule, 'id'>) {
    const style = this.state.paragraphStyles.find((s) => s.id === styleId);
    if (!style) return;
    if (!style.grepStyles) style.grepStyles = [];
    const newRule: GrepStyleRule = {
      id: `grep-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      ...rule,
    };
    style.grepStyles.push(newRule);
    this.pushHistory();
    this.notify();
  }

  public removeGrepStyleRule(styleId: string, ruleId: string) {
    const style = this.state.paragraphStyles.find((s) => s.id === styleId);
    if (!style || !style.grepStyles) return;
    style.grepStyles = style.grepStyles.filter((r) => r.id !== ruleId);
    this.pushHistory();
    this.notify();
  }

  public updateGrepStyleRule(styleId: string, ruleId: string, partial: Partial<GrepStyleRule>) {
    const style = this.state.paragraphStyles.find((s) => s.id === styleId);
    if (!style || !style.grepStyles) return;
    const rule = style.grepStyles.find((r) => r.id === ruleId);
    if (!rule) return;
    Object.assign(rule, partial);
    this.pushHistory();
    this.notify();
  }


  /**
   * Generates a structured Table of Contents (TOC) with dot leaders and page numbers
   * by scanning headings across all document spreads.
   */
  public generateTableOfContents(targetPageId?: string, dotLeaderChar: string = '.'): {
    tocText: string;
    entries: TocEntry[];
    elementId?: string;
  } {
    const entries: TocEntry[] = [];
    let currentPageNumber = 1;

    for (const spread of this.state.spreads) {
      for (const page of spread.pages) {
        const pageElements = spread.elements.filter((el) => el.pageId === page.id && el.type === 'text');
        const sortedTextElements = [...pageElements].sort((a, b) => a.y - b.y);

        for (const el of sortedTextElements) {
          const txtEl = el as TextElement;
          const style = this.state.paragraphStyles.find((s) => s.id === txtEl.paragraphStyleId);
          const isH1 = style?.pdfTag === 'H1' || txtEl.paragraphStyleId === 'style-h1' || (style?.name && style.name.toLowerCase().includes('headline'));
          const isH2 = style?.pdfTag === 'H2' || txtEl.paragraphStyleId === 'style-h2' || (style?.name && style.name.toLowerCase().includes('header 2'));
          const isTitle = style?.pdfTag === 'Title' || txtEl.paragraphStyleId === 'style-title' || (txtEl.fontSizePt !== undefined && txtEl.fontSizePt >= 24);

          if (isH1 || isH2 || isTitle) {
            const firstLine = txtEl.text.split('\n')[0].trim();
            if (firstLine.length > 0) {
              entries.push({
                title: firstLine,
                pageNumber: currentPageNumber,
                level: isH2 ? 2 : 1,
                elementId: txtEl.id,
              });
            }
          }
        }
        currentPageNumber++;
      }
    }

    const lineWidthChars = 44;
    const lines = entries.map((entry) => {
      const indent = entry.level > 1 ? '  ' : '';
      const prefix = `${indent}${entry.title} `;
      const suffix = ` ${entry.pageNumber}`;
      const dotsNeeded = Math.max(3, lineWidthChars - prefix.length - suffix.length);
      const dots = dotLeaderChar.repeat(dotsNeeded);
      return `${prefix}${dots}${suffix}`;
    });

    const tocText = lines.join('\n');

    let createdElementId: string | undefined;
    if (targetPageId) {
      createdElementId = `toc-${Date.now()}`;
      const tocElement: TextElement = {
        id: createdElementId,
        type: 'text',
        pageId: targetPageId,
        x: 20,
        y: 25,
        width: 170,
        height: Math.max(40, lines.length * 10 + 20),
        rotation: 0,
        opacity: 1,
        zIndex: 10,
        locked: false,
        text: `TABLE OF CONTENTS\n\n${tocText}`,
        fontFamily: 'Merriweather, Georgia, serif',
        fontSizePt: 10,
        lineHeight: 1.6,
        letterSpacingPt: 0,
        color: '#1a1a1a',
        alignment: 'left',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 4,
        paragraphStyleId: 'style-body',
      };
      this.addElement(tocElement);
    }

    return { tocText, entries, elementId: createdElementId };
  }

  /**
   * Multi-line Paragraph Composer (Knuth-Plass / line balancing heuristic):
   * Balances line lengths across a paragraph to eliminate rag and awkward lone words.
   */
  public balanceParagraphLines(elementId: string, options?: ComposerOptions): boolean {
    const el = this.getElementById(elementId);
    if (!el || el.type !== 'text') return false;
    const txt = el as TextElement;
    const paragraphs = txt.text.split('\n');
    let modified = false;

    const composer = new KnuthPlassComposer(options);
    const charWidthPt = (txt.fontSizePt * 0.55);
    const measureWidth = (str: string) => str.length * charWidthPt;
    const padding = (txt.paddingMm || 2);
    const availWidthPt = ((txt.width - (padding * 2)) / 25.4) * 72;

    const balancedParagraphs = paragraphs.map((para) => {
      const words = para.trim().split(/\s+/);
      if (words.length < 5) return para;

      const items = composer.tokenize(para, measureWidth);
      const targetLineWidth = Math.max(availWidthPt, charWidthPt * 20);
      const lines = composer.breakLines(items, targetLineWidth);
      if (lines.length > 1) {
        modified = true;
        return lines.map(l => l.text).join('\n');
      }
      return para;
    });

    if (modified) {
      txt.text = balancedParagraphs.join('\n');
      this.pushHistory();
      this.notify();
    }
    return modified;
  }

  /**
   * Loads a binary Adobe Photoshop PSD buffer into an ImageElement without flattening.
   */
  public loadPsdForElement(elementId: string, psdBuffer: ArrayBuffer | Uint8Array, fileName?: string): boolean {
    const el = this.getElementById(elementId);
    if (!el || el.type !== 'image') return false;
    const img = el as ImageElement;

    const psdData = psdEngine.parse(psdBuffer);
    img.isPsd = true;
    img.format = 'PSD';
    img.name = fileName || img.name || 'document.psd';
    img.originalWidth = psdData.width;
    img.originalHeight = psdData.height;
    img.psdLayers = psdData.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      left: l.left,
      top: l.top,
      width: l.width,
      height: l.height,
    }));
    img.activePsdLayerIds = psdData.layers.filter((l) => l.visible).map((l) => l.id);
    if (psdData.compositeDataUrl) {
      img.src = psdData.compositeDataUrl;
    }

    this.pushHistory();
    this.notify();
    return true;
  }

  /**
   * Toggles visibility of a specific Photoshop layer in an ImageElement.
   */
  public togglePsdLayer(elementId: string, layerId: number, visible?: boolean): boolean {
    const el = this.getElementById(elementId);
    if (!el || el.type !== 'image') return false;
    const img = el as ImageElement;
    if (!img.isPsd || !img.psdLayers) return false;

    const layer = img.psdLayers.find((l) => l.id === layerId);
    if (!layer) return false;

    layer.visible = typeof visible === 'boolean' ? visible : !layer.visible;
    if (layer.visible) {
      if (!img.activePsdLayerIds) img.activePsdLayerIds = [];
      if (!img.activePsdLayerIds.includes(layerId)) {
        img.activePsdLayerIds.push(layerId);
      }
    } else {
      img.activePsdLayerIds = (img.activePsdLayerIds || []).filter((id) => id !== layerId);
    }

    this.pushHistory();
    this.notify();
    return true;
  }

  /**
   * Compiles a RegExp for Find/Change search queries.
   */
  public compileFindRegex(query: FindChangeQuery): RegExp | null {
    if (!query.findText) return null;
    try {
      if (query.isGrep) {
        const flags = 'g' + (query.caseSensitive ? '' : 'i');
        return new RegExp(query.findText, flags);
      } else {
        let pattern = query.findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (query.wholeWord) {
          pattern = `\\b${pattern}\\b`;
        }
        const flags = 'g' + (query.caseSensitive ? '' : 'i');
        return new RegExp(pattern, flags);
      }
    } catch {
      return null;
    }
  }

  /**
   * Collects all text matches matching the query across the specified scope.
   */
  public collectFindMatches(query: FindChangeQuery): { elementId: string; spreadIndex: number; matchText: string; index: number; length: number }[] {
    const regex = this.compileFindRegex(query);
    if (!regex) return [];

    const matches: { elementId: string; spreadIndex: number; matchText: string; index: number; length: number }[] = [];
    const scope = query.scope || 'document';

    let targetSpreads: { spread: Spread; index: number }[] = [];
    if (scope === 'spread') {
      targetSpreads = [{ spread: this.getActiveSpread(), index: this.state.activeSpreadIndex }];
    } else if (scope === 'story') {
      const activeEl = this.state.selectedElementId ? this.getElementById(this.state.selectedElementId) : null;
      if (activeEl && activeEl.type === 'text') {
        const textEl = activeEl as TextElement;
        const chain: TextElement[] = [];
        let head: TextElement = textEl;
        while (head.prevFrameId) {
          const prev = this.getElementById(head.prevFrameId) as TextElement | undefined;
          if (!prev) break;
          head = prev;
        }
        let curr: TextElement | undefined = head;
        while (curr) {
          chain.push(curr);
          curr = curr.nextFrameId ? (this.getElementById(curr.nextFrameId) as TextElement | undefined) : undefined;
        }
        for (const el of chain) {
          const spIdx = this.state.spreads.findIndex((s) => s.elements.some((e) => e.id === el.id));
          const text = el.text || '';
          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(text)) !== null) {
            matches.push({
              elementId: el.id,
              spreadIndex: spIdx !== -1 ? spIdx : this.state.activeSpreadIndex,
              matchText: m[0],
              index: m.index,
              length: m[0].length,
            });
            if (m.index === regex.lastIndex) regex.lastIndex++;
          }
        }
        return matches;
      } else {
        targetSpreads = [{ spread: this.getActiveSpread(), index: this.state.activeSpreadIndex }];
      }
    } else {
      targetSpreads = this.state.spreads.map((s, i) => ({ spread: s, index: i }));
    }

    for (const { spread, index } of targetSpreads) {
      for (const el of spread.elements) {
        if (el.type === 'text') {
          const textEl = el as TextElement;
          const text = textEl.text || '';
          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(text)) !== null) {
            matches.push({
              elementId: el.id,
              spreadIndex: index,
              matchText: m[0],
              index: m.index,
              length: m[0].length,
            });
            if (m.index === regex.lastIndex) regex.lastIndex++;
          }
        }
      }
    }

    return matches;
  }

  /**
   * Finds the next match and focuses/selects the element.
   */
  public findNext(
    query: FindChangeQuery,
    afterElementId?: string,
    afterIndex?: number
  ): FindResult | null {
    const matches = this.collectFindMatches(query);
    if (matches.length === 0) return null;

    let targetIdx = 0;
    if (afterElementId !== undefined && afterIndex !== undefined) {
      const foundIdx = matches.findIndex(
        (m) =>
          (m.elementId === afterElementId && m.index > afterIndex) ||
          (m.elementId !== afterElementId && matches.indexOf(m) > matches.findIndex((x) => x.elementId === afterElementId && x.index === afterIndex))
      );
      if (foundIdx !== -1) {
        targetIdx = foundIdx;
      }
    }

    const chosen = matches[targetIdx];
    if (chosen.spreadIndex !== this.state.activeSpreadIndex) {
      this.setActiveSpread(chosen.spreadIndex);
    }
    this.selectElement(chosen.elementId);

    return {
      ...chosen,
      totalMatches: matches.length,
      currentMatchIndex: targetIdx + 1,
    };
  }

  /**
   * Replaces a specific match instance.
   */
  public change(
    query: FindChangeQuery,
    targetMatch: { elementId: string; index: number; length: number; matchText?: string }
  ): boolean {
    const el = this.getElementById(targetMatch.elementId);
    if (!el || el.type !== 'text') return false;

    const textEl = el as TextElement;
    const currentText = textEl.text || '';
    if (targetMatch.index < 0 || targetMatch.index + targetMatch.length > currentText.length) {
      return false;
    }

    let replacement = query.changeText;
    if (query.isGrep && targetMatch.matchText) {
      const regex = this.compileFindRegex(query);
      if (regex) {
        replacement = targetMatch.matchText.replace(regex, query.changeText);
      }
    }

    const newText =
      currentText.slice(0, targetMatch.index) +
      replacement +
      currentText.slice(targetMatch.index + targetMatch.length);

    this.updateElement(targetMatch.elementId, { text: newText });
    return true;
  }

  /**
   * Batch replaces all occurrences matching the query in scope.
   */
  public changeAll(query: FindChangeQuery): { replacementsCount: number; elementsAffected: number } {
    const regex = this.compileFindRegex(query);
    if (!regex) return { replacementsCount: 0, elementsAffected: 0 };

    const matches = this.collectFindMatches(query);
    if (matches.length === 0) return { replacementsCount: 0, elementsAffected: 0 };

    const elMap = new Map<string, typeof matches>();
    for (const m of matches) {
      if (!elMap.has(m.elementId)) elMap.set(m.elementId, []);
      elMap.get(m.elementId)!.push(m);
    }

    let replacementsCount = 0;
    const elementsAffected = elMap.size;

    for (const [elId] of elMap.entries()) {
      const el = this.getElementById(elId);
      if (el && el.type === 'text') {
        const textEl = el as TextElement;
        const oldText = textEl.text || '';
        regex.lastIndex = 0;
        let countForEl = 0;
        const newText = oldText.replace(regex, (...args) => {
          countForEl++;
          if (query.isGrep) {
            return query.changeText.replace(/\$(\d+)/g, (_, group) => args[parseInt(group, 10)] || '');
          }
          return query.changeText;
        });
        replacementsCount += countForEl;
        textEl.text = newText;
      }
    }

    if (replacementsCount > 0) {
      this.pushHistory();
      this.notify();
    }

    return { replacementsCount, elementsAffected };
  }

  // --- Object Styles Engine ---
  public createObjectStyle(style: Omit<ObjectStyle, 'id'> & { id?: string }): ObjectStyle {
    const newStyle: ObjectStyle = {
      ...style,
      id: style.id || `obj-style-${Date.now()}`,
    };
    if (!this.state.objectStyles) this.state.objectStyles = [...DEFAULT_OBJECT_STYLES];
    this.state.objectStyles.push(newStyle);
    this.pushHistory();
    this.notify();
    return newStyle;
  }

  public applyObjectStyle(elementId: string, styleId: string): void {
    const el = this.getElementById(elementId);
    if (!el) return;
    const styles = this.state.objectStyles || DEFAULT_OBJECT_STYLES;
    const style = styles.find(s => s.id === styleId);
    if (!style) return;

    const updates: Partial<CanvasElement> = {
      objectStyleId: styleId,
    };
    if (style.backgroundColor !== undefined && 'backgroundColor' in el) {
      (updates as any).backgroundColor = style.backgroundColor;
    }
    if (style.borderColor !== undefined && 'borderColor' in el) {
      (updates as any).borderColor = style.borderColor;
    }
    if (style.borderWidthMm !== undefined && 'borderWidthMm' in el) {
      (updates as any).borderWidthMm = style.borderWidthMm;
    }
    if (style.paddingMm !== undefined && 'paddingMm' in el) {
      (updates as any).paddingMm = style.paddingMm;
    }
    if (style.shadow !== undefined) {
      updates.shadow = { ...style.shadow };
    }
    if (style.textWrap !== undefined) {
      updates.textWrap = { ...style.textWrap };
    }
    this.updateElement(elementId, updates);
  }

  public updateObjectStyle(styleId: string, updates: Partial<ObjectStyle>): void {
    if (!this.state.objectStyles) this.state.objectStyles = [...DEFAULT_OBJECT_STYLES];
    const idx = this.state.objectStyles.findIndex(s => s.id === styleId);
    if (idx === -1) return;
    this.state.objectStyles[idx] = { ...this.state.objectStyles[idx], ...updates };

    // Cascade updates to all elements with this styleId
    for (const spread of this.state.spreads) {
      for (const el of spread.elements) {
        if (el.objectStyleId === styleId) {
          if (updates.backgroundColor !== undefined && 'backgroundColor' in el) {
            (el as any).backgroundColor = updates.backgroundColor;
          }
          if (updates.borderColor !== undefined && 'borderColor' in el) {
            (el as any).borderColor = updates.borderColor;
          }
          if (updates.borderWidthMm !== undefined && 'borderWidthMm' in el) {
            (el as any).borderWidthMm = updates.borderWidthMm;
          }
          if (updates.paddingMm !== undefined && 'paddingMm' in el) {
            (el as any).paddingMm = updates.paddingMm;
          }
          if (updates.shadow !== undefined) {
            el.shadow = { ...updates.shadow };
          }
          if (updates.textWrap !== undefined) {
            el.textWrap = { ...updates.textWrap };
          }
        }
      }
    }
    this.pushHistory();
    this.notify();
  }

  public deleteObjectStyle(styleId: string): void {
    if (!this.state.objectStyles) return;
    this.state.objectStyles = this.state.objectStyles.filter(s => s.id !== styleId);
    for (const spread of this.state.spreads) {
      for (const el of spread.elements) {
        if (el.objectStyleId === styleId) {
          delete el.objectStyleId;
        }
      }
    }
    this.pushHistory();
    this.notify();
  }

  // --- Dynamic Cross-References (Xrefs) ---
  public addCrossReference(targetElementId: string, label?: string): CrossReference {
    if (!this.state.crossReferences) this.state.crossReferences = [];
    const xref: CrossReference = {
      id: `xref-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      targetElementId,
      label,
    };
    this.state.crossReferences.push(xref);
    this.pushHistory();
    this.notify();
    return xref;
  }

  public findTargetPageForElement(elementId: string): number | null {
    let pageCounter = 1;
    for (const spread of this.state.spreads) {
      for (const page of spread.pages) {
        const match = spread.elements.find(el => el.id === elementId && el.pageId === page.id);
        if (match) return pageCounter;
        pageCounter++;
      }
    }
    // Fallback spread search
    let fallbackCounter = 1;
    for (const spread of this.state.spreads) {
      if (spread.elements.some(el => el.id === elementId)) {
        return fallbackCounter;
      }
      fallbackCounter += spread.pages.length || 1;
    }
    return null;
  }

  public resolveCrossReferences(text: string): string {
    if (!text || !text.includes('{xref:')) return text;
    return text.replace(/\{xref:([^}]+)\}/g, (_, targetId) => {
      const pageNum = this.findTargetPageForElement(targetId.trim());
      return pageNum !== null ? `${pageNum}` : `[#?]`;
    });
  }

  // --- Multi-Level Book Index Generator ---
  public addIndexEntry(topic: string, subtopic?: string, pageNumber?: number, elementId?: string): IndexEntry {
    if (!this.state.indexEntries) this.state.indexEntries = [];
    const entry: IndexEntry = {
      id: `idx-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      topic,
      subtopic,
      pageNumber: pageNumber || 1,
      elementId,
    };
    this.state.indexEntries.push(entry);
    this.pushHistory();
    this.notify();
    return entry;
  }

  public scanDocumentForIndexEntries(): IndexEntry[] {
    const entries: IndexEntry[] = [];
    let pageCounter = 1;
    const regex = /\{index:([^}]+)\}/g;

    for (const spread of this.state.spreads) {
      for (const page of spread.pages) {
        const pageElements = spread.elements.filter(el => el.pageId === page.id && el.type === 'text') as TextElement[];
        for (const el of pageElements) {
          const text = el.text || '';
          let match: RegExpExecArray | null;
          regex.lastIndex = 0;
          while ((match = regex.exec(text)) !== null) {
            const raw = match[1].trim();
            const parts = raw.split(':').map(p => p.trim());
            const topic = parts[0];
            const subtopic = parts[1] || undefined;
            entries.push({
              id: `idx-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              topic,
              subtopic,
              pageNumber: pageCounter,
              elementId: el.id,
            });
          }
        }
        pageCounter++;
      }
    }
    if (this.state.indexEntries && this.state.indexEntries.length > 0) {
      entries.push(...this.state.indexEntries);
    }
    return entries;
  }

  public generateBookIndex(): { letter: string; entries: { topic: string; subtopics: { subtopic: string; pages: number[] }[]; pages: number[] }[] }[] {
    const scanned = this.scanDocumentForIndexEntries();
    const topicMap = new Map<string, { topic: string; pages: Set<number>; subtopics: Map<string, Set<number>> }>();

    for (const entry of scanned) {
      if (!topicMap.has(entry.topic)) {
        topicMap.set(entry.topic, {
          topic: entry.topic,
          pages: new Set(),
          subtopics: new Map(),
        });
      }
      const item = topicMap.get(entry.topic)!;
      if (entry.subtopic) {
        if (!item.subtopics.has(entry.subtopic)) {
          item.subtopics.set(entry.subtopic, new Set());
        }
        item.subtopics.get(entry.subtopic)!.add(entry.pageNumber);
      } else {
        item.pages.add(entry.pageNumber);
      }
    }

    const letterMap = new Map<string, any[]>();
    const sortedTopics = Array.from(topicMap.keys()).sort((a, b) => a.localeCompare(b));

    for (const topic of sortedTopics) {
      const data = topicMap.get(topic)!;
      const initial = (topic[0] || '#').toUpperCase();
      if (!letterMap.has(initial)) {
        letterMap.set(initial, []);
      }
      const subtopics = Array.from(data.subtopics.entries())
        .map(([sub, pageSet]) => ({
          subtopic: sub,
          pages: Array.from(pageSet).sort((a, b) => a - b),
        }))
        .sort((a, b) => a.subtopic.localeCompare(b.subtopic));

      letterMap.get(initial)!.push({
        topic,
        pages: Array.from(data.pages).sort((a, b) => a - b),
        subtopics,
      });
    }

    const sortedLetters = Array.from(letterMap.keys()).sort();
    return sortedLetters.map(letter => ({
      letter,
      entries: letterMap.get(letter)!,
    }));
  }

  public insertIndexStory(targetSpreadIndex?: number): TextElement {
    const indexData = this.generateBookIndex();
    const lines: string[] = ['INDEX\n'];

    for (const group of indexData) {
      lines.push(`\n[ ${group.letter} ]`);
      for (const ent of group.entries) {
        const pageStr = ent.pages.length > 0 ? `, ${ent.pages.join(', ')}` : '';
        lines.push(`${ent.topic}${pageStr}`);
        for (const sub of ent.subtopics) {
          lines.push(`   ${sub.subtopic}, ${sub.pages.join(', ')}`);
        }
      }
    }

    const targetSpread = targetSpreadIndex !== undefined && this.state.spreads[targetSpreadIndex]
      ? this.state.spreads[targetSpreadIndex]
      : this.getActiveSpread();

    const page = targetSpread.pages[0];
    const newIndexEl: TextElement = {
      id: `index-story-${Date.now()}`,
      name: 'Book Index Frame',
      type: 'text',
      pageId: page.id,
      x: this.state.settings.margins.insideMm || 20,
      y: this.state.settings.margins.topMm || 20,
      width: (this.state.settings.widthMm || 210) - ((this.state.settings.margins.insideMm || 20) + (this.state.settings.margins.outsideMm || 20)),
      height: (this.state.settings.heightMm || 297) - ((this.state.settings.margins.topMm || 20) + (this.state.settings.margins.bottomMm || 20)),
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      locked: false,
      text: lines.join('\n'),
      fontFamily: 'serif',
      fontSizePt: 9,
      lineHeight: 1.35,
      letterSpacingPt: 0,
      color: '#111827',
      alignment: 'left',
      columns: 2,
      columnGutterMm: 6,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidthMm: 0,
      paddingMm: 2,
    };

    this.addElement(newIndexEl);
    return newIndexEl;
  }

  // --- Span Columns & Interactive PDF AcroForm Fields ---
  public setSpanColumns(elementId: string, spanColumns: boolean): void {
    this.updateElement(elementId, { spanColumns });
  }

  public setInteractiveField(elementId: string, interactiveField: CanvasElement['interactiveField']): void {
    this.updateElement(elementId, { interactiveField });
  }

  // --- Native Vector QR Code Generator ---
  public insertQrCode(text: string, options?: { sizeMm?: number; pageId?: string }): ImageElement {
    const size = options?.sizeMm || 30;
    const spread = this.getActiveSpread();
    const page = options?.pageId
      ? spread.pages.find((p) => p.id === options.pageId) || spread.pages[0]
      : spread.pages[0];

    const dataUrl = generateQrDataUrl(text, size);
    const qrEl: ImageElement = {
      id: `qr-${Date.now()}`,
      name: `QR Code (${text.slice(0, 15)})`,
      type: 'image',
      pageId: page.id,
      x: 20,
      y: 20,
      width: size,
      height: size,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      locked: false,
      src: dataUrl,
      fitMode: 'fit',
      borderColor: 'transparent',
      borderWidthMm: 0,
    };

    this.addElement(qrEl);
    return qrEl;
  }

  // --- Anchored Objects (Inline & Flowing Graphics) ---
  public anchorElementToText(childElementId: string, parentTextId: string, options?: { mode?: 'inline' | 'aboveLine'; offsetYMm?: number }): void {
    const child = this.getElementById(childElementId);
    const parent = this.getElementById(parentTextId);
    if (!child || !parent || parent.type !== 'text') return;

    const anchor: AnchoredObjectSettings = {
      parentTextId,
      mode: options?.mode || 'inline',
      offsetYMm: options?.offsetYMm || 2,
    };

    this.updateElement(childElementId, {
      anchor,
      x: parent.x,
      y: parent.y + parent.height + (options?.offsetYMm || 2),
    });
  }

  public unanchorElement(childElementId: string): void {
    const child = this.getElementById(childElementId);
    if (!child || !child.anchor) return;
    delete child.anchor;
    this.pushHistory();
    this.notify();
  }

  public updateAnchoredPositions(parentTextId: string): void {
    const parent = this.getElementById(parentTextId);
    if (!parent) return;

    for (const spread of this.state.spreads) {
      let offsetAccumulator = 0;
      for (const el of spread.elements) {
        if (el.anchor?.parentTextId === parentTextId) {
          offsetAccumulator += (el.anchor.offsetYMm || 2);
          el.x = parent.x;
          el.y = parent.y + parent.height + offsetAccumulator;
          offsetAccumulator += el.height;
        }
      }
    }
  }

  // --- Split Columns & Nested / Line Styles ---
  public setSplitColumns(elementId: string, splitColumns: number): void {
    this.updateElement(elementId, { splitColumns: Math.max(1, splitColumns) });
  }

  // --- Conditional Text Engine ---
  public addCondition(name: string, colorHex?: string): ConditionTag {
    if (!this.state.conditions) this.state.conditions = [...DEFAULT_CONDITIONS];
    const cond: ConditionTag = {
      id: `cond-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name,
      visible: true,
      colorHex: colorHex || '#10b981',
    };
    this.state.conditions.push(cond);
    this.pushHistory();
    this.notify();
    return cond;
  }

  public toggleCondition(conditionId: string): void {
    if (!this.state.conditions) return;
    const cond = this.state.conditions.find(c => c.id === conditionId);
    if (!cond) return;
    cond.visible = !cond.visible;
    this.pushHistory();
    this.notify();
  }

  public evaluateConditions(text: string): string {
    if (!text || !text.includes('{cond:')) return text;
    const conditions = this.state.conditions || DEFAULT_CONDITIONS;
    const hiddenSet = new Set(
      conditions.filter(c => !c.visible).map(c => c.name.toLowerCase())
    );

    return text.replace(/\{cond:([^}]+)\}([\s\S]*?)\{\/cond\}/g, (_, tag, content) => {
      const cleanTag = tag.trim().toLowerCase();
      if (hiddenSet.has(cleanTag)) {
        return '';
      }
      return content;
    });
  }

  /**
   * Generates and assigns an organic alpha silhouette contour to an image element for contour text wrapping.
   */
  public setElementAlphaContour(elementId: string, contour: Array<{ minX: number; maxX: number }>): void {
    const el = this.getElementById(elementId);
    if (!el || el.type !== 'image') return;
    this.updateElement(elementId, {
      alphaContour: contour,
      textWrap: {
        mode: 'contour',
        standoffMm: el.textWrap?.standoffMm ?? 3,
      },
    });
  }

  /**
   * Audits a color against target ICC profile printing limits (TAC and gamut clipping).
   */
  public auditColorGamut(hexColor: string, profile?: IccProfileName): GamutAuditResult {
    const prof = profile || (this.state.settings.iccProfile as IccProfileName) || 'FOGRA39';
    return colorEngine.auditColorGamut(hexColor, prof);
  }

  /**
   * Generates a soft-proof simulated color for on-screen preview.
   */
  public softProofColor(hexColor: string, profile?: IccProfileName): string {
    const prof = profile || (this.state.settings.iccProfile as IccProfileName) || 'FOGRA39';
    return colorEngine.softProof(hexColor, prof);
  }

  private saveSnapshotsToStorage() {
    try {
      localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(this.snapshots));
    } catch {}
  }

  private loadSnapshotsFromStorage(): VersionSnapshot[] {
    try {
      const data = localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }
}

export const stateManager = new StateManager();
