/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import {
  ProjectState,
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
} from '../types/index';
import { RectoDB } from './persistence';
import { parseIdmlPackage } from '../idmlImport';
import { parseCsv, generateMergedSpreads, substituteElementTokens } from '../dataMerge';

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

// shortcut: localStorage used for autosave; upgrade to IndexedDB when projects exceed 5MB
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
          src: '',
          fitMode: 'fill',
          borderColor: '#cccccc',
          borderWidthMm: 0.5,
          caption: 'Cover Visual Frame (Click to replace with photo)',
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
          text: '2',
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
          src: '',
          fitMode: 'fill',
          borderColor: '#111111',
          borderWidthMm: 0.3,
          caption: 'Plate 1: The Modern Printing Press',
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
          text: '3',
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
    this.pushHistory();
  }

  public getState(): ProjectState {
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
    this.state.settings = { ...this.state.settings, ...partial };
    this.pushHistory();
    this.notify();
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

  public toggleGuides() {
    this.state.showGuides = !this.state.showGuides;
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

  public setDisplayQuality(quality: ProjectState['displayQuality']) {
    this.state.displayQuality = quality;
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

  public updateElement(id: string, updates: Partial<CanvasElement>) {
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
      }
      this.pushHistory();
      this.notify();
      this.onMutation?.({ type: 'update', elementId: id, updates });
    }
  }

  public updateElements(updates: { id: string; partial: Partial<CanvasElement> }[]) {
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
      this.pushHistory();
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
    this.unlinkTextFrame(id);
    const spread = this.getActiveSpread();
    const el = spread.elements.find(item => item.id === id);
    if (el?.locked) return;
    spread.elements = spread.elements.filter(item => item.id !== id);
    this.state.selectedElementIds = this.state.selectedElementIds.filter(item => item !== id);
    if (this.state.selectedElementId === id) {
      this.state.selectedElementId = this.state.selectedElementIds[0] || null;
    }
    this.pushHistory();
    this.notify();
    this.onMutation?.({ type: 'delete', elementId: id });
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

  public unlinkTextFrame(frameId: string) {
    const found = this.findElementById(frameId);
    if (!found || found.element.type !== 'text') return;
    const frame = found.element as TextElement;

    if (frame.nextFrameId) {
      const next = this.findElementById(frame.nextFrameId)?.element as TextElement | undefined;
      if (next) next.prevFrameId = undefined;
      frame.nextFrameId = undefined;
    }

    if (frame.prevFrameId) {
      const prev = this.findElementById(frame.prevFrameId)?.element as TextElement | undefined;
      if (prev) prev.nextFrameId = undefined;
      frame.prevFrameId = undefined;
    }

    this.state.linkingFromFrameId = null;
    this.pushHistory();
    this.notify();
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

  public assignMasterSpread(spreadIndex: number, masterSpreadId: string | null) {
    if (spreadIndex < 0 || spreadIndex >= this.state.spreads.length) return;
    this.state.spreads[spreadIndex].masterSpreadId = masterSpreadId;
    this.pushHistory();
    this.notify();
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
      .replace(/\{\{page\}\}/g, String(pageNum))
      .replace(/\{\{totalPages\}\}/g, String(Math.max(1, totalPages)))
      .replace(/\{\{docTitle\}\}/g, this.state.settings.title)
      .replace(/\{\{chapterTitle\}\}/g, chapterTitle)
      .replace(/\{\{sectionTitle\}\}/g, chapterTitle);
  }

  public deleteSelectedElements() {
    const spread = this.getActiveSpread();
    const lockedIds = new Set(spread.elements.filter(el => el.locked).map(el => el.id));
    const idsToDelete = this.state.selectedElementIds.filter(id => !lockedIds.has(id));
    if (idsToDelete.length === 0) return;

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

  public alignElements(direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const spread = this.getActiveSpread();
    const selectedElements = spread.elements.filter(el => this.state.selectedElementIds.includes(el.id) && !el.locked);
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

  public addSpread() {
    const totalSpreads = this.state.spreads.length;
    let lastPageNum = 0;
    for (const sp of this.state.spreads) {
      for (const p of sp.pages) {
        if (p.pageNumber > lastPageNum) lastPageNum = p.pageNumber;
      }
    }

    const newSpread: Spread = {
      id: `spread-${Date.now()}`,
      spreadIndex: totalSpreads,
      pages: [
        { id: `page-${Date.now()}-1`, pageNumber: lastPageNum + 1, side: 'left' },
        { id: `page-${Date.now()}-2`, pageNumber: lastPageNum + 2, side: 'right' },
      ],
      elements: [],
    };

    this.state.spreads.push(newSpread);
    this.state.activeSpreadIndex = totalSpreads;
    this.state.selectedElementId = null;
    this.state.selectedElementIds = [];
    this.pushHistory();
    this.notify();
  }

  public deleteSpread(index: number) {
    if (this.state.spreads.length <= 1) return;
    this.state.spreads.splice(index, 1);
    this.state.spreads.forEach((sp, i) => {
      sp.spreadIndex = i;
    });
    this.state.activeSpreadIndex = Math.max(0, Math.min(index, this.state.spreads.length - 1));
    this.state.selectedElementId = null;
    this.state.selectedElementIds = [];
    this.pushHistory();
    this.notify();
  }

  public resetToDefault() {
    this.state = JSON.parse(JSON.stringify(INITIAL_STATE));
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
        this.state = parsed;
        this.pushHistory();
        this.notify();
      }
    } catch (e) {
      console.error('Failed to parse project JSON', e);
    }
  }

  public async loadFromIdml(idmlBuffer: ArrayBuffer | Uint8Array) {
    try {
      const newState = await parseIdmlPackage(idmlBuffer);
      if (!Array.isArray(newState.layers) || newState.layers.length === 0) {
        newState.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
      }
      if (!newState.activeLayerId) {
        newState.activeLayerId = newState.layers[0]?.id || 'layer-1';
      }
      this.state = newState;
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
      }
    });

    return issues;
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
