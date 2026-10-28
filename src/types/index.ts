/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

// Physical dimensions in millimeters (print space), typography in points (72 pt = 1 inch = 25.4 mm).

export type PagePreset = 'A4' | 'US-Letter' | 'Book-Trade-6x9' | 'Digest-5.5x8.5' | 'Zine-A5' | 'Custom';

export interface PageDimension {
  name: string;
  widthMm: number;
  heightMm: number;
}

export const PAGE_PRESETS: Record<PagePreset, PageDimension> = {
  'A4': { name: 'A4 (210 × 297 mm)', widthMm: 210, heightMm: 297 },
  'US-Letter': { name: 'US Letter (8.5 × 11 in)', widthMm: 215.9, heightMm: 279.4 },
  'Book-Trade-6x9': { name: 'Trade Book (6 × 9 in)', widthMm: 152.4, heightMm: 228.6 },
  'Digest-5.5x8.5': { name: 'Digest (5.5 × 8.5 in)', widthMm: 139.7, heightMm: 215.9 },
  'Zine-A5': { name: 'Zine / A5 (148 × 210 mm)', widthMm: 148, heightMm: 210 },
  'Custom': { name: 'Custom Dimension', widthMm: 210, heightMm: 297 },
};

export interface PageMargins {
  topMm: number;
  bottomMm: number;
  insideMm: number;
  outsideMm: number;
}

export interface BaselineGridSettings {
  enabled: boolean;
  incrementPt: number;
  startMm: number;
}

export interface DocumentSettings {
  title: string;
  preset: PagePreset;
  widthMm: number;
  heightMm: number;
  facingPages: boolean;
  bleedMm: number;
  margins: PageMargins;
  columnCount: number;
  columnGutterMm: number;
  baselineGrid: BaselineGridSettings;
  colorMode?: 'cmyk' | 'rgb';
  iccProfile?: 'FOGRA39' | 'GRACoL2006' | 'SWOP2006' | 'sRGB';
  overprintBlack?: boolean;
  footnotes?: Footnote[];
  footnoteSettings?: FootnoteSettings;
}

export interface FootnoteSettings {
  numberingStyle?: 'superscript' | 'arabic' | 'roman';
  separatorRuleWidthMm?: number;
  separatorRuleThicknessPt?: number;
  fontSizePt?: number;
  fontFamily?: string;
  scope?: 'document' | 'section' | 'page';
}

export interface Footnote {
  id: string;
  number: number;
  text: string;
  elementId?: string;
  pageId?: string;
}

export interface OpenTypeFeatures {
  ligatures?: boolean;
  smallCaps?: boolean;
  oldStyleFigures?: boolean;
  fractions?: boolean;
  [key: string]: boolean | undefined;
}

export type SemanticPdfTag =
  | 'Document'
  | 'Part'
  | 'Art'
  | 'Sect'
  | 'Div'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'P'
  | 'Title'
  | 'Caption'
  | 'BlockQuote'
  | 'Figure'
  | 'Table';

export interface GrepStyleRule {
  id: string;
  pattern: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ParagraphStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  letterSpacingPt: number;
  color: string;
  alignment: 'left' | 'center' | 'right' | 'justify';
  snapToBaseline: boolean;
  dropCapLines?: number;
  opticalMarginAlignment?: boolean;
  openTypeFeatures?: OpenTypeFeatures;
  pdfTag?: SemanticPdfTag;
  grepStyles?: GrepStyleRule[];
  balanceLines?: boolean;
  shadingColor?: string;
  shadingPaddingMm?: number;
  shadingBorderColor?: string;
  shadingBorderWidthMm?: number;
  spanColumns?: boolean;
  splitColumns?: number;
  nestedStyles?: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    through: 'words' | 'sentences' | 'characters' | 'delimiter';
    count: number;
    delimiter?: string;
  }[];
  lineStyles?: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    lineCount: number;
  };
}

export interface AnchoredObjectSettings {
  parentTextId: string;
  mode?: 'inline' | 'aboveLine';
  offsetYMm?: number;
  alignment?: 'left' | 'center' | 'right';
}

export interface ConditionTag {
  id: string;
  name: string;
  visible: boolean;
  colorHex: string;
}

export interface ObjectStyle {
  id: string;
  name: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidthMm?: number;
  paddingMm?: number;
  shadow?: {
    color: string;
    blurMm: number;
    offsetX: number;
    offsetY: number;
  };
  textWrap?: TextWrapSettings;
}

export interface CrossReference {
  id: string;
  targetElementId: string;
  label?: string;
}

export interface IndexEntry {
  id: string;
  topic: string;
  subtopic?: string;
  pageNumber: number;
  elementId?: string;
}

export interface InteractiveFormField {
  type: 'text' | 'checkbox' | 'button';
  fieldName: string;
  defaultValue?: string;
  multiline?: boolean;
  required?: boolean;
}

export type ElementType = 'text' | 'image' | 'shape' | 'table' | 'path';

export type TextWrapMode = 'none' | 'boundingBox' | 'contour';

export interface TextWrapSettings {
  mode: TextWrapMode;
  standoffMm: number;
}

export interface Layer {
  id: string;
  name: string;
  colorHex: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'layer-1', name: 'Layer 1', colorHex: '#0d99ff', visible: true, locked: false, order: 0 },
  { id: 'layer-2', name: 'Layer 2', colorHex: '#e63946', visible: true, locked: false, order: 1 },
  { id: 'layer-3', name: 'Layer 3', colorHex: '#2a9d8f', visible: true, locked: false, order: 2 },
];

export interface BaseElement {
  id: string;
  name?: string;
  type: ElementType;
  pageId: string;
  x: number; // mm
  y: number; // mm
  width: number; // mm
  height: number; // mm
  rotation: number; // degrees
  opacity: number; // 0 to 1
  zIndex: number;
  locked: boolean;
  editorialOnly?: boolean;
  spotColor?: string;
  layerId?: string;
  textWrap?: TextWrapSettings;
  masterSourceId?: string;
  isOverridden?: boolean;
  objectStyleId?: string;
  interactiveField?: InteractiveFormField;
  anchor?: AnchoredObjectSettings;
  shadow?: {
    color: string;
    blurMm: number;
    offsetX: number;
    offsetY: number;
  };
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  letterSpacingPt: number;
  color: string;
  alignment: 'left' | 'center' | 'right' | 'justify';
  columns: number;
  columnGutterMm: number;
  backgroundColor: string;
  borderColor: string;
  borderWidthMm: number;
  paddingMm: number;
  spanColumns?: boolean;
  splitColumns?: number;
  paragraphStyleId?: string;
  snapToBaseline?: boolean;
  dropCapLines?: number;
  opticalMarginAlignment?: boolean;
  openTypeFeatures?: OpenTypeFeatures;
  balanceColumns?: boolean;
  nextFrameId?: string;
  prevFrameId?: string;
  storyId?: string;
  rawStoryText?: string;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  columnRule?: {
    enabled: boolean;
    widthPt?: number;
    color?: string;
    insetMm?: number;
  };
}

export interface CopyfitResult {
  success: boolean;
  elementId: string;
  orphansFixed: number;
  trackingAdjustedPt: number;
  lineHeightAdjusted: number;
  fontSizeAdjustedPt: number;
  adjustments: string[];
}

export type ImageFitMode = 'fill' | 'fit' | 'frameToContent' | 'contentToFrame' | 'center' | 'stretch';

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  proxySrc?: string;
  assetId?: string;
  fitMode: ImageFitMode;
  borderColor: string;
  borderWidthMm: number;
  caption?: string;
  altText?: string;
  name?: string;
  fileSize?: number;
  format?: string;
  originalWidth?: number;
  originalHeight?: number;
  actualDpi?: number;
  isPsd?: boolean;
  psdLayers?: {
    id: number;
    name: string;
    visible: boolean;
    opacity: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }[];
  activePsdLayerIds?: number[];
  alphaContour?: Array<{ minX: number; maxX: number }>;
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'line';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeKind: ShapeKind;
  fillColor: string;
  strokeColor: string;
  strokeWidthMm: number;
  strokeDash: 'solid' | 'dashed';
}

export interface TableCell {
  text: string;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fillColor?: string;
  textColor?: string;
  isHeader?: boolean;
}

export interface TableElement extends BaseElement {
  type: 'table';
  rows: number;
  cols: number;
  rowHeightsMm?: number[];
  colWidthsMm?: number[];
  cells: TableCell[][];
  headerRowCount: number;
  headerFillColor: string;
  headerTextColor: string;
  alternateRowColor?: string;
  borderColor: string;
  borderWidthMm: number;
  cellPaddingMm: number;
  fontFamily: string;
  fontSizePt: number;
  footerRowCount?: number;
  footerFillColor?: string;
  footerTextColor?: string;
  repeatHeaderOnOverflow?: boolean;
  repeatFooterOnOverflow?: boolean;
  nextFrameId?: string;
  prevFrameId?: string;
  tableStoryId?: string;
  keepWithNext?: boolean;
}

export interface BezierNode {
  x: number; // mm relative to element.x
  y: number; // mm relative to element.y
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export interface TextOnPathSettings {
  text: string;
  fontSizePt: number;
  fontFamily: string;
  color: string;
  align: 'left' | 'center' | 'right';
  startOffsetMm: number;
}

export interface VectorPathElement extends BaseElement {
  type: 'path';
  nodes: BezierNode[];
  closed: boolean;
  fillColor: string;
  strokeColor: string;
  strokeWidthMm: number;
  strokeCap: 'butt' | 'round' | 'square';
  strokeJoin: 'miter' | 'round' | 'bevel';
  strokeDash: 'solid' | 'dashed';
  textOnPath?: TextOnPathSettings;
}

export type CanvasElement = TextElement | ImageElement | ShapeElement | TableElement | VectorPathElement;

export interface Page {
  id: string;
  pageNumber: number;
  side: 'left' | 'right' | 'single';
}

export interface MasterSpread {
  id: string;
  name: string;
  prefix: string;
  pages: Page[];
  elements: CanvasElement[];
}

export interface Spread {
  id: string;
  spreadIndex: number;
  pages: Page[];
  elements: CanvasElement[];
  masterSpreadId?: string | null;
  detachedMasterElementIds?: string[];
}

export type ToolType = 'select' | 'text' | 'frame' | 'table' | 'pen' | 'pencil' | 'shape-rect' | 'shape-ellipse' | 'shape-line' | 'measure' | 'hand' | 'zoom';

export interface CommentPin {
  id: string;
  spreadIndex: number;
  x: number; // mm
  y: number; // mm
  author: string;
  text: string;
  timestamp: number;
  resolved: boolean;
}

export type DisplayQuality = 'fast' | 'typical' | 'high';

export interface ProjectState {
  settings: DocumentSettings;
  spreads: Spread[];
  activeSpreadIndex: number;
  selectedElementId: string | null;
  selectedElementIds: string[];
  activeTool: ToolType;
  zoom: number;
  panX: number;
  panY: number;
  showGuides: boolean;
  showBleed: boolean;
  showBaselineGrid: boolean;
  snapToGuides: boolean;
  displayQuality: DisplayQuality;
  paragraphStyles: ParagraphStyle[];
  masterSpreads: MasterSpread[];
  linkingFromFrameId?: string | null;
  layers: Layer[];
  activeLayerId: string;
  previewMode?: boolean;
  plateSolo?: 'all' | 'cyan' | 'magenta' | 'yellow' | 'black';
  showReadingOrder?: boolean;
  showSlugBanner?: boolean;
  comments?: CommentPin[];
  objectStyles?: ObjectStyle[];
  crossReferences?: CrossReference[];
  indexEntries?: IndexEntry[];
  conditions?: ConditionTag[];
  activeMeasure?: {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    distanceMm: number;
    angleDeg: number;
  } | null;
}

export interface VersionSnapshot {
  id: string;
  timestamp: number;
  message: string;
  author: string;
  spreadCount: number;
  elementCount: number;
  state: ProjectState;
}

export interface PeerPresence {
  peerId: string;
  name: string;
  color: string;
  spreadIndex: number;
  x: number;
  y: number;
  selectedElementId?: string | null;
  lastActive: number;
}

export type CollabMessage =
  | { type: 'presence'; peer: PeerPresence; authHash?: string }
  | { type: 'op_update'; peerId: string; elementId: string; updates: Partial<CanvasElement>; timestamp: number; authHash?: string }
  | { type: 'op_add'; peerId: string; element: CanvasElement; timestamp: number; authHash?: string }
  | { type: 'op_delete'; peerId: string; elementId: string; timestamp: number; authHash?: string }
  | { type: 'sync_request'; peerId: string; authHash?: string }
  | { type: 'sync_response'; peerId: string; state: ProjectState; authHash?: string };

export type PreflightIssueCode =
  | 'OVERSET_TEXT'
  | 'LOW_RES_IMAGE'
  | 'TRIM_HAZARD'
  | 'BLEED_ERROR'
  | 'MISSING_ALT_TEXT'
  | 'HEADING_ORDER_HAZARD'
  | 'TAC_INK_DENSITY';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  severity: PreflightSeverity;
  code: PreflightIssueCode;
  message: string;
  spreadIndex: number;
  pageNumber: number;
  elementId?: string;
}

export interface AssetLink {
  id: string;
  elementId: string;
  name: string;
  src: string;
  format: string;
  sizeBytes: number;
  sizeFormatted: string;
  pixelWidth: number;
  pixelHeight: number;
  actualDpi: number;
  effectiveDpi: number;
  effectiveDpiY: number;
  isLowRes: boolean;
  spreadIndex: number;
  spreadNumber: number;
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  status: 'ok' | 'warning' | 'missing';
}
