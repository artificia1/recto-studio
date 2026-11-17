import { CanvasRulers, type RulerPalette } from './engine/canvasRulers';
import { instantiateMasterItem, resolveMaster } from './engine/masterInheritance';
import { lockedArtworkIds } from './engine/selectionGeometry';
import { calculateImageFitting } from './engine/imageFitting';
import { formatOpenTypeText, segmentTextWithGrep } from './engine/legacyTypography';
export { formatOpenTypeText, segmentTextWithGrep, type TextRunSegment } from './engine/legacyTypography';
import { publicationWrapObjects, wrappedPlainContent } from './engine/publicationWrap';
export { calculateImageFitting, type ImageFitTransform } from './engine/imageFitting';
import { createFrameNoteLayoutLookup, createPublicationTextResolver, layoutFrameNotes } from './engine/publicationReferences';
import { reviewPinPosition } from './engine/reviewPins';
import { calculateSpreadGeometry, getSpreadScreenOrigin, MM_TO_PX, screenToSpreadMm } from './engine/viewport';
import { bindCanvasInput, type CanvasMouseDown, type CanvasMouseMove, type CanvasMouseUp } from './engine/interaction/canvasInput';
import { handleCanvasKeyDown } from './engine/interaction/keyboard';
import { createSmartGuideSnap, sameSmartGuides, type SmartGuides } from './engine/interaction/smartGuides';
import { masterTargetPage } from './engine/pageLabels';
import { getAppearance, pasteboardColors } from './appearance';
import {
  ProjectState,
  Spread,
  Page,
  CanvasElement,
  TextElement,
  ImageElement,
  ShapeElement,
  TableElement,
  VectorPathElement,
  BezierNode,
  TextOnPathSettings,
  DisplayQuality,
  GrepStyleRule,
  StoryContent,
} from './types';
import { stateManager, numberToSuperscript } from './state';
import { collabSession } from './collab';
import { registerProofCapture } from './engine/proofCapture';
import { spotProofContext } from './engine/spotProofContext';
import { canvasGradient, displayGradientColor } from './engine/fillGradients';
import { assetStore } from './engine/assetStore';
import { AdjustmentPreviewCache } from './engine/adjustmentPreviewCache';
import { tableEngine } from './engine/tableEngine';
import { createTableThreadLookup } from './engine/tableCells';
import { createContentTableLayoutLookup } from './engine/tableLayout';
import { canvasRunFont, layoutStory } from './engine/storyLayout';
import { fontManager } from './fontManager';
import { layoutKernels } from './engine/layoutRuntime';
import { indexLines, liveStoryContent, spliceStory, supportsLiveEditing } from './engine/liveTextEditing';
import { storyText } from './engine/storyContent';
import { LiveTextEditor, liveTextEditingEnabled, setLiveTextEditingEnabled,
  type LiveTextBox, type LiveTextComposition, type LiveTextOpenOptions } from './engine/interaction/liveTextEditor';

export { MM_TO_PX } from './engine/viewport';

interface FormattedLine {
  text: string;
  isLastInPara: boolean;
  indentX: number;
  availWidth: number;
}

interface CanvasTextLayout {
  allLines: FormattedLine[];
  dropCapChar: string;
  dropCapWidth: number;
  dropCapFontSize: number;
}

type FormattedStoryLayout = ReturnType<typeof layoutStory>;
const DRAG_TEXT_PIXEL_BUDGET = 2_000_000;

function drawFormattedStory(ctx: CanvasRenderingContext2D, layout: FormattedStoryLayout,
  x: number, y: number, pxPerMm: number, zoom: number, hangFromTop = false) {
  ctx.textAlign = 'left';
  ctx.textBaseline = hangFromTop ? 'top' : 'alphabetic';
  let previousStyle: typeof layout.lines[number]['segments'][number]['style'] | undefined;
  for (const line of layout.lines) for (const segment of line.segments) {
    const { style } = segment;
    if (style !== previousStyle) {
      ctx.font = canvasRunFont(style, pxPerMm);
      ctx.fillStyle = style.color;
      ctx.letterSpacing = `${style.letterSpacingPt * 25.4 / 72 * pxPerMm}px`;
      previousStyle = style;
    }
    const left = x + segment.x * pxPerMm;
    const baseline = y + (line.y + (hangFromTop ? 0 : style.fontSizePt * 25.4 / 72)) * pxPerMm;
    if (segment.text.trim()) ctx.fillText(segment.text, left, baseline);
    if (style.underline) {
      ctx.fillRect(left, baseline + zoom, segment.width * pxPerMm, Math.max(0.6, zoom));
    }
  }
}

const LEADING_HANG_CHARS = new Set(['“', '‘', '"', "'", '«', '‹', '(', '[']);
const TRAILING_HANG_CHARS = new Set(['.', ',', '-', '–', '—', ':', ';', '”', '’', '"', "'", '»', '›', '!', '?', ')', ']']);

export function getLeadingHangOffset(lineText: string, ctx: CanvasRenderingContext2D, opticalMargin: boolean): number {
  if (!opticalMargin || !lineText) return 0;
  const trimmed = lineText.trimStart();
  const firstChar = trimmed.charAt(0);
  if (LEADING_HANG_CHARS.has(firstChar)) {
    const charW = ctx.measureText ? ctx.measureText(firstChar).width : 8;
    return (charW || 8) * 0.5;
  }
  return 0;
}

export function getTrailingHangOffset(lineText: string, ctx: CanvasRenderingContext2D, opticalMargin: boolean): number {
  if (!opticalMargin || !lineText) return 0;
  const trimmed = lineText.trimEnd();
  const lastChar = trimmed.charAt(trimmed.length - 1);
  if (TRAILING_HANG_CHARS.has(lastChar)) {
    const charW = ctx.measureText ? ctx.measureText(lastChar).width : 6;
    return (charW || 6) * 0.5;
  }
  return 0;
}


export function splitWordIntoFitChunks(word: string, maxW: number, ctx: CanvasRenderingContext2D): string[] {
  if (maxW <= 10 || !word || (ctx.measureText && ctx.measureText(word).width <= maxW)) {
    return [word];
  }
  const chunks: string[] = [];
  let remaining = word;
  while (remaining.length > 0) {
    let low = 1;
    let high = remaining.length;
    let best = 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const sub = remaining.slice(0, mid);
      const subW = ctx.measureText ? ctx.measureText(sub).width : sub.length * 8;
      if (subW <= maxW) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    chunks.push(remaining.slice(0, best));
    remaining = remaining.slice(best);
  }
  return chunks;
}

/**
 * Fast mathematical preflight estimation of whether a text frame has overset text.
 */
export function isTextFrameOverset(textEl: TextElement): boolean {
  const textContent = textEl.text || '';
  if (textContent.length === 0 || textEl.nextFrameId) return false;
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
  return approxRenderedLines > totalLinesCapacity || textContent.length > totalCapacity * 1.15;
}


export class SpreadCanvas {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rulerTop: HTMLCanvasElement;
  private rulers: CanvasRulers;
  private rulerPalette!: RulerPalette;

  private isDragging: boolean = false;
  private isResizing: boolean = false;
  private isPanning: boolean = false;
  private isSpacePanning: boolean = false;
  private isDrawingNew: boolean = false;
  private isMarquee: boolean = false;
  private activeHandle: string | null = null;
  private overflownTextFrameIds: Set<string> = new Set();

  private activePenPathId: string | null = null;
  private activeNodeDrag: {
    path: VectorPathElement;
    nodeIndex: number;
    part: 'anchor' | 'handleIn' | 'handleOut' | 'newHandle';
    startDragX: number;
    startDragY: number;
    pending?: BezierNode;
  } | null = null;

  private marqueeStartMmX: number = 0;
  private marqueeStartMmY: number = 0;
  private marqueeCurrentMmX: number = 0;
  private marqueeCurrentMmY: number = 0;
  private dragInitialPositions = new Map<string, { element: CanvasElement; locked: boolean }>();
  private activeSmartGuides: SmartGuides = { lines: [], spacings: [] };
  private snapDuringDrag?: ReturnType<typeof createSmartGuideSnap>;

  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private elementInitialX: number = 0;
  private elementInitialY: number = 0;
  private elementInitialW: number = 0;
  private elementInitialH: number = 0;
  private panStartX: number = 0;
  private panStartY: number = 0;

  private drawStartMmX: number = 0;
  private drawStartMmY: number = 0;
  private drawCurrentMmX: number = 0;
  private drawCurrentMmY: number = 0;
  private drawTargetPage: Page | null = null;

  private mouseMmX: number = 0;
  private mouseMmY: number = 0;
  private mouseScreenX: number = 0;
  private mouseScreenY: number = 0;

  // Touch gesture & pinch tracking

  // Zero-allocation pre-allocated reusable coordinate and struct caches
  private _origin = { x: 0, y: 0 };
  private _pointMm = { x: 0, y: 0 };
  private _spreadDims = {
    numPages: 0,
    pageWidthMm: 0,
    pageHeightMm: 0,
    spreadWidthMm: 0,
    spreadHeightMm: 0,
    spreadWidthPx: 0,
    spreadHeightPx: 0,
  };
  private _handles: Array<{ name: string; x: number; y: number }> = [
    { name: 'nw', x: 0, y: 0 },
    { name: 'n', x: 0, y: 0 },
    { name: 'ne', x: 0, y: 0 },
    { name: 'e', x: 0, y: 0 },
    { name: 'se', x: 0, y: 0 },
    { name: 's', x: 0, y: 0 },
    { name: 'sw', x: 0, y: 0 },
    { name: 'w', x: 0, y: 0 },
  ];
  private dragPreview = new Map<string, CanvasElement>();
  private dragDocument?: { state: ProjectState; spread: Spread; revision: number; tool: ProjectState['activeTool'] };
  private dragTextBitmaps = new Map<FormattedStoryLayout, HTMLCanvasElement>();
  private dragTextScale = 0;
  private dragTextDpr = 0;
  private dragTextPixels = 0;

  private clearDragTextBitmaps() {
    for (const bitmap of this.dragTextBitmaps.values()) bitmap.width = bitmap.height = 0;
    this.dragTextBitmaps.clear();
    this.dragTextPixels = 0;
  }

  private drawDragText(ctx: CanvasRenderingContext2D, layout: FormattedStoryLayout,
    x: number, y: number, width: number, height: number, bleed: number, pxPerMm: number, zoom: number) {
    const scale = ctx.getTransform().a;
    if (scale <= 0) return false;
    if (scale !== this.dragTextDpr || pxPerMm !== this.dragTextScale) {
      this.clearDragTextBitmaps();
      this.dragTextDpr = scale;
      this.dragTextScale = pxPerMm;
    }
    let bitmap = this.dragTextBitmaps.get(layout);
    if (!bitmap) {
      const w = Math.ceil((width + bleed * 2) * scale);
      const h = Math.ceil(height * scale);
      const pixels = w * h;
      if (w < 1 || h < 1 || w > 4096 || h > 4096 || this.dragTextPixels + pixels > DRAG_TEXT_PIXEL_BUDGET) return false;
      bitmap = document.createElement('canvas');
      bitmap.width = w;
      bitmap.height = h;
      const target = bitmap.getContext('2d');
      if (!target) return false;
      target.scale(scale, scale);
      target.direction = ctx.direction === 'inherit'
        ? getComputedStyle(this.canvas).direction as 'ltr' | 'rtl' : ctx.direction;
      if (target.fontVariantCaps !== undefined) target.fontVariantCaps = ctx.fontVariantCaps;
      drawFormattedStory(target, layout, bleed, 0, pxPerMm, zoom);
      this.dragTextBitmaps.set(layout, bitmap);
      this.dragTextPixels += pixels;
    }
    ctx.drawImage(bitmap, x - bleed, y, bitmap.width / scale, bitmap.height / scale);
    return true;
  }

  private beginDrag(state: ProjectState, spread = stateManager.getActiveSpread()) {
    this.dragDocument = { state, spread, revision: stateManager.getDocumentRevision(), tool: state.activeTool };
    stateManager.autosave.setCanvasDragActive(true);
  }

  private cancelDrag() {
    this.isDragging = false;
    this.isResizing = false;
    this.activeHandle = null;
    this.activeNodeDrag = null;
    this.dragPreview.clear();
    this.clearDragTextBitmaps();
    if (this.dragDocument) stateManager.autosave.setCanvasDragActive(false);
    this.dragDocument = undefined;
    this.snapDuringDrag = undefined;
    this.dragInitialPositions.clear();
    this.activeSmartGuides = { lines: [], spacings: [] };
  }

  // Multi-tier image caches (Full-Res vs Downscaled Viewport Proxy)
  private fullResCache: Map<string, HTMLImageElement> = new Map();
  private proxyCache: Map<string, HTMLCanvasElement> = new Map();
  private failedImageSrcs: Set<string> = new Set();
  private imageSpreadId = '';
  private imageSession = -1;

  // Static layer offscreen canvas caching
  private staticCanvas: HTMLCanvasElement = document.createElement('canvas');
  private readonly staticCtx = this.staticCanvas.getContext('2d')!;
  private staticDirtyKey: string = '';

  // Text layout memoization
  private textLayoutCache = new Map<string, CanvasTextLayout>();
  private formattedLayouts = new Map<TextElement, {
    content: NonNullable<TextElement['textContent']>; source?: string; reserve: number; layout: ReturnType<typeof layoutStory>;
  }>();
  private formattedLayoutRevision = '';
  private formattedLayoutKernels = layoutKernels;
  private spreadScene?: ReturnType<SpreadCanvas['buildSpreadScene']>;
  private tableThreads?: ReturnType<typeof createTableThreadLookup>;
  private tableLayouts = createContentTableLayoutLookup();

  // Active in-place canvas overlay editor (WordPad/Figma style)
  // `live` is set when the frame is edited in place on the canvas; without it `el` is the visible
  // textarea editor (closed through `finish`), which stays as the fallback.
  private activeInlineEditor: { elementId: string; el: HTMLElement; finish?: (commit: boolean) => void;
    live?: LiveTextEditor; selectionAtOpen?: string } | null = null;
  /**
   * Selection in the inline editor at the moment it lost focus to the UI (inspector button, Quick Apply,
   * a dropdown). Clicking such a control blurs the textarea and closes the editor before the click fires,
   * so without this a paragraph style would fall back to the whole frame.
   */
  private rememberedTextSelection: { elementId: string; text: string; start: number; end: number } | null = null;
  private opacityPreview?: { id: string; value: number; revision: number };

  public previewOpacity(id: string, value?: number): void {
    this.opacityPreview = value === undefined ? undefined : { id, value, revision: stateManager.getDocumentRevision() };
    this.scheduleRender();
  }

  // High-performance requestAnimationFrame render coalescing loop
  private renderRafId: number | null = null;
  private rulerRafId: number | null = null;

  // Stylus (Apple Pencil, S-Pen, Surface Pen) and Palm Rejection Tracking
  private activePenPointerId: number | null = null;
  private currentPointerType: string = 'mouse';
  private currentPointerPressure: number = 0.5;

  // Freehand Pencil Drawing State
  private isPencilDrawing: boolean = false;
  private pencilStrokePoints: Array<{ x: number; y: number; pressure: number }> = [];
  private pencilTargetPage: Page | null = null;

  private windowCleanups: Array<() => void> = [];
  private unsubState?: () => void;

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    rulerTop: HTMLCanvasElement,
    rulerLeft: HTMLCanvasElement
  ) {
    this.container = container;
    this.canvas = canvas;
    this.rulerTop = rulerTop;

    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.rulers = new CanvasRulers(rulerTop, rulerLeft, rulerTop.getContext('2d')!, rulerLeft.getContext('2d')!);
    this.refreshRulerPalette();

    this.initEvents();
    this.windowCleanups.push(registerProofCapture(spot => {
      const proof = document.createElement('canvas');
      const ratio = Math.min(1, 1280 / Math.max(this.canvas.width, this.canvas.height));
      proof.width = Math.max(1, Math.round(this.canvas.width * ratio));
      proof.height = Math.max(1, Math.round(this.canvas.height * ratio));
      const context = proof.getContext('2d', { willReadFrequently: true })!;
      const transform = this.ctx.getTransform();
      context.setTransform(transform.a * ratio, transform.b * ratio, transform.c * ratio, transform.d * ratio, transform.e * ratio, transform.f * ratio);
      this.render({ context, spot });
      return proof;
    }));
    this.resizeCanvas();

    this.addWindowListener('resize', () => {
      this.resizeCanvas();
      this.scheduleRender();
    });

    this.unsubState = stateManager.subscribe(() => {
      if (this.dragDocument && (this.dragDocument.state !== stateManager.getState() ||
        this.dragDocument.spread !== stateManager.getActiveSpread() ||
        this.dragDocument.revision !== stateManager.getDocumentRevision() ||
        this.dragDocument.tool !== stateManager.getState().activeTool)) this.cancelDrag();
      this.syncLiveTextEditor();
      this.scheduleRender();
    });

    this.addWindowListener('blur', () => { this.cancelDrag(); this.scheduleRender(); });

    const onFontLoaded = () => { this.rulers.invalidateMarks(); this.drawRulers(); };
    document.fonts?.addEventListener('loadingdone', onFontLoaded);
    this.windowCleanups.push(() => document.fonts?.removeEventListener('loadingdone', onFontLoaded));
    this.windowCleanups.push(collabSession.onPeersChange(() => this.scheduleRender()));
  }

  public destroy(): void {
    this.cancelDrag();
    this.rulers.destroy();
    this.spreadScene = undefined;
    this.formattedLayouts.clear();
    this.trimDisplayImages(0);
    this.staticCanvas.width = this.staticCanvas.height = 0;
    if (this.renderRafId !== null) {
      cancelAnimationFrame(this.renderRafId);
      this.renderRafId = null;
    }
    if (this.rulerRafId !== null) cancelAnimationFrame(this.rulerRafId);
    if (this.unsubState) {
      this.unsubState();
      this.unsubState = undefined;
    }
    for (const cleanup of this.windowCleanups) {
      try {
        cleanup();
      } catch {}
    }
    this.windowCleanups = [];
  }

  private addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    listener: (this: Window, ev: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ) {
    window.addEventListener(type, listener, options);
    this.windowCleanups.push(() => window.removeEventListener(type, listener, options));
  }

  public scheduleRender() {
    if (this.rulerRafId !== null) {
      cancelAnimationFrame(this.rulerRafId);
      this.rulerRafId = null;
    }
    if (this.renderRafId !== null) return;
    this.renderRafId = requestAnimationFrame(() => {
      this.renderRafId = null;
      this.flushNodePreview();
      this.render();
    });
  }

  private scheduleRulers() {
    if (this.renderRafId !== null || this.rulerRafId !== null) return;
    this.rulerRafId = requestAnimationFrame(() => {
      this.rulerRafId = null;
      this.drawRulers();
    });
  }

  public resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const w = Math.max(300, rect.width - 24);
    const h = Math.max(300, rect.height - 24);

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.rulers.resize(w, h, dpr);
  }

  private initEvents() {
    this.windowCleanups.push(bindCanvasInput(this.canvas, {
      mouseDown: this.handleMouseDown.bind(this),
      mouseMove: this.handleMouseMove.bind(this),
      mouseUp: this.handleMouseUp.bind(this),
      wheel: this.handleWheel.bind(this),
      doubleClick: this.handleDoubleClick.bind(this),
      pointerDown: this.handlePointerDown.bind(this),
      pointerMove: this.handlePointerMove.bind(this),
      pointerUp: this.handlePointerUp.bind(this),
      pointerCancel: this.handlePointerCancel.bind(this),
      drop: this.handleFileDrop.bind(this),
      penIsDown: () => this.activePenPointerId !== null,
      touchPointer: () => { this.currentPointerType = 'touch'; },
      cancelInteraction: () => {
        if (!this.dragDocument) return false;
        this.cancelDrag(); this.scheduleRender(); return true;
      },
      startPinch: () => {
        this.cancelDrag();
        this.isPanning = true;
        this.isDrawingNew = false;
        this.isDragging = false;
        this.isResizing = false;
        this.activeHandle = null;
      },
      stopPinch: () => { this.isPanning = false; },
      getViewport: () => {
        const { zoom, panX, panY } = stateManager.getState();
        return { zoom, panX, panY };
      },
      setViewport: (zoom, panX, panY) => stateManager.setZoomAndPan(zoom, panX, panY),
      keyDown: event => {
        if (event.key === 'Escape' && this.dragDocument) {
          this.cancelDrag(); this.scheduleRender(); event.preventDefault(); return;
        }
        handleCanvasKeyDown(event, stateManager, {
        beginSpacePan: () => {
          if (this.isSpacePanning) return false;
          this.isSpacePanning = true;
          this.canvas.style.cursor = 'grab';
          return true;
        },
        finishPenPath: () => {
          if (!this.activePenPathId) return;
          this.activePenPathId = null;
          stateManager.setTool('select');
          this.render();
        },
        });
      },
      keyUp: event => {
        if (event.code !== 'Space') return;
        this.isSpacePanning = false;
        if (!this.isPanning) {
          const state = stateManager.getState();
          this.canvas.style.cursor = state.activeTool === 'hand' ? 'grab' : 'default';
        }
      },
    }));
  }

  private getSpreadDimensions(state: ProjectState) {
    const { widthMm, heightMm } = state.settings;
    return calculateSpreadGeometry(widthMm, heightMm, stateManager.getActiveSpread().pages.length, state.zoom, this._spreadDims);
  }

  private getSpreadScreenOrigin(state: ProjectState) {
    const rect = this.canvas.getBoundingClientRect();
    const dimensions = this.getSpreadDimensions(state);
    const width = rect.width > 0 ? rect.width : this.canvas.width || dimensions.spreadWidthPx;
    const height = rect.height > 0 ? rect.height : this.canvas.height || dimensions.spreadHeightPx;
    return getSpreadScreenOrigin({ width, height }, dimensions, state, this._origin);
  }

  private screenToSpreadMm(screenX: number, screenY: number, state: ProjectState) {
    return screenToSpreadMm(screenX, screenY, this.getSpreadScreenOrigin(state), state.zoom, this._pointMm);
  }

  private findPageAtMm(spreadMmX: number, spreadMmY: number, state: ProjectState): { page: Page; localX: number; localY: number } | null {
    const spread = stateManager.getActiveSpread();
    const { pageWidthMm, pageHeightMm } = this.getSpreadDimensions(state);

    if (spreadMmY < 0 || spreadMmY > pageHeightMm) return null;

    for (let i = 0; i < spread.pages.length; i++) {
      const pageStartMm = i * pageWidthMm;
      const pageEndMm = (i + 1) * pageWidthMm;
      if (spreadMmX >= pageStartMm && spreadMmX <= pageEndMm) {
        return {
          page: spread.pages[i],
          localX: spreadMmX - pageStartMm,
          localY: spreadMmY,
        };
      }
    }
    return null;
  }

  private handleMouseDown(e: CanvasMouseDown) {
    this.rememberedTextSelection = null;
    const state = stateManager.getState();
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const live = this.activeInlineEditor?.live;
    if (live) {
      const press = e as Partial<MouseEvent>;
      const panning = e.button === 1 || state.activeTool === 'hand' || this.isSpacePanning;
      const editing = e.button === 0 && (state.activeTool === 'select' || state.activeTool === 'text');
      // A press inside the frame being edited places the caret; panning leaves the editor open.
      // Keeping the default action away stops the press from taking focus off the hidden textarea.
      if (!panning && editing && live.pointerDown(screenX, screenY, { shiftKey: e.shiftKey, detail: press.detail })) {
        press.preventDefault?.();
        return;
      }
      if (panning) press.preventDefault?.();
      else this.closeInlineTextEditor(true);
    } else if (this.activeInlineEditor) {
      this.closeInlineTextEditor(true);
    }

    if (e.button === 1 || state.activeTool === 'hand' || this.isSpacePanning) {
      this.isPanning = true;
      this.panStartX = e.clientX - state.panX;
      this.panStartY = e.clientY - state.panY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const { x: mmX, y: mmY } = this.screenToSpreadMm(screenX, screenY, state);

    if (state.comments && state.comments.length > 0 && !state.previewMode) {
      for (const c of state.comments) {
        const position = reviewPinPosition(state, c, state.activeSpreadIndex);
        if (position?.spreadIndex !== state.activeSpreadIndex) continue;
        const dx = mmX - position.x;
        const dy = mmY - position.y;
        if (Math.sqrt(dx * dx + dy * dy) <= 4) {
          stateManager.resolveComment(c.id);
          return;
        }
      }
    }

    if (state.activeTool === 'measure') {
      stateManager.setMeasureData({
        startX: mmX,
        startY: mmY,
        currentX: mmX,
        currentY: mmY,
        distanceMm: 0,
        angleDeg: 0,
      });
      return;
    }

    if (state.activeTool !== 'select') {
      if (state.activeTool === 'pen') {
        this.handlePenMouseDown(mmX, mmY, screenX, screenY);
        return;
      }
      if (state.activeTool === 'pencil') {
        if (!this.isPencilDrawing) {
          this.handlePencilMouseDown(mmX, mmY, screenX, screenY, e);
        }
        return;
      }
      if (state.activeTool === 'text') {
        const hit = this.hitTestElements(mmX, mmY, state);
        if (hit && hit.type === 'text' && !hit.locked) {
          stateManager.selectElement(hit.id);
          this.openInlineTextEditor(hit.id, { point: e });
          // The editor took focus during this press; keep the press from handing it back to the page.
          if (this.activeInlineEditor?.live) (e as Partial<MouseEvent>).preventDefault?.();
          return;
        }
        if (!hit && state.selectedElementIds.length > 0 && !e.shiftKey) {
          stateManager.selectElements([]);
        }
      }
      const pageHit = this.findPageAtMm(mmX, mmY, state);
      if (pageHit) {
        this.isDrawingNew = true;
        this.drawStartMmX = pageHit.localX;
        this.drawStartMmY = pageHit.localY;
        this.drawCurrentMmX = pageHit.localX;
        this.drawCurrentMmY = pageHit.localY;
        this.drawTargetPage = pageHit.page;
      }
      return;
    }

    if (state.linkingFromFrameId) {
      const hit = this.hitTestElements(mmX, mmY, state);
      if (hit && hit.type === 'text') {
        stateManager.linkTextFrames(state.linkingFromFrameId, hit.id);
      } else {
        const pageHit = this.findPageAtMm(mmX, mmY, state);
        if (pageHit) {
          // InDesign behavior: Clicking empty space with loaded outport creates a new linked text frame!
          const sourceEl = stateManager.getElementById(state.linkingFromFrameId) as TextElement | undefined;
          const newId = `text-${Date.now()}`;
          const w = sourceEl ? sourceEl.width : 60;
          const h = sourceEl ? sourceEl.height : 60;
          stateManager.addElement({
            id: newId,
            type: 'text',
            pageId: pageHit.page.id,
            x: Math.round(pageHit.localX),
            y: Math.round(pageHit.localY),
            width: Math.round(w),
            height: Math.round(h),
            rotation: 0,
            opacity: 1,
            zIndex: 10,
            locked: false,
            text: '',
            fontFamily: sourceEl?.fontFamily || 'serif',
            fontSizePt: sourceEl?.fontSizePt || 12,
            lineHeight: sourceEl?.lineHeight || 1.3,
            letterSpacingPt: sourceEl?.letterSpacingPt || 0,
            color: sourceEl?.color || '#111111',
            columns: sourceEl?.columns || 1,
            columnGutterMm: sourceEl?.columnGutterMm || 4,
            alignment: sourceEl?.alignment || 'left',
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            borderWidthMm: 0,
            paddingMm: sourceEl?.paddingMm || 2,
          });
          stateManager.linkTextFrames(state.linkingFromFrameId, newId);
        }
      }
      stateManager.setLinkingFromFrame(null);
      return;
    }

    if (!state.previewMode && (!state.selectedElementIds || state.selectedElementIds.length === 0)) {
      const spread = stateManager.getActiveSpread();
      const origin = this.getSpreadScreenOrigin(state);
      const pxPerMm = (96 / 25.4) * state.zoom;
      const pageWidthMm = state.settings.widthMm;
      for (const el of spread.elements) {
        if (el.type === 'text' && this.overflownTextFrameIds.has(el.id) && !(el as TextElement).nextFrameId) {
          const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
          const elScreenX = origin.x + ((pageIdx * pageWidthMm + el.x) * pxPerMm);
          const elScreenY = origin.y + (el.y * pxPerMm);
          const elScreenW = el.width * pxPerMm;
          const elScreenH = el.height * pxPerMm;
          const outPortX = elScreenX + elScreenW - 14;
          const outPortY = elScreenY + elScreenH - 14;
          if (screenX >= outPortX - 3 && screenX <= outPortX + 17 && screenY >= outPortY - 3 && screenY <= outPortY + 17) {
            stateManager.selectElement(el.id);
            stateManager.setLinkingFromFrame(el.id);
            return;
          }
        }
      }
    }

    if (state.selectedElementIds && state.selectedElementIds.length === 1) {
      const spread = stateManager.getActiveSpread();
      const el = spread.elements.find(item => item.id === state.selectedElementIds[0]);
      const elLayer = state.layers?.find(l => l.id === (el?.layerId || 'layer-1'));
      const isLocked = el?.locked || Boolean(elLayer?.locked);
      const isVisible = !elLayer || elLayer.visible !== false;

      if (el && !isLocked && isVisible && el.type === 'text') {
        const textEl = el as TextElement;
        const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === textEl.pageId));
        const origin = this.getSpreadScreenOrigin(state);
        const pxPerMm = (96 / 25.4) * state.zoom;
        const pageWidthMm = state.settings.widthMm;
        const elScreenX = origin.x + ((pageIdx * pageWidthMm + textEl.x) * pxPerMm);
        const elScreenY = origin.y + (textEl.y * pxPerMm);
        const elScreenW = textEl.width * pxPerMm;
        const elScreenH = textEl.height * pxPerMm;

        // OutPort handle is at (elScreenX + elScreenW - 14, elScreenY + elScreenH - 14, 14, 14)
        const outPortX = elScreenX + elScreenW - 14;
        const outPortY = elScreenY + elScreenH - 14;
        if (screenX >= outPortX - 3 && screenX <= outPortX + 17 && screenY >= outPortY - 3 && screenY <= outPortY + 17) {
          if (textEl.nextFrameId) {
            stateManager.unlinkTextFrame(textEl.id);
          } else {
            stateManager.setLinkingFromFrame(textEl.id);
          }
          return;
        }

        // InPort handle is at (elScreenX - 4, elScreenY + 10, 10, 10)
        const inPortX = elScreenX - 4;
        const inPortY = elScreenY + 10;
        if (screenX >= inPortX - 3 && screenX <= inPortX + 13 && screenY >= inPortY - 3 && screenY <= inPortY + 13) {
          if (textEl.prevFrameId) {
            stateManager.unlinkTextFrame(textEl.id);
            return;
          }
        }
      }

      if (el && !isLocked && isVisible) {
        if (el.type === 'path') {
          const nodeHit = this.hitTestPathNodes(screenX, screenY, state);
          if (nodeHit) {
            this.startNodeDrag(el, nodeHit.nodeIndex, nodeHit.part, screenX, screenY);
            return;
          }
        }

        const handle = this.hitTestHandles(screenX, screenY, state);
        if (handle) {
          this.isResizing = true;
          this.beginDrag(state, spread);
          this.activeHandle = handle;
          this.dragStartX = screenX;
          this.dragStartY = screenY;
          this.elementInitialX = el.x;
          this.elementInitialY = el.y;
          this.elementInitialW = el.width;
          this.elementInitialH = el.height;
          return;
        }
      }
    }

    // InDesign Master Page Detach / Override gesture: Cmd + Shift + Click (or Ctrl + Shift + Click)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
      const masterHit = this.hitTestMasterElements(mmX, mmY, state);
      if (masterHit) {
        const spread = stateManager.getActiveSpread();
        const overridden = stateManager.overrideMasterElement(spread.id, masterHit.masterElement.id);
        if (overridden) {
          stateManager.selectElements([overridden.id]);
          this.prepareGroupDrag(screenX, screenY, stateManager.getState());
          return;
        }
      }
    }

    const hitElement = this.hitTestElements(mmX, mmY, state);
    if (hitElement) {
      if (e.shiftKey) {
        stateManager.toggleElementSelection(hitElement.id);
        const nextState = stateManager.getState();
        if (nextState.selectedElementIds.includes(hitElement.id)) {
          this.prepareGroupDrag(screenX, screenY, nextState);
        }
      } else {
        if (!state.selectedElementIds || !state.selectedElementIds.includes(hitElement.id)) {
          stateManager.selectElements([hitElement.id]);
        }
        this.prepareGroupDrag(screenX, screenY, stateManager.getState());
      }
    } else {
      if (!e.shiftKey) {
        stateManager.selectElements([]);
      }
      this.isMarquee = true;
      this.marqueeStartMmX = mmX;
      this.marqueeStartMmY = mmY;
      this.marqueeCurrentMmX = mmX;
      this.marqueeCurrentMmY = mmY;
    }
  }

  private prepareGroupDrag(screenX: number, screenY: number, state: ProjectState) {
    this.cancelDrag();
    this.isDragging = true;
    this.beginDrag(state);
    this.dragStartX = screenX;
    this.dragStartY = screenY;
    const spread = stateManager.getActiveSpread();
    const ids = state.selectedElementIds && state.selectedElementIds.length > 0
      ? state.selectedElementIds
      : (state.selectedElementId ? [state.selectedElementId] : []);
    const lockedIds = lockedArtworkIds(state);

    const elements = this.getSpreadScene(state).elements;
    for (const id of ids) {
      const element = elements.get(id);
      if (element) this.dragInitialPositions.set(id, { element, locked: lockedIds.has(id) });
    }
  }

  private handleMouseMove(e: CanvasMouseMove) {
    const state = stateManager.getState();
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const { x: mmX, y: mmY } = this.screenToSpreadMm(screenX, screenY, state);
    this.mouseMmX = mmX;
    this.mouseMmY = mmY;
    this.mouseScreenX = screenX;
    this.mouseScreenY = screenY;

    collabSession.broadcastPresence(mmX, mmY, state.selectedElementId);

    const live = this.activeInlineEditor?.live;
    if (live && !this.isPanning) {
      const over = live.pointerMove(screenX, screenY, e.buttons);
      if (over) {
        this.canvas.style.cursor = 'text';
        return;
      }
    }

    if (this.isPencilDrawing) {
      this.handlePencilMouseMove(e);
      return;
    }

    if (state.linkingFromFrameId) this.scheduleRender();

    if (this.activeNodeDrag) {
      this.previewNodeDrag(screenX, screenY, mmX, mmY, state, e.altKey);
      this.scheduleRender();
      return;
    }

    if (state.activeTool === 'pen' && this.activePenPathId) {
      this.scheduleRender();
      return;
    }

    if (state.activeTool === 'measure' && state.activeMeasure && (e.buttons & 1)) {
      const dx = mmX - state.activeMeasure.startX;
      const dy = mmY - state.activeMeasure.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      stateManager.setMeasureData({
        startX: state.activeMeasure.startX,
        startY: state.activeMeasure.startY,
        currentX: mmX,
        currentY: mmY,
        distanceMm: dist,
        angleDeg: angle,
      });
      return;
    }

    if (this.isPanning) {
      const newPanX = e.clientX - this.panStartX;
      const newPanY = e.clientY - this.panStartY;
      stateManager.setPan(newPanX, newPanY);
      return;
    }

    if (this.isMarquee) {
      this.marqueeCurrentMmX = mmX;
      this.marqueeCurrentMmY = mmY;
      this.scheduleRender();
      return;
    }

    if (this.isDragging && this.dragInitialPositions.size > 0) {
      const dxPx = screenX - this.dragStartX;
      const dyPx = screenY - this.dragStartY;
      const pxPerMm = MM_TO_PX * state.zoom;
      const deltaMmX = dxPx / pxPerMm;
      const deltaMmY = dyPx / pxPerMm;

      let guides: SmartGuides = { lines: [], spacings: [] };
      let moved = false;
      for (const [id, { element, locked }] of this.dragInitialPositions) {
        if (locked) continue;
        let x = element.x + deltaMmX;
        let y = element.y + deltaMmY;
        if (state.snapToGuides && this.dragInitialPositions.size === 1) {
          const spread = stateManager.getActiveSpread();
          const pageIndex = Math.max(0, spread.pages.findIndex(page => page.id === element.pageId));
          const snap = this.snapDuringDrag ??= createSmartGuideSnap(state.settings, spread.elements, id);
          const result = snap({ x, y, width: element.width, height: element.height }, pageIndex);
          x = result.x;
          y = result.y;
          guides = result.guides;
        }
        x = Math.round(x * 10) / 10;
        y = Math.round(y * 10) / 10;
        const previous = this.dragPreview.get(id) ?? element;
        if (previous.x === x && previous.y === y) continue;
        if (element.x === x && element.y === y) this.dragPreview.delete(id);
        else this.dragPreview.set(id, { ...element, x, y });
        moved = true;
      }

      const changedGuides = !sameSmartGuides(guides, this.activeSmartGuides);
      this.activeSmartGuides = guides;
      if (moved || changedGuides) this.scheduleRender();
      else this.scheduleRulers();
      return;
    }

    if (this.isResizing && state.selectedElementId && this.activeHandle) {
      const dxPx = screenX - this.dragStartX;
      const dyPx = screenY - this.dragStartY;
      const pxPerMm = MM_TO_PX * state.zoom;
      const dxMm = dxPx / pxPerMm;
      const dyMm = dyPx / pxPerMm;

      let newX = this.elementInitialX;
      let newY = this.elementInitialY;
      let newW = this.elementInitialW;
      let newH = this.elementInitialH;

      if (this.activeHandle.includes('e')) newW = Math.max(5, this.elementInitialW + dxMm);
      if (this.activeHandle.includes('s')) newH = Math.max(5, this.elementInitialH + dyMm);
      if (this.activeHandle.includes('w')) {
        const potentialW = this.elementInitialW - dxMm;
        if (potentialW >= 5) {
          newW = potentialW;
          newX = this.elementInitialX + dxMm;
        }
      }
      if (this.activeHandle.includes('n')) {
        const potentialH = this.elementInitialH - dyMm;
        if (potentialH >= 5) {
          newH = potentialH;
          newY = this.elementInitialY + dyMm;
        }
      }

      const element = stateManager.getActiveSpread().elements.find(item => item.id === state.selectedElementId);
      if (!element) return;
      this.dragPreview.set(element.id, { ...element,
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        width: Math.round(newW * 10) / 10,
        height: Math.round(newH * 10) / 10,
      });
      this.scheduleRender();
      return;
    }

    if (this.isDrawingNew && this.drawTargetPage) {
      const spread = stateManager.getActiveSpread();
      const { pageWidthMm } = this.getSpreadDimensions(state);
      const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === this.drawTargetPage!.id));
      const pageStartMm = pageIdx * pageWidthMm;
      this.drawCurrentMmX = mmX - pageStartMm;
      this.drawCurrentMmY = mmY;
      this.scheduleRender();
      return;
    }

    if (this.isSpacePanning && !this.isPanning) {
      this.canvas.style.cursor = 'grab';
    } else if (state.activeTool === 'select' && state.selectedElementIds && state.selectedElementIds.length === 1) {
      const handle = this.hitTestHandles(screenX, screenY, state);
      if (handle) {
        this.canvas.style.cursor = `${handle}-resize`;
      } else {
        this.canvas.style.cursor = 'default';
      }
    } else if (state.activeTool === 'hand') {
      this.canvas.style.cursor = 'grab';
    } else if (state.activeTool === 'text') {
      this.canvas.style.cursor = 'text';
    } else if (state.activeTool === 'frame' || state.activeTool === 'table' || state.activeTool === 'pen' || state.activeTool === 'pencil' || state.activeTool.startsWith('shape')) {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default';
    }

    this.scheduleRulers();
  }

  private snapCoordinate(val: number, snapPoints: number[], thresholdMm: number = 2): number {
    for (const pt of snapPoints) {
      if (Math.abs(val - pt) <= thresholdMm) {
        return pt;
      }
    }
    return val;
  }

  private handleMouseUp(e: CanvasMouseUp) {
    if (this.activeInlineEditor?.live?.pointerUp()) return;
    const state = stateManager.getState();
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (this.isDragging) {
      const updates = [...this.dragPreview.values()].flatMap(element => {
        const initial = this.dragInitialPositions.get(element.id)?.element;
        return initial && (element.x !== initial.x || element.y !== initial.y)
          ? [{ id: element.id, partial: { x: element.x, y: element.y } }] : [];
      });
      this.cancelDrag();
      if (updates.length) stateManager.updateElements(updates);
      this.scheduleRender();
    }
    if (this.isResizing) {
      const element = state.selectedElementId ? this.dragPreview.get(state.selectedElementId) : undefined;
      this.cancelDrag();
      if (element && (element.x !== this.elementInitialX || element.y !== this.elementInitialY ||
        element.width !== this.elementInitialW || element.height !== this.elementInitialH)) {
        const { x, y, width, height } = element;
        stateManager.updateElement(element.id, { x, y, width, height });
      }
      this.scheduleRender();
    }

    if (this.isPencilDrawing) {
      this.handlePencilMouseUp();
    }

    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = (this.isSpacePanning || state.activeTool === 'hand') ? 'grab' : 'default';
    }
    if (this.activeNodeDrag) {
      this.flushNodePreview();
      const draft = this.dragPreview.get(this.activeNodeDrag.path.id);
      this.cancelDrag();
      if (draft?.type === 'path') {
        stateManager.updateElement(draft.id, { nodes: draft.nodes, width: draft.width, height: draft.height });
        stateManager.finishUndoGroup();
      }
      this.scheduleRender();
    }

    if (this.isMarquee) {
      this.isMarquee = false;
      const boxMinX = Math.min(this.marqueeStartMmX, this.marqueeCurrentMmX);
      const boxMaxX = Math.max(this.marqueeStartMmX, this.marqueeCurrentMmX);
      const boxMinY = Math.min(this.marqueeStartMmY, this.marqueeCurrentMmY);
      const boxMaxY = Math.max(this.marqueeStartMmY, this.marqueeCurrentMmY);

      if (boxMaxX - boxMinX >= 2 || boxMaxY - boxMinY >= 2) {
        const spread = stateManager.getActiveSpread();
        const { pageWidthMm } = this.getSpreadDimensions(state);
        const intersectedIds: string[] = [];

        const layerMap = new Map((state.layers || []).map(l => [l.id, l]));

        for (const el of spread.elements) {
          const elLayer = layerMap.get(el.layerId || 'layer-1');
          if (elLayer && (elLayer.visible === false || elLayer.locked === true)) {
            continue;
          }
          if (el.locked) {
            continue;
          }

          const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
          const elGlobalX = pageIdx * pageWidthMm + el.x;
          const elGlobalY = el.y;

          const intersects =
            Math.max(boxMinX, elGlobalX) <= Math.min(boxMaxX, elGlobalX + el.width) &&
            Math.max(boxMinY, elGlobalY) <= Math.min(boxMaxY, elGlobalY + el.height);

          if (intersects) {
            intersectedIds.push(el.id);
          }
        }

        if (e.shiftKey) {
          const merged = Array.from(new Set([...(state.selectedElementIds || []), ...intersectedIds]));
          stateManager.selectElements(merged);
        } else {
          stateManager.selectElements(intersectedIds);
        }
      }
      this.render();
    }

    if (this.isDrawingNew && this.drawTargetPage) {
      this.isDrawingNew = false;
      const { x: endMmX, y: endMmY } = this.screenToSpreadMm(screenX, screenY, state);
      const spread = stateManager.getActiveSpread();
      const { pageWidthMm } = this.getSpreadDimensions(state);
      const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === this.drawTargetPage!.id));
      const pageStartMm = pageIdx * pageWidthMm;
      const validEndMmX = isNaN(endMmX) ? this.drawCurrentMmX + pageStartMm : endMmX;
      const validEndMmY = isNaN(endMmY) ? this.drawCurrentMmY : endMmY;
      const targetLocalX = validEndMmX - pageStartMm;
      const targetLocalY = validEndMmY;

      const rawW = Math.abs(targetLocalX - this.drawStartMmX);
      const rawH = Math.abs(targetLocalY - this.drawStartMmY);

      let w = rawW;
      let h = rawH;
      let x = Math.min(this.drawStartMmX, targetLocalX);
      let y = Math.min(this.drawStartMmY, targetLocalY);

      if (rawW < 5 && rawH < 5) {
        if (state.activeTool === 'text') {
          w = 60;
          h = 30;
        } else if (state.activeTool === 'frame') {
          w = 60;
          h = 45;
        } else if (state.activeTool === 'table') {
          w = 80;
          h = 40;
        } else if (state.activeTool.startsWith('shape')) {
          w = 40;
          h = 40;
        } else {
          w = 60;
          h = 40;
        }
        x = this.drawStartMmX;
        y = this.drawStartMmY;
      }

      const newId = `elem-${Date.now()}`;
      if (state.activeTool === 'text') {
        stateManager.addElement({
          id: newId,
          type: 'text',
          pageId: this.drawTargetPage.id,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
          rotation: 0,
          opacity: 1,
          zIndex: 10,
          locked: false,
          text: 'Type your text here...',
          fontFamily: 'Playfair Display, serif',
          fontSizePt: 16,
          lineHeight: 1.3,
          letterSpacingPt: 0,
          color: '#111111',
          alignment: 'left',
          columns: 1,
          columnGutterMm: 4,
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          borderWidthMm: 0,
          paddingMm: 2,
        });
      } else if (state.activeTool === 'frame') {
        stateManager.addElement({
          id: newId,
          type: 'image',
          pageId: this.drawTargetPage.id,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
          rotation: 0,
          opacity: 1,
          zIndex: 5,
          locked: false,
          src: '',
          fitMode: 'fill',
          borderColor: '#111111',
          borderWidthMm: 0.3,
          caption: 'Image Frame',
        });
      } else if (state.activeTool.startsWith('shape')) {
        const kind = state.activeTool === 'shape-ellipse' ? 'ellipse' : (state.activeTool === 'shape-line' ? 'line' : 'rectangle');
        stateManager.addElement({
          id: newId,
          type: 'shape',
          pageId: this.drawTargetPage.id,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
          rotation: 0,
          opacity: 1,
          zIndex: 5,
          locked: false,
          shapeKind: kind,
          fillColor: kind === 'line' ? '#111111' : '#e5e5e5',
          strokeColor: '#111111',
          strokeWidthMm: 0.4,
          strokeDash: 'solid',
        });
      } else if (state.activeTool === 'table') {
        stateManager.addElement({
          id: newId,
          type: 'table',
          pageId: this.drawTargetPage.id,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.max(60, Math.round(w)),
          height: Math.max(30, Math.round(h)),
          rotation: 0,
          opacity: 1,
          zIndex: 8,
          locked: false,
          rows: 3,
          cols: 3,
          headerRowCount: 1,
          headerFillColor: '#242424',
          headerTextColor: '#ffffff',
          alternateRowColor: '#f9f9f9',
          borderColor: '#444444',
          borderWidthMm: 0.3,
          cellPaddingMm: 1.5,
          fontFamily: 'Inter, sans-serif',
          fontSizePt: 9,
          cells: [
            [{ text: 'Header 1' }, { text: 'Header 2' }, { text: 'Header 3' }],
            [{ text: 'Data 1' }, { text: 'Data 2' }, { text: 'Data 3' }],
            [{ text: 'Data 4' }, { text: 'Data 5' }, { text: 'Data 6' }],
          ],
        });
      }

      stateManager.setTool('select');
      this.drawTargetPage = null;
      this.drawCurrentMmX = 0;
      this.drawCurrentMmY = 0;
    }
  }

  private handleWheel(e: WheelEvent) {
    e.preventDefault();
    // The textarea editor is pinned to the screen, so scrolling must close it; in-place editing follows the page.
    if (this.activeInlineEditor && !this.activeInlineEditor.live) {
      this.closeInlineTextEditor(true);
    }
    const state = stateManager.getState();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      stateManager.setZoom(state.zoom * zoomFactor);
    } else {
      stateManager.setPan(state.panX - e.deltaX, state.panY - e.deltaY);
    }
  }

  /**
   * Edit a text frame. By default the frame is edited in place on the canvas, each paragraph in its
   * own style; frames that rely on the legacy renderer, or everything when in-place editing is
   * switched off, get the textarea editor below.
   */
  public openInlineTextEditor(elementId: string, options: LiveTextOpenOptions = {}): void {
    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find((item) => item.id === elementId);
    if (!el || el.type !== 'text') return;
    const textEl = el as TextElement;

    this.closeInlineTextEditor(true);
    this.rememberedTextSelection = null;

    let pageIdx = spread.pages.findIndex((p) => p.id === textEl.pageId);
    if (pageIdx === -1) {
      pageIdx = (textEl.x >= stateManager.getState().settings.widthMm && spread.pages.length > 1) ? 1 : 0;
      if (spread.pages[pageIdx]) {
        textEl.pageId = spread.pages[pageIdx].id;
      } else {
        pageIdx = 0;
      }
    }

    const state = stateManager.getState();
    if (liveTextEditingEnabled() && supportsLiveEditing(textEl, state.paragraphStyles)) {
      this.openLiveTextEditor(textEl, options);
      return;
    }
    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    const pageWidthMm = state.settings.widthMm;
    const pageStartMm = pageIdx * pageWidthMm;

    const elScreenX = origin.x + ((pageStartMm + textEl.x) * pxPerMm);
    const elScreenY = origin.y + (textEl.y * pxPerMm);
    const elScreenW = textEl.width * pxPerMm;
    const elScreenH = textEl.height * pxPerMm;
    const paddingPx = (textEl.paddingMm || 2) * pxPerMm;
    const fontSizePx = Math.max(9, (textEl.fontSizePt * (96 / 72)) * state.zoom);

    const textarea = document.createElement('textarea');
    textarea.className = 'canvas-inline-editor';
    const originalText = textEl.text || '';
    textarea.value = originalText;
    textarea.placeholder = 'Type text here...';
    textarea.spellcheck = false;

    const bg =
      textEl.backgroundColor && textEl.backgroundColor !== 'transparent'
        ? textEl.backgroundColor
        : '#ffffff';
    const textColor = textEl.color || '#111111';

    textarea.style.position = 'absolute';
    textarea.style.left = `${Math.round(elScreenX)}px`;
    textarea.style.top = `${Math.round(elScreenY)}px`;
    textarea.style.width = `${Math.max(80, Math.round(elScreenW))}px`;
    textarea.style.height = `${Math.max(40, Math.round(elScreenH))}px`;
    textarea.style.fontSize = `${fontSizePx}px`;
    textarea.style.fontFamily = textEl.fontFamily || 'Inter, system-ui, sans-serif';
    textarea.style.lineHeight = String(textEl.lineHeight || 1.3);
    textarea.style.letterSpacing = textEl.letterSpacingPt ? `${textEl.letterSpacingPt * state.zoom}px` : 'normal';
    textarea.style.textAlign = textEl.alignment || 'left';
    textarea.style.color = textColor;
    textarea.style.backgroundColor = bg;
    textarea.style.padding = `${Math.max(4, paddingPx)}px`;
    textarea.style.boxSizing = 'border-box';
    textarea.style.border = '2px solid #00b4d8';
    textarea.style.boxShadow = '0 0 16px rgba(0, 180, 216, 0.55), inset 0 0 4px rgba(0, 0, 0, 0.05)';
    textarea.style.borderRadius = '3px';
    textarea.style.outline = 'none';
    textarea.style.resize = 'both';
    textarea.style.overflow = 'auto';
    textarea.style.zIndex = '1000';
    textarea.style.transformOrigin = 'top left';
    if (textEl.rotation) {
      textarea.style.transform = `rotate(${textEl.rotation}deg)`;
    }

    let isClosed = false;
    const finish = (commit: boolean, rememberSelection: boolean = false) => {
      if (isClosed) return;
      isClosed = true;
      const updatedText = textarea.value;
      if (rememberSelection) {
        this.rememberedTextSelection = {
          elementId: textEl.id,
          text: updatedText,
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
        };
      }
      textarea.remove();
      this.activeInlineEditor = null;
      const current = stateManager.getActiveSpread() === spread ? spread.elements.find(item => item.id === elementId) : undefined;
      if (commit && current?.type === 'text' && current.text === originalText && updatedText !== current.text) {
        stateManager.updateElement(textEl.id, { text: updatedText });
      }
      this.scheduleRender();
    };

    textarea.addEventListener('keydown', (ke: KeyboardEvent) => {
      ke.stopPropagation();
      if (ke.key === 'Escape') {
        ke.preventDefault();
        finish(false);
      } else if ((ke.ctrlKey || ke.metaKey) && ke.key === 'Enter') {
        ke.preventDefault();
        finish(true);
      }
    });

    textarea.addEventListener('blur', (fe: FocusEvent) => {
      // Remember the selection only when focus moved to a control outside the canvas.
      const next = fe.relatedTarget as Node | null;
      const focusMovedToUi = next instanceof HTMLElement && !this.canvas.contains(next);
      finish(true, focusMovedToUi);
    });

    const parent = this.canvas.parentElement || this.container;
    parent.appendChild(textarea);

    this.activeInlineEditor = {
      elementId: textEl.id,
      el: textarea,
      finish,
    };

    textarea.focus({ preventScroll: true });
    textarea.select();
    this.scheduleRender();
  }

  /**
   * Caret / selection in the inline text editor of `elementId`, as offsets into the editor's text.
   * Falls back to the selection remembered when the editor just lost focus to the UI.
   * Returns null when that frame is not being edited, so callers apply to the whole frame.
   */
  public getActiveTextSelection(elementId: string): { text: string; start: number; end: number } | null {
    if (this.activeInlineEditor && this.activeInlineEditor.elementId === elementId) {
      const ta = this.activeInlineEditor.el as HTMLTextAreaElement;
      if (typeof ta.selectionStart !== 'number' || typeof ta.selectionEnd !== 'number') return null;
      return { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
    }
    const remembered = this.rememberedTextSelection;
    if (remembered && remembered.elementId === elementId) {
      return { text: remembered.text, start: remembered.start, end: remembered.end };
    }
    return null;
  }

  public closeInlineTextEditor(commit: boolean = true): void {
    if (!this.activeInlineEditor) return;
    const { elementId, el, finish, live } = this.activeInlineEditor;
    // The textarea editor closes itself; the code below is for in-place editing.
    if (finish) { finish(commit); return; }
    this.activeInlineEditor = null;
    const text = (el as HTMLTextAreaElement | HTMLInputElement).value;
    const spread = stateManager.getActiveSpread();
    const currentEl = spread.elements.find((item) => item.id === elementId);
    const changed = currentEl && currentEl.type === 'text' && (currentEl as TextElement).text !== text;
    // Take the formatted draft before the editor goes away; it is what the canvas has been showing.
    const draft = commit && changed && live ? live.content(currentEl as TextElement) : null;
    live?.destroy();
    el.remove();
    if (commit && changed) {
      if (!draft || !this.commitLiveStory(currentEl as TextElement, draft, text)) {
        stateManager.updateElement(elementId, { text });
      }
    }
    this.scheduleRender();
  }

  private openLiveTextEditor(textEl: TextElement, options: LiveTextOpenOptions): void {
    const id = textEl.id;
    const parent = this.canvas.parentElement || this.container;
    const frame = () => {
      const current = stateManager.getActiveSpread().elements.find(item => item.id === id);
      return current?.type === 'text' ? current : null;
    };
    const live = new LiveTextEditor({
      parent,
      frame,
      compose: (current, value, content) => this.composeLiveText(current, value, content),
      box: current => this.liveTextBox(current),
      requestRender: () => this.scheduleRender(),
      close: (commit, toUi) => {
        const active = this.activeInlineEditor;
        if (active?.live !== live) return;
        if (toUi) {
          this.rememberedTextSelection = { elementId: id, text: live.value, ...live.selection };
        }
        this.closeInlineTextEditor(commit);
      },
    }, textEl, this.canvas, options);
    this.activeInlineEditor = { elementId: id, el: live.textarea, live, selectionAtOpen: this.selectionKey() };
    this.render();
  }

  /**
   * Commit a formatted story edited in place. The draft was built one edit at a time, so it is stored
   * as content: sending only the text would make the document re-derive the formatting from a single
   * before/after comparison and restyle everything between two separate edits.
   */
  private commitLiveStory(frame: TextElement, draft: StoryContent, text: string): boolean {
    try {
      const story = stateManager.getStoryContent(frame.id);
      const start = frame.storyStart ?? 0;
      const end = frame.storyEnd ?? storyText(story).length;
      stateManager.setStoryContent(frame.id, spliceStory(story, start, end, draft));
    } catch {
      // A locked frame elsewhere in the thread, for one: fall back to the frame-level text edit.
      return false;
    }
    stateManager.onMutation?.({ type: 'update', elementId: frame.id, updates: { text } as Partial<CanvasElement> });
    return true;
  }

  /** Lay out the frame as it will look once the editor's text is committed. */
  private composeLiveText(text: TextElement, value: string, draft?: StoryContent | null): LiveTextComposition {
    const state = stateManager.getState();
    const spread = stateManager.getActiveSpread();
    const obstacles = publicationWrapObjects(state, spread).filter(other => other.id !== text.id && other.pageId === text.pageId);
    const content = draft || liveStoryContent(text, value, obstacles.length > 0);
    const layout = layoutStory(content, text, state.paragraphStyles, state.characterStyles,
      undefined, layoutFrameNotes(state, text).height, { obstacles, baselineGrid: state.settings.baselineGrid });
    return {
      content, lines: layout.lines, consumed: layout.consumed, overset: layout.overset,
      live: indexLines(layout.lines, value, content, text, state.paragraphStyles, state.characterStyles),
      topBaseline: !text.textContent && !obstacles.length,
    };
  }

  private liveTextBox(text: TextElement): LiveTextBox {
    const state = stateManager.getState();
    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    const pageIdx = Math.max(0, stateManager.getActiveSpread().pages.findIndex(page => page.id === text.pageId));
    return { x: origin.x + (pageIdx * state.settings.widthMm + text.x) * pxPerMm, y: origin.y + text.y * pxPerMm, pxPerMm };
  }

  private selectionKey(): string {
    const state = stateManager.getState();
    return `${state.activeSpreadIndex}:${state.selectedElementId || ''}:${(state.selectedElementIds || []).join(',')}`;
  }

  /** Keep in-place editing consistent with the document: close it when its frame can no longer be edited. */
  private syncLiveTextEditor(): void {
    const active = this.activeInlineEditor;
    if (!active?.live) return;
    const state = stateManager.getState();
    const current = stateManager.getActiveSpread().elements.find(item => item.id === active.elementId);
    // Selecting something else ends the edit; a frame opened without being selected stays open.
    const selected = state.selectedElementIds?.length ? state.selectedElementIds.includes(active.elementId) : state.selectedElementId === active.elementId;
    const deselected = !selected && this.selectionKey() !== active.selectionAtOpen;
    if (!current || current.type !== 'text' || current.locked) {
      this.closeInlineTextEditor(false);
    } else if (deselected || state.previewMode || !supportsLiveEditing(current, state.paragraphStyles)) {
      this.closeInlineTextEditor(true);
    } else {
      active.live.syncWithState(current);
    }
  }

  /**
   * Continue in-place editing after a panel control took focus to act on the text selection
   * (applying a paragraph style), with the caret or selection where it was.
   */
  public resumeInlineTextEditor(elementId: string): void {
    const remembered = this.rememberedTextSelection;
    if (this.activeInlineEditor || !remembered || remembered.elementId !== elementId || !liveTextEditingEnabled()) return;
    const state = stateManager.getState();
    const current = stateManager.getActiveSpread().elements.find(item => item.id === elementId);
    if (current?.type !== 'text' || current.locked || state.previewMode || !supportsLiveEditing(current, state.paragraphStyles)) return;
    this.openInlineTextEditor(elementId, { selection: { start: remembered.start, end: remembered.end } });
  }

  /** Whether text frames are edited in place (default) or always in the textarea editor. */
  public get liveTextEditing(): boolean { return liveTextEditingEnabled(); }
  public set liveTextEditing(enabled: boolean) {
    this.closeInlineTextEditor(true);
    setLiveTextEditingEnabled(enabled);
  }

  /** Caret of the in-place editor in canvas CSS pixels, or null. For tests and tooling. */
  public getLiveTextCaret(): { x: number; y: number; height: number } | null {
    const live = this.activeInlineEditor?.live;
    if (!live) return null;
    // Paints are batched per animation frame; draw now so the answer reflects the latest input.
    this.render();
    return live.caretBox();
  }

  public openInlineTableCellEditor(tableId: string, e?: MouseEvent): void {
    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find((item) => item.id === tableId);
    if (!el || el.type !== 'table') return;
    const table = el as TableElement;
    const rows = Math.max(1, table.rows || 1);
    const cols = Math.max(1, table.cols || 1);

    const pageIdx = spread.pages.findIndex((p) => p.id === table.pageId);
    if (pageIdx === -1) return;

    const state = stateManager.getState();
    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    const pageWidthMm = state.settings.widthMm;
    const pageStartMm = pageIdx * pageWidthMm;

    const elScreenX = origin.x + ((pageStartMm + table.x) * pxPerMm);
    const elScreenY = origin.y + (table.y * pxPerMm);
    const elScreenW = table.width * pxPerMm;
    const elScreenH = table.height * pxPerMm;

    let targetR = 0;
    let targetC = 0;

    if (e) {
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left - elScreenX;
      const clickY = e.clientY - rect.top - elScreenY;
      const cellW = elScreenW / cols;
      const cellH = elScreenH / rows;
      targetC = Math.max(0, Math.min(cols - 1, Math.floor(clickX / cellW)));
      targetR = Math.max(0, Math.min(rows - 1, Math.floor(clickY / cellH)));
    }

    const cellW = elScreenW / cols;
    const cellH = elScreenH / rows;
    const cellScreenX = elScreenX + targetC * cellW;
    const cellScreenY = elScreenY + targetR * cellH;

    const currentText = table.cells?.[targetR]?.[targetC]?.text || '';

    this.closeInlineTextEditor(true);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'canvas-inline-cell-editor';
    input.value = currentText;

    input.style.position = 'absolute';
    input.style.left = `${Math.round(cellScreenX)}px`;
    input.style.top = `${Math.round(cellScreenY)}px`;
    input.style.width = `${Math.max(40, Math.round(cellW))}px`;
    input.style.height = `${Math.max(20, Math.round(cellH))}px`;
    input.style.fontSize = `${Math.max(9, (table.fontSizePt || 10) * (96 / 72) * state.zoom)}px`;
    input.style.fontFamily = table.fontFamily || 'Inter, sans-serif';
    input.style.boxSizing = 'border-box';
    input.style.border = '2px solid #00b4d8';
    input.style.boxShadow = '0 0 10px rgba(0, 180, 216, 0.5)';
    input.style.background = '#ffffff';
    input.style.color = '#111111';
    input.style.padding = '2px 4px';
    input.style.zIndex = '1000';
    input.style.outline = 'none';

    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      const val = input.value;
      input.remove();
      stateManager.updateTableCell(table.id, targetR, targetC, val);
      this.render();
    };

    input.addEventListener('keydown', (ke: KeyboardEvent) => {
      ke.stopPropagation();
      if (ke.key === 'Enter') {
        ke.preventDefault();
        commit();
      } else if (ke.key === 'Escape') {
        ke.preventDefault();
        finished = true;
        input.remove();
      }
    });

    input.addEventListener('blur', () => {
      commit();
    });

    const parent = this.canvas.parentElement || this.container;
    parent.appendChild(input);
    input.focus();
    input.select();
  }

  public openInlineTextOnPathEditor(pathId: string): void {
    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find((item) => item.id === pathId);
    if (!el || el.type !== 'path') return;
    const pathEl = el as VectorPathElement;
    const currentText = pathEl.textOnPath?.text || '';

    const pageIdx = spread.pages.findIndex((p) => p.id === pathEl.pageId);
    if (pageIdx === -1) return;

    const state = stateManager.getState();
    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    const pageWidthMm = state.settings.widthMm;
    const pageStartMm = pageIdx * pageWidthMm;

    const startNode = pathEl.nodes[0] || { x: pathEl.x, y: pathEl.y };
    const elScreenX = origin.x + ((pageStartMm + startNode.x) * pxPerMm);
    const elScreenY = origin.y + (startNode.y * pxPerMm);

    this.closeInlineTextEditor(true);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'canvas-inline-cell-editor';
    input.value = currentText;
    input.placeholder = 'Text on path...';

    input.style.position = 'absolute';
    input.style.left = `${Math.round(elScreenX)}px`;
    input.style.top = `${Math.round(elScreenY - 30)}px`;
    input.style.width = '180px';
    input.style.height = '28px';
    input.style.fontSize = '12px';
    input.style.fontFamily = 'Inter, sans-serif';
    input.style.boxSizing = 'border-box';
    input.style.border = '2px solid #00b4d8';
    input.style.boxShadow = '0 0 10px rgba(0, 180, 216, 0.5)';
    input.style.background = '#ffffff';
    input.style.color = '#111111';
    input.style.padding = '4px 8px';
    input.style.borderRadius = '4px';
    input.style.zIndex = '1000';
    input.style.outline = 'none';

    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      const val = input.value.trim();
      input.remove();
      if (val) {
        stateManager.updateElement(pathEl.id, {
          textOnPath: {
            text: val,
            fontSizePt: pathEl.textOnPath?.fontSizePt || 14,
            fontFamily: pathEl.textOnPath?.fontFamily || 'Inter, sans-serif',
            color: pathEl.textOnPath?.color || '#111111',
            align: pathEl.textOnPath?.align || 'left',
            startOffsetMm: pathEl.textOnPath?.startOffsetMm || 0,
          },
        });
      } else {
        stateManager.updateElement(pathEl.id, { textOnPath: undefined });
      }
      this.render();
    };

    input.addEventListener('keydown', (ke: KeyboardEvent) => {
      ke.stopPropagation();
      if (ke.key === 'Enter') {
        ke.preventDefault();
        commit();
      } else if (ke.key === 'Escape') {
        ke.preventDefault();
        finished = true;
        input.remove();
      }
    });

    input.addEventListener('blur', () => {
      commit();
    });

    const parent = this.canvas.parentElement || this.container;
    parent.appendChild(input);
    input.focus();
    input.select();
  }

  private handleDoubleClick(e?: MouseEvent) {
    const state = stateManager.getState();
    let targetId = state.selectedElementId;

    if (e) {
      const rect = this.canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      // Inside the frame being edited in place a double click selects a word; the press handled it.
      if (this.activeInlineEditor?.live?.pointerMove(screenX, screenY)) return;
      this.screenToSpreadMm(screenX, screenY, state);
      const hit = this.hitTestElements(this._pointMm.x, this._pointMm.y, state);
      if (hit && !hit.locked) {
        targetId = hit.id;
        stateManager.selectElement(hit.id);
      }
    }

    if (!targetId) return;

    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find((item) => item.id === targetId);
    if (!el) return;

    if (el.type === 'text') {
      // A double click starts typing where it landed; opening from the keyboard selects everything.
      this.openInlineTextEditor(el.id, e ? { point: e } : {});
    } else if (el.type === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (file && stateManager.getElementById(el.id) === el) void this.replaceCanvasImage(el.id, file);
      };
      input.click();
    } else if (el.type === 'table') {
      this.openInlineTableCellEditor(el.id, e);
    } else if (el.type === 'path') {
      this.openInlineTextOnPathEditor(el.id);
    }
  }

  private async handleFileDrop(e: DragEvent) {
    e.preventDefault();
    const state = stateManager.getState();
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;

    const file = e.dataTransfer.files[0];
    if (!file.type.startsWith('image/')) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const { x: mmX, y: mmY } = this.screenToSpreadMm(screenX, screenY, state);

    const hit = this.hitTestElements(mmX, mmY, state);
    if (hit?.type === 'image') {
      e.stopPropagation();
      void this.replaceCanvasImage(hit.id, file);
      return;
    }
    const spread = stateManager.getActiveSpread();
    const pageHit = this.findPageAtMm(mmX, mmY, state);
    if (!pageHit) return;
    e.stopPropagation();
    try {
      const { readPlacedImage } = await import('./engine/placedImage');
      const image = await readPlacedImage(file);
      if (stateManager.getState() !== state || stateManager.getActiveSpread() !== spread) {
        throw new Error('The document or spread changed. Drop the image again on its intended page.');
      }
      stateManager.addElement({
        ...image,
        id: crypto.randomUUID(),
        type: 'image',
        pageId: pageHit.page.id,
        x: Math.round(pageHit.localX - 40),
        y: Math.round(pageHit.localY - 30),
        width: 80,
        height: 60,
        rotation: 0,
        opacity: 1,
        zIndex: 10,
        locked: false,
        fitMode: 'fill',
        borderColor: '#111111',
        borderWidthMm: 0.3,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not place the dropped image.');
    }
  }

  private async replaceCanvasImage(elementId: string, file: File) {
    try {
      if (!await stateManager.registerImageAsset(elementId, file)) {
        alert('The image frame changed or is locked. Select it and try again.');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not replace the image.');
    }
  }

  private buildSpreadScene(state: ProjectState, spread: Spread, revision: number) {
    const layerMap = new Map((state.layers || []).map(l => [l.id, l]));
    const pageIndexes = new Map(spread.pages.map((page, index) => [page.id, index]));
    const elements = new Map(spread.elements.map(element => [element.id, element]));
    const layerOf = (element: CanvasElement) => layerMap.get(element.layerId || 'layer-1');
    const paintOrder = (a: CanvasElement, b: CanvasElement) => (layerOf(a)?.order ?? 0) - (layerOf(b)?.order ?? 0) || a.zIndex - b.zIndex;
    const master = resolveMaster(state.masterSpreads, spread.masterSpreadId);
    const excludedMasterIds = new Set(spread.detachedMasterElementIds);
    for (const element of spread.elements) if (element.masterSourceId) excludedMasterIds.add(element.masterSourceId);
    const inherited = (master?.elements || []).filter(element => !excludedMasterIds.has(element.id));
    const publicationText = createPublicationTextResolver(state);
    const masterElements = inherited.flatMap(element => {
      const page = masterTargetPage(master!.pages, spread.pages, element.pageId);
      return page ? [instantiateMasterItem(element, page.id, text => publicationText(text, page.pageNumber))] : [];
    });
    const visible = (element: CanvasElement) => layerOf(element)?.visible !== false;
    const artwork = [...masterElements.filter(visible).sort(paintOrder), ...spread.elements.filter(visible).sort(paintOrder)];
    const otherSpreads = new Map<string, Spread | undefined>();
    const paragraphStyles = new Map(state.paragraphStyles.map(style => [style.id, style]));
    let wrapByPage: Map<string, CanvasElement[]> | undefined;
    let hitOrder: CanvasElement[] | undefined;
    return {
      state, spread, revision, layerMap, layerOf, pageIndexes, elements, master, inherited, artwork, paragraphStyles,
      layoutNotes: createFrameNoteLayoutLookup(state, 32),
      adjustedImages: artwork.reduce((count, element) => count + Number(element.type === 'image' && Boolean(element.adjustments)), 0),
      hitOrder: () => hitOrder ??= spread.elements.filter(element => visible(element) && !layerOf(element)?.locked)
        .sort((a, b) => paintOrder(b, a)),
      linkedSpread: (id: string) => {
        if (!otherSpreads.has(id)) otherSpreads.set(id, state.spreads.find(item => item.elements.some(element => element.id === id)));
        return otherSpreads.get(id);
      },
      wrapOnPage: (pageId: string) => {
        if (!wrapByPage) {
          wrapByPage = new Map();
          for (const obstacle of publicationWrapObjects(state, spread)) {
            const page = wrapByPage.get(obstacle.pageId);
            if (page) page.push(obstacle);
            else wrapByPage.set(obstacle.pageId, [obstacle]);
          }
        }
        return wrapByPage.get(pageId);
      },
    };
  }

  private getSpreadScene(state: ProjectState) {
    const spread = stateManager.getActiveSpread();
    const revision = stateManager.getDocumentRevision();
    if (this.spreadScene?.state !== state || this.spreadScene.spread !== spread || this.spreadScene.revision !== revision) {
      if (this.spreadScene?.spread !== spread || this.spreadScene.state !== state) this.formattedLayouts.clear();
      this.spreadScene = this.buildSpreadScene(state, spread, revision);
    }
    return this.spreadScene;
  }

  private hitTestElements(spreadMmX: number, spreadMmY: number, state: ProjectState): CanvasElement | null {
    const { pageIndexes, hitOrder } = this.getSpreadScene(state);
    const { pageWidthMm } = this.getSpreadDimensions(state);
    for (const el of hitOrder()) {
      const pageIdx = pageIndexes.get(el.pageId);
      if (pageIdx === undefined) continue;

      const pageStartMm = pageIdx * pageWidthMm;
      const elGlobalX = pageStartMm + el.x;
      const elGlobalY = el.y;

      if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        let closeToPath = false;
        for (const n of pathEl.nodes) {
          if (Math.hypot(spreadMmX - (elGlobalX + n.x), spreadMmY - (elGlobalY + n.y)) <= 6) {
            closeToPath = true;
            break;
          }
        }
        if (
          closeToPath ||
          (spreadMmX >= elGlobalX - 3 &&
           spreadMmX <= elGlobalX + el.width + 3 &&
           spreadMmY >= elGlobalY - 3 &&
           spreadMmY <= elGlobalY + el.height + 3)
        ) {
          return el;
        }
        continue;
      }

      if (
        spreadMmX >= elGlobalX &&
        spreadMmX <= elGlobalX + el.width &&
        spreadMmY >= elGlobalY &&
        spreadMmY <= elGlobalY + el.height
      ) {
        return el;
      }
    }
    return null;
  }

  private hitTestMasterElements(spreadMmX: number, spreadMmY: number, state: ProjectState): { masterElement: CanvasElement; targetPage: Page } | null {
    const { spread, master, inherited, pageIndexes } = this.getSpreadScene(state);
    if (!master) return null;

    const { pageWidthMm, pageHeightMm } = this.getSpreadDimensions(state);

    for (let i = inherited.length - 1; i >= 0; i--) {
      const mEl = inherited[i];

      const masterPage = master.pages.find((p) => p.id === mEl.pageId);
      let targetPage = spread.pages.find((p) => masterPage && p.side === masterPage.side);
      if (!targetPage) targetPage = spread.pages[0];
      if (!targetPage) continue;

      const pageIdx = pageIndexes.get(targetPage.id);
      if (pageIdx === undefined) continue;

      const pageStartMm = pageIdx * pageWidthMm;
      let masterY = mEl.y;
      if (masterY + (mEl.height || 0) > pageHeightMm - 2) {
        masterY = Math.max(0, pageHeightMm - (state.settings.margins.bottomMm || 15) + 2);
      }

      const elX = pageStartMm + mEl.x;
      const elY = masterY;
      if (
        spreadMmX >= elX &&
        spreadMmX <= elX + mEl.width &&
        spreadMmY >= elY &&
        spreadMmY <= elY + mEl.height
      ) {
        return { masterElement: mEl, targetPage };
      }
    }
    return null;
  }

  private startNodeDrag(path: VectorPathElement, nodeIndex: number, part: NonNullable<SpreadCanvas['activeNodeDrag']>['part'], startDragX: number, startDragY: number) {
    this.cancelDrag();
    const state = stateManager.getState();
    this.beginDrag(state);
    this.activeNodeDrag = { path, nodeIndex, part, startDragX, startDragY };
  }

  private previewNodeDrag(screenX: number, screenY: number, mmX: number, mmY: number, state: ProjectState, split: boolean) {
    const drag = this.activeNodeDrag;
    if (!drag) return;
    const { path, nodeIndex, part } = drag;
    const original = path.nodes[nodeIndex];
    if (part === 'newHandle') {
      const pageIndex = this.getSpreadScene(state).pageIndexes.get(path.pageId) ?? 0;
      const dx = mmX - pageIndex * state.settings.widthMm - path.x - original.x;
      const dy = mmY - path.y - original.y;
      drag.pending = Math.hypot(dx, dy) < 0.5 ? original : {
        ...original, handleOut: { x: dx, y: dy }, handleIn: { x: -dx, y: -dy },
      };
      return;
    }

    const pxPerMm = MM_TO_PX * state.zoom;
    const dx = (screenX - drag.startDragX) / pxPerMm;
    const dy = (screenY - drag.startDragY) / pxPerMm;
    if (part === 'anchor') {
      drag.pending = { ...original, x: original.x + dx, y: original.y + dy };
      return;
    }
    const draft = this.dragPreview.get(path.id);
    const current = drag.pending ?? (draft?.type === 'path' ? draft.nodes[nodeIndex] : original);
    const opposite = part === 'handleIn' ? 'handleOut' : 'handleIn';
    const handle = { x: (original[part]?.x ?? 0) + dx, y: (original[part]?.y ?? 0) + dy };
    drag.pending = { ...original, [part]: handle, [opposite]: split ? current[opposite] : { x: -handle.x, y: -handle.y } };
  }

  private flushNodePreview() {
    const drag = this.activeNodeDrag;
    if (!drag?.pending) return;
    const { path, nodeIndex, pending } = drag;
    drag.pending = undefined;
    const original = path.nodes[nodeIndex];
    const equal = (a?: { x: number; y: number }, b?: { x: number; y: number }) => a?.x === b?.x && a?.y === b?.y;
    if (equal(pending, original) && equal(pending.handleIn, original.handleIn) && equal(pending.handleOut, original.handleOut)) {
      this.dragPreview.delete(path.id);
      return;
    }
    const nodes = path.nodes.slice();
    nodes[nodeIndex] = pending;
    const { width, height } = this.recalculatePathBounds(nodes);
    this.dragPreview.set(path.id, { ...path, nodes, width, height });
  }

  private recalculatePathBounds(nodes: BezierNode[]): { minX: number; minY: number; width: number; height: number } {
    if (nodes.length === 0) return { minX: 0, minY: 0, width: 20, height: 20 };
    let minX = nodes[0].x;
    let maxX = nodes[0].x;
    let minY = nodes[0].y;
    let maxY = nodes[0].y;
    for (const n of nodes) {
      minX = Math.min(minX, n.x, n.x + (n.handleIn?.x || 0), n.x + (n.handleOut?.x || 0));
      maxX = Math.max(maxX, n.x, n.x + (n.handleIn?.x || 0), n.x + (n.handleOut?.x || 0));
      minY = Math.min(minY, n.y, n.y + (n.handleIn?.y || 0), n.y + (n.handleOut?.y || 0));
      maxY = Math.max(maxY, n.y, n.y + (n.handleIn?.y || 0), n.y + (n.handleOut?.y || 0));
    }
    return {
      minX,
      minY,
      width: Math.max(5, Math.ceil(maxX - minX)),
      height: Math.max(5, Math.ceil(maxY - minY)),
    };
  }

  private hitTestPathNodes(screenX: number, screenY: number, state: ProjectState): {
    part: 'anchor' | 'handleIn' | 'handleOut';
    nodeIndex: number;
  } | null {
    if (!state.selectedElementId) return null;
    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find(item => item.id === state.selectedElementId);
    if (!el || el.type !== 'path') return null;
    const elLayer = state.layers?.find(l => l.id === (el.layerId || 'layer-1'));
    if (el.locked || Boolean(elLayer?.locked) || elLayer?.visible === false || Boolean(el.editorialOnly)) return null;

    const pathEl = el as VectorPathElement;
    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    const pageIdx = spread.pages.findIndex(p => p.id === el.pageId);
    const { pageWidthMm } = this.getSpreadDimensions(state);
    const pageStartMm = (pageIdx !== -1 ? pageIdx : 0) * pageWidthMm;

    const elScreenX = origin.x + ((pageStartMm + el.x) * pxPerMm);
    const elScreenY = origin.y + (el.y * pxPerMm);

    const hitRadiusPx = 8;

    for (let i = 0; i < pathEl.nodes.length; i++) {
      const n = pathEl.nodes[i];
      const ax = elScreenX + n.x * pxPerMm;
      const ay = elScreenY + n.y * pxPerMm;

      // Handle in
      if (n.handleIn) {
        const hInX = ax + n.handleIn.x * pxPerMm;
        const hInY = ay + n.handleIn.y * pxPerMm;
        if (Math.hypot(screenX - hInX, screenY - hInY) <= hitRadiusPx) {
          return { part: 'handleIn', nodeIndex: i };
        }
      }

      // Handle out
      if (n.handleOut) {
        const hOutX = ax + n.handleOut.x * pxPerMm;
        const hOutY = ay + n.handleOut.y * pxPerMm;
        if (Math.hypot(screenX - hOutX, screenY - hOutY) <= hitRadiusPx) {
          return { part: 'handleOut', nodeIndex: i };
        }
      }

      // Anchor
      if (Math.hypot(screenX - ax, screenY - ay) <= hitRadiusPx) {
        return { part: 'anchor', nodeIndex: i };
      }
    }
    return null;
  }

  private handlePenMouseDown(mmX: number, mmY: number, screenX: number, screenY: number) {
    const state = stateManager.getState();
    const spread = stateManager.getActiveSpread();
    const pageHit = this.findPageAtMm(mmX, mmY, state);
    if (!pageHit) return;

    if (this.activePenPathId) {
      const pathEl = spread.elements.find(item => item.id === this.activePenPathId) as VectorPathElement | undefined;
      if (pathEl && pathEl.nodes.length > 0) {
        // Path closure detection threshold (5mm)
        const firstNode = pathEl.nodes[0];
        const distToFirst = Math.hypot(pageHit.localX - (pathEl.x + firstNode.x), pageHit.localY - (pathEl.y + firstNode.y));
        if (distToFirst <= 5 && pathEl.nodes.length >= 2) {
          stateManager.updateElement(pathEl.id, { closed: true });
          this.activePenPathId = null;
          stateManager.setTool('select');
          this.render();
          return;
        }

        // Add next node
        const newNodeX = pageHit.localX - pathEl.x;
        const newNodeY = pageHit.localY - pathEl.y;
        const newNodes: BezierNode[] = [...pathEl.nodes, { x: newNodeX, y: newNodeY }];
        const bounds = this.recalculatePathBounds(newNodes);
        stateManager.updateElement(pathEl.id, {
          nodes: newNodes,
          width: bounds.width,
          height: bounds.height,
        });
        const updated = stateManager.getElementById(pathEl.id);
        if (updated?.type === 'path') this.startNodeDrag(updated, newNodes.length - 1, 'newHandle', screenX, screenY);
        this.scheduleRender();
        return;
      }
    }

    // Start a brand new path
    const newId = `path-${Date.now()}`;
    const newPath: VectorPathElement = {
      id: newId,
      type: 'path',
      pageId: pageHit.page.id,
      x: Math.round(pageHit.localX),
      y: Math.round(pageHit.localY),
      width: 20,
      height: 20,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      locked: false,
      nodes: [{ x: 0, y: 0 }],
      closed: false,
      fillColor: 'transparent',
      strokeColor: '#111111',
      strokeWidthMm: 0.5,
      strokeCap: 'round',
      strokeJoin: 'round',
      strokeDash: 'solid',
    };

    stateManager.addElement(newPath);
    stateManager.selectElements([newId]);
    this.activePenPathId = newId;
    this.startNodeDrag(newPath, 0, 'newHandle', screenX, screenY);
    this.scheduleRender();
  }

  private handlePointerDown(e: PointerEvent) {
    this.currentPointerType = e.pointerType || 'mouse';
    this.currentPointerPressure = e.pressure > 0 ? e.pressure : 0.5;

    if (e.pointerType === 'pen') {
      this.activePenPointerId = e.pointerId;
    }

    const state = stateManager.getState();
    if (state.activeTool === 'pencil') {
      if (e.button === 0 || e.pointerType === 'pen' || e.pointerType === 'touch') {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { x: mmX, y: mmY } = this.screenToSpreadMm(screenX, screenY, state);
        this.handlePencilMouseDown(mmX, mmY, screenX, screenY, e);
        if (e.cancelable) e.preventDefault();
      }
    }
  }

  private handlePointerMove(e: PointerEvent) {
    if (e.pointerType) {
      this.currentPointerType = e.pointerType;
    }
    if (e.pressure > 0) {
      this.currentPointerPressure = e.pressure;
    }
    if (this.isPencilDrawing) {
      this.handlePencilMouseMove(e);
    }
  }

  private handlePointerUp(e: PointerEvent) {
    stateManager.finishUndoGroup();
    if (e.pointerId === this.activePenPointerId) {
      this.activePenPointerId = null;
    }
    if (this.isPencilDrawing) {
      this.handlePencilMouseUp();
    }
  }

  private handlePointerCancel(e: PointerEvent) {
    if (this.dragDocument) { this.cancelDrag(); this.scheduleRender(); }
    if (e.pointerId === this.activePenPointerId) {
      this.activePenPointerId = null;
    }
    if (this.isPencilDrawing) {
      this.isPencilDrawing = false;
      this.pencilStrokePoints = [];
      this.pencilTargetPage = null;
      this.scheduleRender();
    }
  }

  private handlePencilMouseDown(mmX: number, mmY: number, screenX: number, screenY: number, e: CanvasMouseDown | PointerEvent) {
    if (this.isPencilDrawing) return;
    const state = stateManager.getState();
    const pageHit = this.findPageAtMm(mmX, mmY, state);
    const spread = stateManager.getActiveSpread();
    const targetPage = pageHit ? pageHit.page : (spread.pages[0] || null);
    if (!targetPage) return;

    const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === targetPage.id));
    const { pageWidthMm } = this.getSpreadDimensions(state);
    const pageStartMm = pageIdx * pageWidthMm;
    const localX = mmX - pageStartMm;
    const localY = mmY;
    const pressure = 'pressure' in e && e.pressure > 0 ? e.pressure : 0.5;

    this.isPencilDrawing = true;
    this.pencilTargetPage = targetPage;
    this.pencilStrokePoints = [{ x: localX, y: localY, pressure }];
    this.scheduleRender();
  }

  private handlePencilMouseMove(e: CanvasMouseMove | PointerEvent) {
    if (!this.isPencilDrawing || !this.pencilTargetPage) return;
    const state = stateManager.getState();
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const { x: mmX, y: mmY } = this.screenToSpreadMm(screenX, screenY, state);

    const spread = stateManager.getActiveSpread();
    const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === this.pencilTargetPage!.id));
    const { pageWidthMm } = this.getSpreadDimensions(state);
    const pageStartMm = pageIdx * pageWidthMm;
    const localX = mmX - pageStartMm;
    const localY = mmY;
    const pressure = 'pressure' in e && e.pressure > 0 ? e.pressure : 0.5;

    const lastPt = this.pencilStrokePoints[this.pencilStrokePoints.length - 1];
    if (!lastPt || Math.hypot(localX - lastPt.x, localY - lastPt.y) >= 0.4) {
      this.pencilStrokePoints.push({ x: localX, y: localY, pressure });
      this.scheduleRender();
    }
  }

  private handlePencilMouseUp() {
    if (!this.isPencilDrawing) return;
    this.isPencilDrawing = false;
    const points = [...this.pencilStrokePoints];
    const targetPage = this.pencilTargetPage;
    this.pencilStrokePoints = [];
    this.pencilTargetPage = null;

    if (points.length >= 2 && targetPage) {
      const { nodes, minX, minY, width, height } = this.fitPencilToBezierNodes(points);
      if (nodes.length >= 2) {
        const strokeWidthMm = 0.5;
        const strokeColor = '#111111';
        const newId = `pencil-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const pathElement: VectorPathElement = {
          id: newId,
          type: 'path',
          pageId: targetPage.id,
          x: Math.round(minX * 100) / 100,
          y: Math.round(minY * 100) / 100,
          width: Math.round(Math.max(1, width) * 100) / 100,
          height: Math.round(Math.max(1, height) * 100) / 100,
          rotation: 0,
          opacity: 1,
          zIndex: 10,
          locked: false,
          nodes,
          closed: false,
          fillColor: 'transparent',
          strokeColor: strokeColor,
          strokeWidthMm: strokeWidthMm,
          strokeCap: 'round',
          strokeJoin: 'round',
          strokeDash: 'solid',
        };
        stateManager.addElement(pathElement);
        stateManager.selectElements([newId]);

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(10); } catch (_) {}
        }
      }
    }
    this.scheduleRender();
  }

  private fitPencilToBezierNodes(points: Array<{ x: number; y: number; pressure: number }>): {
    nodes: BezierNode[];
    minX: number;
    minY: number;
    width: number;
    height: number;
  } {
    if (points.length < 2) {
      return { nodes: [], minX: 0, minY: 0, width: 0, height: 0 };
    }

    const simplified: Array<{ x: number; y: number }> = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = simplified[simplified.length - 1];
      const curr = points[i];
      const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      if (d >= 0.8 || i === points.length - 1) {
        simplified.push({ x: curr.x, y: curr.y });
      }
    }

    if (simplified.length < 2) {
      simplified.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of simplified) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    const localPts = simplified.map(p => ({
      x: p.x - minX,
      y: p.y - minY,
    }));

    const nodes: BezierNode[] = [];
    const n = localPts.length;

    for (let i = 0; i < n; i++) {
      const curr = localPts[i];
      if (i === 0) {
        const next = localPts[1];
        const hOutX = (next.x - curr.x) / 3;
        const hOutY = (next.y - curr.y) / 3;
        nodes.push({
          x: curr.x,
          y: curr.y,
          handleOut: { x: hOutX, y: hOutY },
        });
      } else if (i === n - 1) {
        const prev = localPts[n - 2];
        const hInX = (prev.x - curr.x) / 3;
        const hInY = (prev.y - curr.y) / 3;
        nodes.push({
          x: curr.x,
          y: curr.y,
          handleIn: { x: hInX, y: hInY },
        });
      } else {
        const prev = localPts[i - 1];
        const next = localPts[i + 1];
        const tanX = (next.x - prev.x) / 6;
        const tanY = (next.y - prev.y) / 6;
        nodes.push({
          x: curr.x,
          y: curr.y,
          handleIn: { x: -tanX, y: -tanY },
          handleOut: { x: tanX, y: tanY },
        });
      }
    }

    return { nodes, minX, minY, width, height };
  }

  private hitTestHandles(screenX: number, screenY: number, state: ProjectState): string | null {
    if (!state.selectedElementId || (state.selectedElementIds && state.selectedElementIds.length > 1)) return null;
    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find(item => item.id === state.selectedElementId);
    if (!el) return null;
    const elLayer = state.layers?.find(l => l.id === (el.layerId || 'layer-1'));
    if (el.locked || Boolean(elLayer?.locked) || elLayer?.visible === false || Boolean(el.editorialOnly)) return null;

    const pageIdx = spread.pages.findIndex(p => p.id === el.pageId);
    const { pageWidthMm } = this.getSpreadDimensions(state);
    const pageStartMm = pageIdx * pageWidthMm;

    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;

    const elScreenX = origin.x + ((pageStartMm + el.x) * pxPerMm);
    const elScreenY = origin.y + (el.y * pxPerMm);
    const elScreenW = el.width * pxPerMm;
    const elScreenH = el.height * pxPerMm;

    const handleRadius = 6;
    const isTouch = (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) || this.currentPointerType === 'touch';
    const hitTolerance = isTouch ? 24 : (handleRadius + 2);
    const handles = this._handles;
    handles[0].x = elScreenX; handles[0].y = elScreenY;
    handles[1].x = elScreenX + elScreenW / 2; handles[1].y = elScreenY;
    handles[2].x = elScreenX + elScreenW; handles[2].y = elScreenY;
    handles[3].x = elScreenX + elScreenW; handles[3].y = elScreenY + elScreenH / 2;
    handles[4].x = elScreenX + elScreenW; handles[4].y = elScreenY + elScreenH;
    handles[5].x = elScreenX + elScreenW / 2; handles[5].y = elScreenY + elScreenH;
    handles[6].x = elScreenX; handles[6].y = elScreenY + elScreenH;
    handles[7].x = elScreenX; handles[7].y = elScreenY + elScreenH / 2;

    for (let i = 0; i < 8; i++) {
      const h = handles[i];
      const dist = Math.hypot(screenX - h.x, screenY - h.y);
      if (dist <= hitTolerance) {
        return h.name;
      }
    }
    return null;
  }

  private drawSpreadBackground(
    ctx: CanvasRenderingContext2D,
    state: ProjectState,
    spread: Spread,
    origin: { x: number; y: number },
    canvasW: number,
    canvasH: number,
    pxPerMm: number,
    numPages: number,
    pageWidthMm: number,
    pageHeightMm: number,
    spreadWidthPx: number,
    spreadHeightPx: number
  ) {
    const grid = state.settings.baselineGrid;
    const bleedMm = (!state.previewMode && state.showBleed) ? state.settings.bleedMm : 0;
    const paddingPx = Math.ceil(Math.max(30, bleedMm * pxPerMm + 24));
    const targetW = Math.ceil(spreadWidthPx + paddingPx * 2);
    const targetH = Math.ceil(spreadHeightPx + paddingPx * 2);
    const cached = targetW <= 4096 && targetH <= 4096 && targetW * targetH <= 4_194_304;
    const { margins, columnCount, columnGutterMm } = state.settings;
    const key = cached ? [targetW, targetH, spreadWidthPx, spreadHeightPx, bleedMm, paddingPx, state.zoom,
      state.showGuides, state.showBaselineGrid, state.previewMode, margins.insideMm, margins.outsideMm,
      margins.topMm, margins.bottomMm, columnCount, columnGutterMm, grid?.incrementPt, grid?.startMm,
      grid?.enabled, ...spread.pages.map(page => page.side)].join(':') : '';
    if (cached && this.staticDirtyKey === key) {
      ctx.drawImage(this.staticCanvas, origin.x - paddingPx, origin.y - paddingPx);
      return;
    }

    // Oversized pages draw directly into the viewport already allocated by the editor.
    if (cached || this.staticCanvas.width) {
      this.staticCanvas.width = cached ? targetW : 0;
      this.staticCanvas.height = cached ? targetH : 0;
    }
    const sctx = cached ? this.staticCtx : ctx;
    const originX = cached ? paddingPx : origin.x;
    const originY = cached ? paddingPx : origin.y;
    const width = cached ? targetW : canvasW;
    const height = cached ? targetH : canvasH;
    sctx.save();

    // Bleed guide line
    if (!state.previewMode && state.showBleed && state.settings.bleedMm > 0) {
      const bleedPx = state.settings.bleedMm * pxPerMm;
      sctx.strokeStyle = '#e63946';
      sctx.lineWidth = 1;
      sctx.setLineDash([4, 4]);
      sctx.strokeRect(
        originX - bleedPx,
        originY - bleedPx,
        spreadWidthPx + (bleedPx * 2),
        spreadHeightPx + (bleedPx * 2)
      );
      sctx.setLineDash([]);
    }

    // Pages background and drop shadows
    for (let i = 0; i < numPages; i++) {
      const pageX = originX + (i * pageWidthMm * pxPerMm);
      const pageW = pageWidthMm * pxPerMm;
      // Clip the shadowed fill with room for the blur kernel outside the viewport.
      const left = Math.max(-48, pageX), top = Math.max(-48, originY);
      const right = Math.min(width + 48, pageX + pageW), bottom = Math.min(height + 48, originY + spreadHeightPx);
      if (left >= right || top >= bottom) continue;

      sctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      sctx.shadowBlur = 18;
      sctx.shadowOffsetX = 0;
      sctx.shadowOffsetY = 4;

      sctx.fillStyle = '#ffffff';
      sctx.fillRect(left, top, right - left, bottom - top);

      sctx.shadowColor = 'transparent';
      sctx.shadowBlur = 0;

      sctx.strokeStyle = '#cccccc';
      sctx.lineWidth = 1;
      sctx.strokeRect(pageX, originY, pageW, spreadHeightPx);

      if (!state.previewMode && state.showGuides) {
        const page = spread.pages[i];

        const isLeft = page.side === 'left';
        const leftMarginMm = isLeft ? margins.outsideMm : margins.insideMm;
        const rightMarginMm = isLeft ? margins.insideMm : margins.outsideMm;

        const mLeftPx = pageX + (leftMarginMm * pxPerMm);
        const mTopPx = originY + (margins.topMm * pxPerMm);
        const mWidthPx = (pageWidthMm - leftMarginMm - rightMarginMm) * pxPerMm;
        const mHeightPx = (pageHeightMm - margins.topMm - margins.bottomMm) * pxPerMm;

        sctx.strokeStyle = '#b5179e';
        sctx.lineWidth = 0.8;
        sctx.strokeRect(mLeftPx, mTopPx, mWidthPx, mHeightPx);

        if (columnCount > 1) {
          const colCount = columnCount;
          const gutterMm = columnGutterMm;
          const totalGuttersMm = gutterMm * (colCount - 1);
          const colWidthMm = ((pageWidthMm - leftMarginMm - rightMarginMm) - totalGuttersMm) / colCount;

          sctx.strokeStyle = '#00b4d8';
          sctx.lineWidth = 0.5;
          sctx.setLineDash([2, 2]);

          for (let c = 0; c < colCount; c++) {
            const colXmm = leftMarginMm + (c * (colWidthMm + gutterMm));
            const colXPx = pageX + (colXmm * pxPerMm);
            const colWPx = colWidthMm * pxPerMm;

            sctx.strokeRect(colXPx, mTopPx, colWPx, mHeightPx);
          }
          sctx.setLineDash([]);
        }

        if (state.showBaselineGrid && grid?.enabled) {
          const pitch = grid.incrementPt * 25.4 / 72 * pxPerMm;
          if (!(pitch > 0) || !Number.isFinite(pitch)) continue;
          // Subpixel rows are indistinguishable. Keep the original rhythm with a visible stride.
          const stride = pitch < 1 ? pitch * Math.ceil(1 / pitch) : pitch;
          const start = originY + (grid.startMm ?? margins.topMm) * pxPerMm;
          const first = start >= 0 ? start : ((start % stride) + stride) % stride;
          const last = Math.min(height, originY + (pageHeightMm - margins.bottomMm) * pxPerMm);

          sctx.strokeStyle = '#3a86ff2e';
          sctx.lineWidth = 0.5;

          sctx.beginPath();
          for (let yPx = first; yPx <= last; yPx += stride) {
            sctx.moveTo(mLeftPx, yPx);
            sctx.lineTo(mLeftPx + mWidthPx, yPx);
          }
          sctx.stroke();
        }
      }
    }

    if (numPages > 1) {
      const spineX = originX + (pageWidthMm * pxPerMm);
      sctx.strokeStyle = '#999999';
      sctx.lineWidth = 1;
      sctx.beginPath();
      sctx.moveTo(spineX, originY);
      sctx.lineTo(spineX, originY + spreadHeightPx);
      sctx.stroke();
    }

    sctx.restore();
    this.staticDirtyKey = key;
    if (cached) ctx.drawImage(this.staticCanvas, origin.x - paddingPx, origin.y - paddingPx);
  }

  private trimDisplayImages(keepProxies: number) {
    this.adjustmentPreviews.clear();
    for (const image of this.fullResCache.values()) {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
    }
    this.fullResCache.clear();
    this.failedImageSrcs.clear();
    for (const [source, canvas] of this.proxyCache) {
      if (this.proxyCache.size <= keepProxies) break;
      canvas.width = canvas.height = 0;
      this.proxyCache.delete(source);
    }
  }

  private getDisplayImage(src: string, quality: DisplayQuality, proxySrc?: string, assetId?: string): HTMLImageElement | HTMLCanvasElement | null {
    if (quality === 'fast') return null;
    const high = quality === 'high' && !this.isDragging && !this.isPanning && !this.isResizing;
    const proxy = !high && (proxySrc || (assetId && assetStore.getScreenProxy(assetId)));
    const source = proxy && !this.failedImageSrcs.has(proxy) ? proxy : src;
    if (!source || this.failedImageSrcs.has(source)) return null;
    const cached = !high && this.proxyCache.get(source);
    if (cached) return cached;
    let image = this.fullResCache.get(source);
    if (!image) {
      image = new Image();
      image.onload = () => this.scheduleRender();
      image.onerror = () => {
        this.failedImageSrcs.add(source);
        this.fullResCache.delete(source);
        this.scheduleRender();
      };
      this.fullResCache.set(source, image);
      image.src = source;
    }
    if (!image.complete || !image.naturalWidth) return null;
    if (source === src) stateManager.registerImageDimensions(src, image.naturalWidth, image.naturalHeight);
    if (high) return image;
    const canvas = this.createImageProxy(source, image);
    this.fullResCache.delete(source);
    return canvas;
  }

  private readonly adjustmentPreviews = new AdjustmentPreviewCache(() => this.scheduleRender());
  private vectorDecorationRenderer?: typeof import('./engine/vectorDecoration').drawCanvasDecoration;
  private loadingVectorDecorations = false;

  private drawDecoration(ctx: CanvasRenderingContext2D, element: ShapeElement | VectorPathElement, x: number, y: number, scale: number, path?: Path2D) {
    if (!element.decoration || element.spotColor) return;
    if (this.vectorDecorationRenderer) this.vectorDecorationRenderer(ctx, element.decoration, x, y, element.width, element.height, scale, path);
    else if (!this.loadingVectorDecorations) {
      this.loadingVectorDecorations = true;
      void import('./engine/vectorDecoration').then(module => {
        this.vectorDecorationRenderer = module.drawCanvasDecoration;
        this.render();
      }).catch(() => { /* A later redraw can retry loading the optional tool. */ })
        .finally(() => { this.loadingVectorDecorations = false; });
    }
  }

  private renderMissingImagePlaceholder(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    name: string,
    zoom: number
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
    ctx.moveTo(x + w, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();

    const fontSize = Math.max(10, Math.min(13, 11 * zoom));
    ctx.fillStyle = '#dc2626';
    ctx.font = `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[Missing Link: ${name}]`, x + w / 2, y + h / 2 - (fontSize * 0.7));

    ctx.fillStyle = '#78716c';
    ctx.font = `400 ${Math.max(9, fontSize - 2)}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText('Relink in Links panel or drop file here', x + w / 2, y + h / 2 + (fontSize * 0.8));
    ctx.restore();
  }

  private createImageProxy(src: string, img: HTMLImageElement): HTMLCanvasElement {
    const isMobileOrTablet = typeof window !== 'undefined' && (window.innerWidth < 1024 || 'ontouchstart' in window);
    const maxDim = isMobileOrTablet ? 600 : 800;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    const proxy = document.createElement('canvas');
    proxy.width = w;
    proxy.height = h;
    const pctx = proxy.getContext('2d');
    if (pctx) {
      pctx.imageSmoothingEnabled = true;
      pctx.imageSmoothingQuality = 'medium';
      pctx.drawImage(img, 0, 0, w, h);
    }
    this.proxyCache.set(src, proxy);
    return proxy;
  }

  /**
   * Exports the currently active spread as a high-resolution, print-quality PNG data URL.
   * Completely excludes editor overlays, selection handles, and guides (renders pristine preview mode).
   */
  public exportSpreadAsPng(scaleFactor: number = 3): string {
    if (typeof document === 'undefined') return '';
    const state = stateManager.getState();
    const { numPages, pageWidthMm, pageHeightMm } = this.getSpreadDimensions(state);

    // Save interactive view state
    const prevZoom = state.zoom;
    const prevPanX = state.panX;
    const prevPanY = state.panY;
    const prevPreview = state.previewMode;
    const prevDisplayQuality = state.displayQuality;
    const prevSelectedId = state.selectedElementId;
    const prevSelectedIds = state.selectedElementIds ? [...state.selectedElementIds] : [];

    const origCanvas = this.canvas;
    const origCtx = this.ctx;

    try {
      // 300 DPI print quality: 300 DPI / 25.4 mm = 11.811 px/mm -> exportZoom = 300 / 96 = 3.125
      const exportZoom = Math.max(scaleFactor || 3, 300 / 96);
      const pxPerMm = MM_TO_PX * exportZoom;
      const targetW = Math.round(numPages * pageWidthMm * pxPerMm);
      const targetH = Math.round(pageHeightMm * pxPerMm);

      const offCanvas = document.createElement('canvas');
      offCanvas.width = targetW;
      offCanvas.height = targetH;
      const offCtx = offCanvas.getContext('2d');
      if (!offCtx) return '';

      this.canvas = offCanvas;
      this.ctx = offCtx;

      // Set clean preview mode at 300 DPI with uncompressed assets and zero selection overlays
      state.zoom = exportZoom;
      state.panX = 0;
      state.panY = 0;
      state.previewMode = true;
      state.displayQuality = 'high';
      state.selectedElementId = null;
      state.selectedElementIds = [];

      this.render({ context: offCtx });

      return offCanvas.toDataURL('image/png');
    } finally {
      this.canvas = origCanvas;
      this.ctx = origCtx;

      state.zoom = prevZoom;
      state.panX = prevPanX;
      state.panY = prevPanY;
      state.previewMode = prevPreview;
      state.displayQuality = prevDisplayQuality;
      state.selectedElementId = prevSelectedId;
      state.selectedElementIds = prevSelectedIds;

      this.render();
    }
  }

  public render(proof?: { context: CanvasRenderingContext2D; spot?: string }) {
    if (!proof) this.overflownTextFrameIds.clear();
    const revision = `${stateManager.getDocumentRevision()}:${fontManager.generation}`;
    if (revision !== this.formattedLayoutRevision || layoutKernels !== this.formattedLayoutKernels) {
      this.formattedLayouts.clear();
      this.clearDragTextBitmaps();
      this.spreadScene = undefined;
      this.tableThreads = undefined;
      this.tableLayouts = createContentTableLayoutLookup();
      this.formattedLayoutRevision = revision;
      this.formattedLayoutKernels = layoutKernels;
    }
    const original = stateManager.getState();
    const state = proof ? { ...original, previewMode: true, displayQuality: 'high' as const, selectedElementId: null, selectedElementIds: [] } : original;
    const rect = this.canvas.getBoundingClientRect();
    const {
      numPages,
      pageWidthMm,
      pageHeightMm,
      spreadWidthPx,
      spreadHeightPx,
    } = this.getSpreadDimensions(state);

    const canvasW = rect.width > 0 ? rect.width : (this.canvas.width || spreadWidthPx);
    const canvasH = rect.height > 0 ? rect.height : (this.canvas.height || spreadHeightPx);
    let ctx = proof?.context || this.ctx;

    ctx.fillStyle = state.previewMode ? '#ffffff' : pasteboardColors[getAppearance().pasteboard];
    ctx.fillRect(0, 0, canvasW, canvasH);

    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    const scene = this.getSpreadScene(original);
    const { spread: realSpread, pageIndexes, layerMap } = scene;
    const session = stateManager.getDocumentSession();
    if (realSpread.id !== this.imageSpreadId || session !== this.imageSession) {
      this.trimDisplayImages(session === this.imageSession ? 12 : 0);
      this.imageSpreadId = realSpread.id;
      this.imageSession = session;
    }
    const showDrag = !proof && !state.previewMode && this.dragPreview.size > 0;
    const spread = showDrag
      ? { ...realSpread, elements: realSpread.elements.map(element => this.dragPreview.get(element.id) || element) }
      : realSpread;

    if (!proof) this.drawSpreadBackground(
      ctx,
      state,
      spread,
      origin,
      canvasW,
      canvasH,
      pxPerMm,
      numPages,
      pageWidthMm,
      pageHeightMm,
      spreadWidthPx,
      spreadHeightPx
    );

    // In preview mode, clip all artwork to the pristine page trim rect
    if (state.previewMode) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(origin.x, origin.y, spreadWidthPx, spreadHeightPx);
      ctx.clip();
    }

    const preview = proof || state.previewMode;
    const artwork = preview ? scene.artwork.filter(el => !el.pasteboard && !el.nonprinting &&
      scene.layerOf(el)?.printable !== false && (!proof || (!el.editorialOnly && (!proof.spot || el.spotColor === proof.spot)))) : scene.artwork;
    this.adjustmentPreviews.beginFrame(preview ? artwork.reduce((count, element) =>
      count + Number(element.type === 'image' && Boolean(element.adjustments)), 0) : scene.adjustedImages);
    const selected = new Set(state.selectedElementIds ?? (state.selectedElementId ? [state.selectedElementId] : []));
    const currentElement = (id: string) => (showDrag ? this.dragPreview.get(id) : undefined) ?? scene.elements.get(id);
    if (proof?.spot) ctx = spotProofContext(ctx);
    for (const saved of artwork) {
      const el = showDrag ? this.dragPreview.get(saved.id) ?? saved : saved;
      const pageIdx = pageIndexes.get(el.pageId);
      if (pageIdx === undefined) continue;

      const pageStartMm = pageIdx * pageWidthMm;
      const elScreenX = origin.x + ((pageStartMm + el.x) * pxPerMm);
      const elScreenY = origin.y + (el.y * pxPerMm);
      const elScreenW = el.width * pxPerMm;
      const elScreenH = el.height * pxPerMm;
      const isSelected = selected.has(el.id);
      if (!proof && !state.previewMode && el.type === 'image') {
        const shadow = el.shadow;
        const reach = shadow ? ((shadow.blurMm || 3) * 3 +
          Math.max(Math.abs(shadow.offsetX || 2), Math.abs(shadow.offsetY || 2))) * pxPerMm : 0;
        const padding = 32 + reach + (el.borderWidthMm || 0) * pxPerMm;
        if (elScreenX + elScreenW < -padding || elScreenY + elScreenH < -padding ||
          elScreenX > canvasW + padding || elScreenY > canvasH + padding) continue;
      }
      if (!proof && !state.previewMode && el.type === 'text' && !isSelected && !el.shadow) {
        // Text and paragraph decorations are clipped to the frame. Allow room for the border and overset port.
        const padding = 32 + (el.borderWidthMm || 0) * pxPerMm;
        if (elScreenX + elScreenW < -padding || elScreenY + elScreenH < -padding ||
          elScreenX > canvasW + padding || elScreenY > canvasH + padding) continue;
      }

      ctx.save();
      const opacity = this.opacityPreview;
      ctx.globalAlpha = !proof && !state.previewMode && opacity?.id === el.id &&
        opacity.revision === scene.revision ? opacity.value : el.opacity;
      ctx.globalCompositeOperation = el.blendMode === 'normal' || !el.blendMode ? 'source-over' : el.blendMode;

      if (el.shadow && el.shadow.color) {
        ctx.shadowColor = el.shadow.color;
        ctx.shadowBlur = (el.shadow.blurMm || 3) * pxPerMm;
        ctx.shadowOffsetX = (el.shadow.offsetX || 2) * pxPerMm;
        ctx.shadowOffsetY = (el.shadow.offsetY || 2) * pxPerMm;
      }

      if (el.type === 'shape') {
        const shape = el as ShapeElement;
        const gradient = !shape.spotColor && shape.fillGradient;
        ctx.fillStyle = gradient ? canvasGradient(ctx, gradient, elScreenX, elScreenY, elScreenW, elScreenH) : displayGradientColor(shape.fillColor || '#ffffff');
        ctx.strokeStyle = displayGradientColor(shape.strokeColor || '#000000');
        ctx.lineWidth = (shape.strokeWidthMm || 0.3) * pxPerMm;

        if (shape.strokePattern) {
          ctx.setLineDash([shape.strokePattern.dash * pxPerMm, shape.strokePattern.gap * pxPerMm]);
        } else if (shape.strokeDash === 'dashed') {
          ctx.setLineDash([6, 4]);
        }

        if (shape.shapeKind === 'rectangle') {
          if (gradient || shape.fillColor && shape.fillColor !== 'transparent') ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH);
          if (shape.decoration && !shape.spotColor) {
            const outline = new Path2D();
            outline.rect(elScreenX, elScreenY, elScreenW, elScreenH);
            this.drawDecoration(ctx, shape, elScreenX, elScreenY, pxPerMm, outline);
          }
          if (shape.strokeWidthMm > 0) ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);
        } else if (shape.shapeKind === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(
            elScreenX + elScreenW / 2,
            elScreenY + elScreenH / 2,
            elScreenW / 2,
            elScreenH / 2,
            0,
            0,
            Math.PI * 2
          );
          if (gradient || shape.fillColor && shape.fillColor !== 'transparent') ctx.fill();
          this.drawDecoration(ctx, shape, elScreenX, elScreenY, pxPerMm);
          if (shape.strokeWidthMm > 0) ctx.stroke();
        } else if (shape.shapeKind === 'line') {
          ctx.beginPath();
          ctx.moveTo(elScreenX, elScreenY);
          ctx.lineTo(elScreenX + elScreenW, elScreenY + elScreenH);
          ctx.stroke();
        }
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        const quality = state.displayQuality || 'typical';

        if (quality === 'fast') {
          // Fast Display Performance (InDesign wireframe box)
          ctx.fillStyle = '#f2f2f2';
          ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH);

          ctx.strokeStyle = '#cccccc';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(elScreenX, elScreenY);
          ctx.lineTo(elScreenX + elScreenW, elScreenY + elScreenH);
          ctx.moveTo(elScreenX + elScreenW, elScreenY);
          ctx.lineTo(elScreenX, elScreenY + elScreenH);
          ctx.stroke();

          ctx.fillStyle = '#666666';
          ctx.font = `${Math.max(10, 11 * state.zoom)}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = img.caption ? `[FAST] ${img.caption}` : (img.src ? '[FAST] Raster Proxy Bypassed' : 'Image Frame');
          ctx.fillText(label, elScreenX + elScreenW / 2, elScreenY + elScreenH / 2);
        } else {
          if (!proof) { ctx.fillStyle = '#f8f8f8'; ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH); }

          if (img.src || img.proxySrc) {
            const bitmap = this.getDisplayImage(img.src, quality, img.proxySrc, img.assetId);
            const displayBitmap = bitmap && img.adjustments
              ? this.adjustmentPreviews.get(img.id, bitmap, img.adjustments) : bitmap;
            if (displayBitmap) {
              const bW = displayBitmap.width;
              const bH = displayBitmap.height;
              const fit = calculateImageFitting(
                elScreenX,
                elScreenY,
                elScreenW,
                elScreenH,
                bW,
                bH,
                img.fitMode || 'fill', img.focalPoint
              );

              ctx.save();
              ctx.beginPath();
              ctx.rect(elScreenX, elScreenY, elScreenW, elScreenH);
              ctx.clip();
              ctx.drawImage(displayBitmap, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
              ctx.restore();
            } else if (this.failedImageSrcs.has(img.src) || (img.proxySrc && this.failedImageSrcs.has(img.proxySrc))) {
              this.renderMissingImagePlaceholder(ctx, elScreenX, elScreenY, elScreenW, elScreenH, img.name || img.caption || 'Missing Image', state.zoom);
            } else {
              ctx.fillStyle = '#888888';
              ctx.font = `${Math.max(10, 11 * state.zoom)}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('Loading image...', elScreenX + elScreenW / 2, elScreenY + elScreenH / 2);
            }
          } else {
            ctx.strokeStyle = '#d0d0d0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(elScreenX, elScreenY);
            ctx.lineTo(elScreenX + elScreenW, elScreenY + elScreenH);
            ctx.moveTo(elScreenX + elScreenW, elScreenY);
            ctx.lineTo(elScreenX, elScreenY + elScreenH);
            ctx.stroke();

            ctx.fillStyle = '#888888';
            ctx.font = `${Math.max(10, 11 * state.zoom)}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = img.name ? `[Missing Link: ${img.name}]` : (img.caption || 'Image Frame (Drop photo here)');
            ctx.fillText(label, elScreenX + elScreenW / 2, elScreenY + elScreenH / 2);
          }
        }

        if (img.borderWidthMm > 0) {
          ctx.strokeStyle = img.borderColor || '#333333';
          ctx.lineWidth = img.borderWidthMm * pxPerMm;
          ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);
        }
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        this.renderVectorPath(ctx, pathEl, origin, pageStartMm, pxPerMm, isSelected, this.activePenPathId, !!proof?.spot);
      } else if (el.type === 'table') {
        const table = el as TableElement;
        const preview = !proof && !state.previewMode && this.dragPreview.has(table.id);
        const resizing = preview && this.isResizing;
        const source = preview && !resizing ? scene.elements.get(table.id) : table;
        const thread = (this.tableThreads ??= createTableThreadLookup(state.spreads))(source?.type === 'table' ? source : table);
        const layout = resizing ? undefined : this.tableLayouts(thread);
        tableEngine.renderCanvasTable(ctx, table, elScreenX, elScreenY, elScreenW, elScreenH, pxPerMm, state.zoom, thread, layout);
      } else if (el.type === 'text') {
        const text = el as TextElement;
        const liveEditor = !proof && this.activeInlineEditor?.elementId === el.id ? this.activeInlineEditor.live : undefined;
        if (!proof && this.activeInlineEditor && this.activeInlineEditor.elementId === el.id && !liveEditor) {
          ctx.restore();
          continue;
        }
        if (text.backgroundColor && text.backgroundColor !== 'transparent') {
          ctx.fillStyle = text.backgroundColor;
          ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH);
        }
        if (text.borderWidthMm > 0 && text.borderColor !== 'transparent') {
          ctx.strokeStyle = text.borderColor;
          ctx.lineWidth = text.borderWidthMm * pxPerMm;
          ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);
        }

        ctx.save();
        ctx.beginPath();
        const clipBleed = 4 * state.zoom;
        ctx.rect(elScreenX - clipBleed, elScreenY, elScreenW + (clipBleed * 2), elScreenH);
        ctx.clip();

        const paddingPx = (text.paddingMm || 2) * pxPerMm;
        const availWidthPx = elScreenW - (paddingPx * 2);
        const colCount = text.spanColumns
          ? 1
          : (text.splitColumns && text.splitColumns > 1 ? text.splitColumns : Math.max(1, text.columns || 1));
        const colGutterPx = (text.columnGutterMm || 4) * pxPerMm;
        const singleColWidthPx = (availWidthPx - (colGutterPx * (colCount - 1))) / colCount;

        if (colCount > 1 && text.columnRule?.enabled) {
          const ruleWidth = (text.columnRule.widthPt || 0.5) * (96 / 72) * state.zoom;
          const insetPx = (text.columnRule.insetMm || 0) * pxPerMm;
          ctx.save();
          ctx.strokeStyle = text.columnRule.color || '#888888';
          ctx.lineWidth = Math.max(0.5, ruleWidth);
          for (let c = 0; c < colCount - 1; c++) {
            const dividerX = elScreenX + paddingPx + ((c + 1) * singleColWidthPx) + (c * colGutterPx) + (colGutterPx / 2);
            ctx.beginPath();
            ctx.moveTo(dividerX, elScreenY + paddingPx + insetPx);
            ctx.lineTo(dividerX, elScreenY + elScreenH - paddingPx - insetPx);
            ctx.stroke();
          }
          ctx.restore();
        }

        const pStyle = text.paragraphStyleId ? scene.paragraphStyles.get(text.paragraphStyleId) : undefined;
        const activeGrepRules = pStyle?.grepStyles || text.grepStyles;
        if (pStyle?.shadingColor) {
          const sPaddingPx = (pStyle.shadingPaddingMm || 1.5) * pxPerMm;
          ctx.save();
          ctx.fillStyle = pStyle.shadingColor;
          ctx.fillRect(elScreenX + paddingPx - sPaddingPx, elScreenY + paddingPx - sPaddingPx, availWidthPx + (sPaddingPx * 2), elScreenH - (paddingPx * 2) + (sPaddingPx * 2));
          if (pStyle.shadingBorderColor && pStyle.shadingBorderWidthMm) {
            ctx.strokeStyle = pStyle.shadingBorderColor;
            ctx.lineWidth = pStyle.shadingBorderWidthMm * pxPerMm;
            ctx.strokeRect(elScreenX + paddingPx - sPaddingPx, elScreenY + paddingPx - sPaddingPx, availWidthPx + (sPaddingPx * 2), elScreenH - (paddingPx * 2) + (sPaddingPx * 2));
          }
          ctx.restore();
        }

        const fontSizePx = (text.fontSizePt * (96 / 72)) * state.zoom;
        const lineSpacingPx = fontSizePx * (text.lineHeight || 1.3);

        ctx.fillStyle = text.color || '#111111';
        ctx.font = `${fontSizePx}px ${text.fontFamily || 'serif'}`;
        ctx.textBaseline = 'top';

        if (text.letterSpacingPt && ctx.letterSpacing !== undefined) {
          ctx.letterSpacing = `${(text.letterSpacingPt * (96 / 72) * state.zoom).toFixed(2)}px`;
        } else if (ctx.letterSpacing !== undefined) {
          ctx.letterSpacing = '0px';
        }

        if (text.openTypeFeatures?.smallCaps && ctx.fontVariantCaps !== undefined) {
          ctx.fontVariantCaps = 'all-small-caps';
        } else if (ctx.fontVariantCaps !== undefined) {
          ctx.fontVariantCaps = 'normal';
        }

        // Baseline Grid snapping parameters
        const grid = state.settings.baselineGrid;
        const useBaselineGrid = Boolean(text.snapToBaseline && grid?.enabled);
        const pitchMm = grid?.incrementPt ? (grid.incrementPt * 25.4) / 72 : 4.2333;
        const pitchPx = pitchMm * pxPerMm;
        const startMm = grid?.startMm ?? state.settings.margins.topMm;
        const gridStartY = origin.y + (startMm * pxPerMm);

        const layoutFrame = this.dragPreview.has(text.id)
          ? scene.elements.get(text.id) as TextElement : text;
        const pageObstacles = scene.wrapOnPage(text.pageId);
        const obstacles = text.textWrap?.mode && text.textWrap.mode !== 'none'
          ? pageObstacles?.filter(other => other.id !== text.id) : pageObstacles;

        const fnSettings = state.settings.footnoteSettings || {
          numberingStyle: 'superscript',
          separatorRuleWidthMm: 30,
          separatorRuleThicknessPt: 0.5,
          fontSizePt: 8,
        };
        const fnFontSizePt = fnSettings.fontSizePt || 8;
        const fnFontSizePx = (fnFontSizePt * (96 / 72)) * state.zoom;
        const fnLineSpacingPx = fnFontSizePx * 1.35;
        const fnRuleGapPx = 6 * state.zoom;
        const noteLayout = scene.layoutNotes(layoutFrame);
        const totalFootnoteHeightPx = noteLayout.height * pxPerMm;

        let isOverflowing = false;
        const bottomLimit = elScreenY + elScreenH - paddingPx - totalFootnoteHeightPx;
        let rawCleanedText = text.text || '';
        if (rawCleanedText.includes('{cond:')) {
          rawCleanedText = stateManager.evaluateConditions(rawCleanedText);
        }
        if (rawCleanedText.includes('{xref:')) {
          rawCleanedText = stateManager.resolveCrossReferences(rawCleanedText);
        }
        if (rawCleanedText.includes('{index:')) {
          rawCleanedText = rawCleanedText.replace(/\{index:[^}]+\}/g, '');
        }
        const processedText = formatOpenTypeText(rawCleanedText, text.openTypeFeatures);

        // While a frame is edited in place it is composed from the editor's text, not yet committed.
        const liveComposition = liveEditor?.compose(text);
        const cached = liveComposition ? undefined : this.formattedLayouts.get(layoutFrame);
        const flowContent = liveComposition?.content || text.textContent || (obstacles?.length
          ? cached?.source === processedText ? cached.content : wrappedPlainContent(text, processedText) : undefined);
        if (flowContent) {
          const layout = liveComposition || (cached?.content === flowContent && cached.reserve === noteLayout.height ? cached.layout :
            layoutStory(flowContent, layoutFrame, state.paragraphStyles, state.characterStyles,
              undefined, noteLayout.height, { obstacles, baselineGrid: state.settings.baselineGrid }));
          if (!liveComposition && cached?.layout !== layout && (cached || this.formattedLayouts.size < 64)) {
            this.formattedLayouts.set(layoutFrame, { content: flowContent, source: text.textContent ? undefined : processedText, reserve: noteLayout.height, layout });
          }
          if (liveEditor && liveComposition) {
            liveEditor.paint(ctx, text, liveComposition, { x: elScreenX, y: elScreenY, pxPerMm });
          }
          const canReuseText = !liveComposition && !proof && !state.previewMode && this.isDragging && layout.lines.length >= 8 &&
            !text.shadow && ctx.globalAlpha === 1 && ctx.globalCompositeOperation === 'source-over';
          if (!canReuseText || !this.drawDragText(ctx, layout, elScreenX, elScreenY,
            elScreenW, elScreenH, clipBleed, pxPerMm, state.zoom)) {
            // A plain frame keeps the legacy renderer's vertical placement while it is being edited.
            drawFormattedStory(ctx, layout, elScreenX, elScreenY, pxPerMm, state.zoom, !!liveComposition?.topBaseline);
          }
          isOverflowing = layout.overset;
        } else {
          const otKey = text.openTypeFeatures ? Object.entries(text.openTypeFeatures).filter(([_, v]) => v).map(([k]) => k).sort().join(',') : '';
          const layoutKey = `${text.id}_${processedText}_${text.fontFamily}_${text.fontSizePt}_${text.lineHeight}_${text.letterSpacingPt || 0}_${text.columns}_${text.columnGutterMm}_${text.paddingMm}_${elScreenW}_${elScreenH}_${totalFootnoteHeightPx}_${text.dropCapLines}_${Boolean(text.opticalMarginAlignment)}_${Boolean(text.balanceColumns)}_${otKey}_${state.zoom}`;

          let cachedLayout = this.textLayoutCache.get(layoutKey);
          let allLines: FormattedLine[];
          let dropCapChar = '';
          let dropCapWidth = 0;
          let dropCapFontSize = 0;

          if (cachedLayout) {
            allLines = cachedLayout.allLines;
            dropCapChar = cachedLayout.dropCapChar;
            dropCapWidth = cachedLayout.dropCapWidth;
            dropCapFontSize = cachedLayout.dropCapFontSize;
          } else {
            // Drop Cap calculation
            const dropCapLines = (text.dropCapLines && text.dropCapLines >= 2) ? Math.min(4, Math.floor(text.dropCapLines)) : 0;
            const paragraphs = processedText.split('\n');
            let dropCapParaIdx = -1;

            if (dropCapLines >= 2) {
              for (let p = 0; p < paragraphs.length; p++) {
                const trimmed = paragraphs[p].trimStart();
                if (trimmed.length > 0) {
                  dropCapParaIdx = p;
                  dropCapChar = trimmed[0];
                  dropCapFontSize = fontSizePx * (dropCapLines * 0.92);
                  ctx.save();
                  ctx.font = `bold ${dropCapFontSize}px ${text.fontFamily || 'serif'}`;
                  dropCapWidth = ctx.measureText(dropCapChar).width + (4 * state.zoom);
                  ctx.restore();
                  break;
                }
              }
            }

            allLines = [];
            let dropCapLinesRemaining = dropCapLines;

            for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
              let para = paragraphs[pIdx];
              if (!para.trim()) {
                allLines.push({ text: '', isLastInPara: true, indentX: 0, availWidth: singleColWidthPx });
                continue;
              }

              const isDropCapPara = (pIdx === dropCapParaIdx && dropCapChar !== '');
              if (isDropCapPara) {
                const firstCharPos = para.indexOf(dropCapChar);
                if (firstCharPos !== -1) {
                  para = para.slice(0, firstCharPos) + para.slice(firstCharPos + dropCapChar.length);
                }
              }

              const words = para.trim().split(/\s+/);
              let currentLineWords: string[] = [];

              for (let wIdx = 0; wIdx < words.length; wIdx++) {
                const word = words[wIdx];
                const isDropLine = isDropCapPara && dropCapLinesRemaining > 0;
                const lineIndent = isDropLine ? dropCapWidth : 0;
                const lineMaxW = singleColWidthPx - lineIndent;

                const testLineWords = [...currentLineWords, word];
                const testLine = testLineWords.join(' ');
                const metrics = ctx.measureText(testLine);
                const trailingHang = getTrailingHangOffset(testLine, ctx, Boolean(text.opticalMarginAlignment));

                if (metrics.width - trailingHang > lineMaxW) {
                  if (currentLineWords.length > 0) {
                    allLines.push({
                      text: currentLineWords.join(' '),
                      isLastInPara: false,
                      indentX: lineIndent,
                      availWidth: lineMaxW,
                    });
                    if (isDropLine) {
                      dropCapLinesRemaining--;
                    }
                    currentLineWords = [];
                  }

                  const wordTrailingHang = getTrailingHangOffset(word, ctx, Boolean(text.opticalMarginAlignment));
                  if (ctx.measureText(word).width - wordTrailingHang > lineMaxW) {
                    const subChunks = splitWordIntoFitChunks(word, lineMaxW, ctx);
                    for (let cIdx = 0; cIdx < subChunks.length - 1; cIdx++) {
                      allLines.push({
                        text: subChunks[cIdx],
                        isLastInPara: false,
                        indentX: lineIndent,
                        availWidth: lineMaxW,
                      });
                      if (isDropLine) {
                        dropCapLinesRemaining--;
                      }
                    }
                    currentLineWords = [subChunks[subChunks.length - 1]];
                  } else {
                    currentLineWords = [word];
                  }
                } else {
                  currentLineWords.push(word);
                }
              }

              if (currentLineWords.length > 0) {
                const isDropLine = isDropCapPara && dropCapLinesRemaining > 0;
                const lineIndent = isDropLine ? dropCapWidth : 0;
                const lineMaxW = singleColWidthPx - lineIndent;
                allLines.push({
                  text: currentLineWords.join(' '),
                  isLastInPara: true,
                  indentX: lineIndent,
                  availWidth: lineMaxW,
                });
                if (isDropLine) {
                  dropCapLinesRemaining--;
                }
              }
            }

            cachedLayout = {
              allLines,
              dropCapChar,
              dropCapWidth,
              dropCapFontSize,
            };
            if (this.textLayoutCache.size > 200) {
              this.textLayoutCache.clear();
            }
            this.textLayoutCache.set(layoutKey, cachedLayout);
          }

          let lineIdx = 0;
          const totalLines = allLines.length;
          const isBalanced = Boolean(text.balanceColumns && colCount > 1);
          const baseLinesPerCol = Math.floor(totalLines / colCount);
          const extraLines = totalLines % colCount;

          for (let c = 0; c < colCount; c++) {
            const colX = elScreenX + paddingPx + (c * (singleColWidthPx + colGutterPx));
            let vOffsetPx = 0;
            if (text.verticalAlign && (text.verticalAlign === 'middle' || text.verticalAlign === 'bottom')) {
              const maxLinesInCol = Math.floor((bottomLimit - (elScreenY + paddingPx)) / (lineSpacingPx || 1));
              const linesInThisCol = Math.min(totalLines, maxLinesInCol);
              const textHeightPx = Math.max(0, (linesInThisCol - 1) * lineSpacingPx + fontSizePx);
              const remainingSpace = Math.max(0, (bottomLimit - (elScreenY + paddingPx)) - textHeightPx);
              if (text.verticalAlign === 'middle') {
                vOffsetPx = Math.floor(remainingSpace / 2);
              } else if (text.verticalAlign === 'bottom') {
                vOffsetPx = Math.floor(remainingSpace);
              }
            }
            let currentY = elScreenY + paddingPx + vOffsetPx;
            const targetColLines = isBalanced
              ? (c < extraLines ? baseLinesPerCol + 1 : baseLinesPerCol)
              : Infinity;
            let linesInCol = 0;

            if (useBaselineGrid && !text.verticalAlign) {
              if (currentY < gridStartY) {
                currentY = gridStartY;
              } else {
                const k = Math.ceil((currentY - gridStartY) / pitchPx);
                currentY = gridStartY + (k * pitchPx);
              }
            }

            // If drop cap applies, render it once at the start of column 0
            if (c === 0 && dropCapChar && currentY + fontSizePx <= bottomLimit) {
              const hangL = getLeadingHangOffset(dropCapChar, ctx, Boolean(text.opticalMarginAlignment));
              ctx.save();
              ctx.font = `bold ${dropCapFontSize}px ${text.fontFamily || 'serif'}`;
              ctx.fillStyle = text.color || '#111111';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';
              ctx.fillText(dropCapChar, colX - hangL, currentY);
              ctx.restore();
            }

            while (lineIdx < allLines.length) {
              if (currentY + fontSizePx > bottomLimit) {
                break; // column full, move to next column
              }
              if (linesInCol >= targetColLines) {
                break; // balanced column quota reached, move to next column
              }

              const line = allLines[lineIdx];
              if (line && line.text) {
                const hangL = getLeadingHangOffset(line.text, ctx, Boolean(text.opticalMarginAlignment));
                const hangR = getTrailingHangOffset(line.text, ctx, Boolean(text.opticalMarginAlignment));

                if (text.alignment === 'center') {
                  if (activeGrepRules && activeGrepRules.length > 0) {
                    ctx.textAlign = 'left';
                    const totalW = ctx.measureText(line.text).width;
                    this.drawLineWithGrep(ctx, line.text, colX + line.indentX + (line.availWidth - hangL + hangR) / 2 - totalW / 2, currentY, fontSizePx, text.fontFamily || 'serif', text.color || '#111111', activeGrepRules);
                  } else {
                    ctx.textAlign = 'center';
                    ctx.fillText(line.text, colX + line.indentX + (line.availWidth - hangL + hangR) / 2, currentY);
                  }
                } else if (text.alignment === 'right') {
                  if (activeGrepRules && activeGrepRules.length > 0) {
                    ctx.textAlign = 'left';
                    const totalW = ctx.measureText(line.text).width;
                    this.drawLineWithGrep(ctx, line.text, colX + line.indentX + line.availWidth + hangR - totalW, currentY, fontSizePx, text.fontFamily || 'serif', text.color || '#111111', activeGrepRules);
                  } else {
                    ctx.textAlign = 'right';
                    ctx.fillText(line.text, colX + line.indentX + line.availWidth + hangR, currentY);
                  }
                } else if (text.alignment === 'justify' && !line.isLastInPara) {
                  const words = line.text.trim().split(/\s+/);
                  if (words.length <= 1) {
                    ctx.textAlign = 'left';
                    this.drawLineWithGrep(ctx, line.text, colX + line.indentX - hangL, currentY, fontSizePx, text.fontFamily || 'serif', text.color || '#111111', activeGrepRules);
                  } else {
                    let totalWordsW = 0;
                    const wWidths: number[] = [];
                    for (const w of words) {
                      const wW = ctx.measureText(w).width;
                      wWidths.push(wW);
                      totalWordsW += wW;
                    }
                    const totalTargetW = line.availWidth + hangL + hangR;
                    const excess = totalTargetW - totalWordsW;
                    const gap = Math.max(0, excess / (words.length - 1));
                    let curWordX = colX + line.indentX - hangL;
                    ctx.textAlign = 'left';
                    for (let w = 0; w < words.length; w++) {
                      this.drawLineWithGrep(ctx, words[w], curWordX, currentY, fontSizePx, text.fontFamily || 'serif', text.color || '#111111', activeGrepRules);
                      curWordX += wWidths[w] + gap;
                    }
                  }
                } else {
                  ctx.textAlign = 'left';
                  this.drawLineWithGrep(ctx, line.text, colX + line.indentX - hangL, currentY, fontSizePx, text.fontFamily || 'serif', text.color || '#111111', activeGrepRules);
                }
              }

              if (useBaselineGrid) {
                const nextTentative = currentY + Math.max(lineSpacingPx, pitchPx * 0.8);
                const k = Math.ceil((nextTentative - gridStartY) / pitchPx);
                currentY = gridStartY + (k * pitchPx);
              } else {
                currentY += lineSpacingPx;
              }
              linesInCol++;
              lineIdx++;
            }
          }

          if (lineIdx < allLines.length) {
            isOverflowing = true;
          }
        }

        if (noteLayout.lines.length > 0) {
          const fnStartY = elScreenY + elScreenH - paddingPx - totalFootnoteHeightPx;
          const ruleThicknessPx = (fnSettings.separatorRuleThicknessPt || 0.5) * (96 / 72) * state.zoom;
          const maxRuleW = (fnSettings.separatorRuleWidthMm || 30) * pxPerMm;
          const ruleW = Math.min(noteLayout.columnWidth * pxPerMm * 0.45, maxRuleW);

          ctx.save();
          // Separator rule
          ctx.strokeStyle = '#888888';
          ctx.lineWidth = Math.max(0.5, ruleThicknessPx);
          ctx.beginPath();
          for (const x of new Set(noteLayout.lines.map(line => line.x))) {
            ctx.moveTo(elScreenX + paddingPx + x * pxPerMm, fnStartY);
            ctx.lineTo(elScreenX + paddingPx + x * pxPerMm + ruleW, fnStartY);
          }
          ctx.stroke();

          // Footnote lines
          ctx.fillStyle = text.color || '#222222';
          ctx.font = `${fnFontSizePx}px ${fnSettings.fontFamily || text.fontFamily || 'serif'}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';

          noteLayout.lines.forEach(line => {
            const lineY = fnStartY + (3 + noteLayout.size * 25.4 / 72 + line.y) * pxPerMm;
            ctx.fillText(line.text, elScreenX + paddingPx + line.x * pxPerMm, lineY);
          });
          ctx.restore();
        }

        ctx.restore();

        if (isOverflowing && !proof) {
          this.overflownTextFrameIds.add(text.id);
        }

        if (isOverflowing && !state.previewMode && !text.nextFrameId && !isSelected) {
          const outPortSize = 14;
          const badgeX = elScreenX + elScreenW - outPortSize;
          const badgeY = elScreenY + elScreenH - outPortSize;
          ctx.fillStyle = '#d90429';
          ctx.strokeStyle = '#9d0208';
          ctx.lineWidth = 1.5;
          ctx.fillRect(badgeX, badgeY, outPortSize, outPortSize);
          ctx.strokeRect(badgeX, badgeY, outPortSize, outPortSize);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+', badgeX + 7, badgeY + 7);
        }
      }

      ctx.restore();
      if (isSelected && !state.previewMode) {
        const elLayer = layerMap.get(el.layerId || 'layer-1') || state.layers?.[0];
        const layerColor = elLayer?.colorHex || '#0d99ff';
        const isElementLocked = el.locked || Boolean(elLayer?.locked);
        const isEditorial = Boolean(el.editorialOnly);

        if (isEditorial) {
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);
          ctx.setLineDash([]);

          ctx.fillStyle = '#a855f7';
          ctx.fillRect(elScreenX, elScreenY - 14, 82, 14);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 8px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('EDITORIAL LOCK', elScreenX + 41, elScreenY - 3);
        } else if (isElementLocked) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);

          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(elScreenX, elScreenY - 14, 28, 14);
          ctx.fillStyle = '#111111';
          ctx.font = 'bold 8px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('LOCK', elScreenX + 14, elScreenY - 3);
        } else {
          ctx.strokeStyle = layerColor;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);

          if (!state.selectedElementIds || state.selectedElementIds.length <= 1) {
            const handleSize = 6;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = layerColor;
            ctx.lineWidth = 1.5;

            const handlePoints = [
              [elScreenX, elScreenY],
              [elScreenX + elScreenW / 2, elScreenY],
              [elScreenX + elScreenW, elScreenY],
              [elScreenX + elScreenW, elScreenY + elScreenH / 2],
              [elScreenX + elScreenW, elScreenY + elScreenH],
              [elScreenX + elScreenW / 2, elScreenY + elScreenH],
              [elScreenX, elScreenY + elScreenH],
              [elScreenX, elScreenY + elScreenH / 2],
            ];

            for (const [hx, hy] of handlePoints) {
              ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
              ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
            }
          }
        }

        if (el.type === 'text') {
          const textEl = el as TextElement;
          // InPort Handle (top-left)
          const inPortX = elScreenX - 4;
          const inPortY = elScreenY + 10;
          ctx.fillStyle = textEl.prevFrameId ? layerColor : '#ffffff';
          ctx.strokeStyle = layerColor;
          ctx.lineWidth = 1.5;
          ctx.fillRect(inPortX, inPortY, 10, 10);
          ctx.strokeRect(inPortX, inPortY, 10, 10);
          if (textEl.prevFrameId) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '7px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('➔', inPortX + 5, inPortY + 5);
          }

          // OutPort Handle (bottom-right)
          const outPortX = elScreenX + elScreenW - 14;
          const outPortY = elScreenY + elScreenH - 14;
          const isThreaded = Boolean(textEl.nextFrameId);
          const isOverset = this.overflownTextFrameIds.has(textEl.id) && !isThreaded;

          if (isOverset) {
            ctx.fillStyle = '#d90429';
            ctx.strokeStyle = '#9d0208';
            ctx.lineWidth = 1.5;
            ctx.fillRect(outPortX, outPortY, 14, 14);
            ctx.strokeRect(outPortX, outPortY, 14, 14);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', outPortX + 7, outPortY + 7);
          } else {
            ctx.fillStyle = isThreaded ? layerColor : '#ffffff';
            ctx.strokeStyle = layerColor;
            ctx.lineWidth = 1.5;
            ctx.fillRect(outPortX, outPortY, 14, 14);
            ctx.strokeRect(outPortX, outPortY, 14, 14);

            ctx.fillStyle = isThreaded ? '#ffffff' : layerColor;
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(isThreaded ? '➔' : '+', outPortX + 7, outPortY + 7);
          }
        }
      }
    }

    this.adjustmentPreviews.endFrame();
    if (proof) { ctx.restore(); return; }

    // Render Thread Vectors for linked frames
    for (const el of spread.elements) {
      if (el.type === 'text') {
        const textEl = el as TextElement;
        const isSelected = selected.has(textEl.id);
        if ((isSelected || state.linkingFromFrameId === textEl.id) && textEl.nextFrameId) {
          const fromPageStart = (pageIndexes.get(textEl.pageId) ?? 0) * pageWidthMm;
          const fromX = origin.x + ((fromPageStart + textEl.x + textEl.width) * pxPerMm) - 7;
          const fromY = origin.y + ((textEl.y + textEl.height) * pxPerMm) - 7;

          const targetEl = currentElement(textEl.nextFrameId);
          if (targetEl && targetEl.type === 'text') {
            const toPageStart = (pageIndexes.get(targetEl.pageId) ?? 0) * pageWidthMm;
            const toX = origin.x + ((toPageStart + targetEl.x) * pxPerMm) + 5;
            const toY = origin.y + (targetEl.y * pxPerMm) + 15;

            ctx.save();
            ctx.strokeStyle = '#00b4d8';
            ctx.fillStyle = '#00b4d8';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 2]);

            const cp1X = fromX + (toX - fromX) * 0.4;
            const cp1Y = fromY + 40;
            const cp2X = fromX + (toX - fromX) * 0.6;
            const cp2Y = toY - 40;

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, toX, toY);
            ctx.stroke();

            ctx.setLineDash([]);
            const angle = Math.atan2(toY - cp2Y, toX - cp2X);
            const headLen = 8;
            ctx.beginPath();
            ctx.moveTo(toX, toY);
            ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          } else {
            const otherSpread = scene.linkedSpread(textEl.nextFrameId);
            const spIdx = otherSpread ? otherSpread.spreadIndex + 1 : '?';
            ctx.save();
            ctx.fillStyle = '#00b4d8';
            ctx.fillRect(fromX + 10, fromY - 7, 72, 14);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`➔ Spread ${spIdx}`, fromX + 46, fromY);
            ctx.restore();
          }
        }
      }
    }
    if (state.previewMode) {
      ctx.restore();
    }

    // Render interactive rubber-band line when linking
    if (!state.previewMode && state.linkingFromFrameId) {
      const linkingEl = spread.elements.find(e => e.id === state.linkingFromFrameId);
      if (linkingEl && linkingEl.type === 'text') {
        const pageIdxA = spread.pages.findIndex(p => p.id === linkingEl.pageId);
        const fromPageStart = (pageIdxA !== -1 ? pageIdxA : 0) * pageWidthMm;
        const fromX = origin.x + ((fromPageStart + linkingEl.x + linkingEl.width) * pxPerMm) - 7;
        const fromY = origin.y + ((linkingEl.y + linkingEl.height) * pxPerMm) - 7;

        ctx.save();
        ctx.strokeStyle = '#0d99ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(this.mouseScreenX, this.mouseScreenY);
        ctx.stroke();

        ctx.fillStyle = '#0d99ff';
        ctx.beginPath();
        ctx.arc(this.mouseScreenX, this.mouseScreenY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Render interactive rubber-band line when drawing with pen tool
    if (!state.previewMode && state.activeTool === 'pen' && this.activePenPathId) {
      const activePathEl = spread.elements.find(e => e.id === this.activePenPathId) as VectorPathElement | undefined;
      if (activePathEl && activePathEl.nodes.length > 0) {
        const lastNode = activePathEl.nodes[activePathEl.nodes.length - 1];
        const pageIdxP = spread.pages.findIndex(p => p.id === activePathEl.pageId);
        const pPageStart = (pageIdxP !== -1 ? pageIdxP : 0) * pageWidthMm;
        const fromX = origin.x + ((pPageStart + activePathEl.x + lastNode.x) * pxPerMm);
        const fromY = origin.y + ((activePathEl.y + lastNode.y) * pxPerMm);

        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(this.mouseScreenX, this.mouseScreenY);
        ctx.stroke();

        ctx.fillStyle = '#2563eb';
        ctx.beginPath();
        ctx.arc(this.mouseScreenX, this.mouseScreenY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (!state.previewMode && state.selectedElementIds && state.selectedElementIds.length > 1) {
      const selectedElements = spread.elements.filter(el => state.selectedElementIds.includes(el.id));
      if (selectedElements.length > 1) {
        let minGlobalX = Infinity, minGlobalY = Infinity, maxGlobalX = -Infinity, maxGlobalY = -Infinity;
        for (const el of selectedElements) {
          const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
          const gX = pageIdx * pageWidthMm + el.x;
          const gY = el.y;
          if (gX < minGlobalX) minGlobalX = gX;
          if (gY < minGlobalY) minGlobalY = gY;
          if (gX + el.width > maxGlobalX) maxGlobalX = gX + el.width;
          if (gY + el.height > maxGlobalY) maxGlobalY = gY + el.height;
        }

        const groupScreenX = origin.x + minGlobalX * pxPerMm;
        const groupScreenY = origin.y + minGlobalY * pxPerMm;
        const groupScreenW = (maxGlobalX - minGlobalX) * pxPerMm;
        const groupScreenH = (maxGlobalY - minGlobalY) * pxPerMm;

        const firstLayerId = selectedElements[0]?.layerId || 'layer-1';
        const allSameLayer = selectedElements.every(el => (el.layerId || 'layer-1') === firstLayerId);
        const groupColor = allSameLayer ? (layerMap.get(firstLayerId)?.colorHex || '#0d99ff') : '#0d99ff';

        ctx.save();
        ctx.strokeStyle = groupColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(groupScreenX - 3, groupScreenY - 3, groupScreenW + 6, groupScreenH + 6);

        ctx.fillStyle = groupColor;
        ctx.fillRect(groupScreenX - 3, groupScreenY - 18, 68, 15);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${selectedElements.length} SELECTED`, groupScreenX + 2, groupScreenY - 7);
        ctx.restore();
      }
    }

    if (!state.previewMode && this.isMarquee) {
      const mMinX = Math.min(this.marqueeStartMmX, this.marqueeCurrentMmX);
      const mMaxX = Math.max(this.marqueeStartMmX, this.marqueeCurrentMmX);
      const mMinY = Math.min(this.marqueeStartMmY, this.marqueeCurrentMmY);
      const mMaxY = Math.max(this.marqueeStartMmY, this.marqueeCurrentMmY);

      const mScreenX = origin.x + mMinX * pxPerMm;
      const mScreenY = origin.y + mMinY * pxPerMm;
      const mScreenW = (mMaxX - mMinX) * pxPerMm;
      const mScreenH = (mMaxY - mMinY) * pxPerMm;

      ctx.save();
      ctx.fillStyle = 'rgba(13, 153, 255, 0.12)';
      ctx.fillRect(mScreenX, mScreenY, mScreenW, mScreenH);
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(mScreenX, mScreenY, mScreenW, mScreenH);
      ctx.restore();

      const mW = mMaxX - mMinX;
      const mH = mMaxY - mMinY;
      if (mW > 2 && mH > 2) {
        const cursorScreenX = origin.x + this.marqueeCurrentMmX * pxPerMm;
        const cursorScreenY = origin.y + this.marqueeCurrentMmY * pxPerMm;
        this.drawDimensionHud(ctx, cursorScreenX + 14, cursorScreenY + 14, mW, mH, 'Select');
      }
    }

    if (!state.previewMode && this.isDrawingNew && this.drawTargetPage) {
      const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === this.drawTargetPage!.id));
      const pageStartMm = pageIdx * pageWidthMm;
      const curX = this.drawCurrentMmX !== undefined ? this.drawCurrentMmX : this.drawStartMmX;
      const curY = this.drawCurrentMmY !== undefined ? this.drawCurrentMmY : this.drawStartMmY;

      const minX = Math.min(this.drawStartMmX, curX);
      const maxX = Math.max(this.drawStartMmX, curX);
      const minY = Math.min(this.drawStartMmY, curY);
      const maxY = Math.max(this.drawStartMmY, curY);

      const wMm = maxX - minX;
      const hMm = maxY - minY;

      const screenX = origin.x + (pageStartMm + minX) * pxPerMm;
      const screenY = origin.y + minY * pxPerMm;
      const screenW = wMm * pxPerMm;
      const screenH = hMm * pxPerMm;

      const cursorScreenX = origin.x + (pageStartMm + curX) * pxPerMm;
      const cursorScreenY = origin.y + curY * pxPerMm;

      this.renderDrawingPreview(
        ctx,
        screenX,
        screenY,
        screenW,
        screenH,
        wMm,
        hMm,
        state.activeTool,
        cursorScreenX,
        cursorScreenY
      );
    }

    // Live Freehand Pencil Stroke Preview
    if (this.isPencilDrawing && this.pencilStrokePoints.length > 1 && this.pencilTargetPage) {
      const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === this.pencilTargetPage!.id));
      const pageStartMm = pageIdx * pageWidthMm;
      ctx.save();
      ctx.beginPath();
      const strokeW = Math.max(1, 0.5 * pxPerMm);
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = '#111111';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const pts = this.pencilStrokePoints;
      const firstScreenX = origin.x + (pageStartMm + pts[0].x) * pxPerMm;
      const firstScreenY = origin.y + pts[0].y * pxPerMm;
      ctx.moveTo(firstScreenX, firstScreenY);

      for (let i = 1; i < pts.length; i++) {
        const pScreenX = origin.x + (pageStartMm + pts[i].x) * pxPerMm;
        const pScreenY = origin.y + pts[i].y * pxPerMm;
        ctx.lineTo(pScreenX, pScreenY);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw Dynamic Smart Magnetic Guides & Distance Snapping
    if (!state.previewMode && this.isDragging && this.activeSmartGuides) {
      this.drawSmartGuides(ctx, origin, pxPerMm, pageWidthMm);
    }

    // Draw real-time collaboration peers
    const peers = collabSession.getPeers();
    if (peers.length > 0) {
      for (const peer of peers) {
        if (peer.spreadIndex !== state.activeSpreadIndex) continue;

        // Draw remote selection outline if peer selected an element
        if (peer.selectedElementId) {
          const remoteEl = spread.elements.find((el) => el.id === peer.selectedElementId);
          if (remoteEl) {
            const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === remoteEl.pageId));
            const elScreenX = origin.x + (pageIdx * pageWidthMm + remoteEl.x) * pxPerMm;
            const elScreenY = origin.y + remoteEl.y * pxPerMm;
            const elScreenW = remoteEl.width * pxPerMm;
            const elScreenH = remoteEl.height * pxPerMm;

            ctx.save();
            ctx.strokeStyle = peer.color || '#f43f5e';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(elScreenX - 2, elScreenY - 2, elScreenW + 4, elScreenH + 4);

            ctx.fillStyle = peer.color || '#f43f5e';
            ctx.font = 'bold 9px Inter, sans-serif';
            const nameBadgeW = ctx.measureText(peer.name).width + 8;
            ctx.fillRect(elScreenX - 2, elScreenY - 16, nameBadgeW, 14);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(peer.name, elScreenX + 2, elScreenY - 9);
            ctx.restore();
          }
        }

        // Draw cursor & user badge
        const peerScreenX = origin.x + peer.x * pxPerMm;
        const peerScreenY = origin.y + peer.y * pxPerMm;

        ctx.save();
        ctx.fillStyle = peer.color || '#f43f5e';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;

        // SVG-style pointer arrow
        ctx.beginPath();
        ctx.moveTo(peerScreenX, peerScreenY);
        ctx.lineTo(peerScreenX, peerScreenY + 16);
        ctx.lineTo(peerScreenX + 4, peerScreenY + 12);
        ctx.lineTo(peerScreenX + 9, peerScreenY + 17);
        ctx.lineTo(peerScreenX + 12, peerScreenY + 15);
        ctx.lineTo(peerScreenX + 7, peerScreenY + 10);
        ctx.lineTo(peerScreenX + 13, peerScreenY + 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Name badge
        ctx.font = 'bold 10px Inter, sans-serif';
        const badgeWidth = ctx.measureText(peer.name).width + 10;
        ctx.fillStyle = peer.color || '#f43f5e';
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(peerScreenX + 12, peerScreenY + 12, badgeWidth, 18, 4);
          ctx.fill();
        } else {
          ctx.fillRect(peerScreenX + 12, peerScreenY + 12, badgeWidth, 18);
        }

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(peer.name, peerScreenX + 17, peerScreenY + 21);
        ctx.restore();
      }
    }

    // Prepress CMYK Plate Separation View
    if (state.plateSolo && state.plateSolo !== 'all') {
      const plate = state.plateSolo;
      const spreadPagesCount = spread.pages.length || 1;
      const spreadBleedMm = state.settings.bleedMm || 3;
      const spreadW = spreadPagesCount * pageWidthMm * pxPerMm;
      const spreadH = pageHeightMm * pxPerMm;
      const bleedPx = spreadBleedMm * pxPerMm;
      const sx = Math.max(0, Math.floor(origin.x - bleedPx));
      const sy = Math.max(0, Math.floor(origin.y - bleedPx));
      const sw = Math.min(this.canvas.width - sx, Math.ceil(spreadW + bleedPx * 2));
      const sh = Math.min(this.canvas.height - sy, Math.ceil(spreadH + bleedPx * 2));

      if (sw > 0 && sh > 0) {
        if (plate === 'spot') {
          // Spot Plate Soloing:
          // Wash out background / non-spot elements, highlight spot/varnish elements
          ctx.save();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
          ctx.fillRect(sx, sy, sw, sh);
          for (const el of spread.elements) {
            const spotCol = el.spotColor;
            if (spotCol) {
              const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
              const elX = origin.x + (pageIdx * pageWidthMm + el.x) * pxPerMm;
              const elY = origin.y + el.y * pxPerMm;
              const elW = el.width * pxPerMm;
              const elH = el.height * pxPerMm;
              ctx.fillStyle = '#1e1b4b';
              ctx.fillRect(elX, elY, elW, elH);
              ctx.strokeStyle = '#6366f1';
              ctx.lineWidth = 2;
              ctx.strokeRect(elX, elY, elW, elH);
              ctx.fillStyle = '#4f46e5';
              const badgeW = Math.max(90, ctx.measureText(`SPOT: ${spotCol}`).width + 12);
              ctx.fillRect(elX, elY - 18, badgeW, 16);
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 10px Inter, sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(`SPOT: ${spotCol}`, elX + 4, elY - 10);
            }
          }
          ctx.restore();
        } else {
          try {
            const imgData = ctx.getImageData(sx, sy, sw, sh);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
              const r = d[i] / 255;
              const g = d[i + 1] / 255;
              const b = d[i + 2] / 255;
              const k = 1 - Math.max(r, g, b);
              const c = k >= 0.999 ? 0 : (1 - r - k) / (1 - k);
              const m = k >= 0.999 ? 0 : (1 - g - k) / (1 - k);
              const y = k >= 0.999 ? 0 : (1 - b - k) / (1 - k);

              if (plate === 'cyan') {
                d[i] = Math.round(255 * (1 - c));
                d[i + 1] = Math.round(255 * (1 - c * 0.35));
                d[i + 2] = 255;
              } else if (plate === 'magenta') {
                d[i] = 255;
                d[i + 1] = Math.round(255 * (1 - m));
                d[i + 2] = Math.round(255 * (1 - m * 0.45));
              } else if (plate === 'yellow') {
                d[i] = 255;
                d[i + 1] = 255;
                d[i + 2] = Math.round(255 * (1 - y));
              } else if (plate === 'black') {
                const v = Math.round(255 * (1 - k));
                d[i] = v;
                d[i + 1] = v;
                d[i + 2] = v;
              }
            }
            ctx.putImageData(imgData, sx, sy);
          } catch {}
        }
      }
    }

    this.drawSlugBanner(ctx, origin, pxPerMm, state);
    this.drawReadingOrderOverlay(ctx, origin, pxPerMm, state);
    this.drawCommentPins(ctx, origin, pxPerMm, state);
    this.drawMeasureTool(ctx, origin, pxPerMm, state);

    if (state.tacHeatmap) {
      this.drawTacHeatmapOverlay(ctx, origin, pxPerMm, pageWidthMm, spread);
    }

    this.drawRulers();
  }

  private drawTacHeatmapOverlay(
    ctx: CanvasRenderingContext2D,
    origin: { x: number; y: number },
    pxPerMm: number,
    pageWidthMm: number,
    spread: Spread
  ) {
    ctx.save();
    let hasExceedance = false;

    for (const el of spread.elements) {
      const colorsToCheck = el.type === 'shape' || el.type === 'path' ? [el.fillColor, el.strokeColor]
        : el.type === 'text' ? [el.color, el.backgroundColor, el.borderColor] : [el.borderColor];

      let maxTac = 0;
      for (const col of colorsToCheck) {
        const tac = stateManager.calculateTacPercentage(col);
        if (tac > maxTac) maxTac = tac;
      }

      if (maxTac > 300) {
        hasExceedance = true;
        const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
        const elScreenX = origin.x + (pageIdx * pageWidthMm + el.x) * pxPerMm;
        const elScreenY = origin.y + el.y * pxPerMm;
        const elScreenW = el.width * pxPerMm;
        const elScreenH = el.height * pxPerMm;

        // Translucent ink density heatmap overlay
        const severityAlpha = Math.min(0.65, 0.35 + (maxTac - 300) / 200);
        ctx.fillStyle = `rgba(239, 68, 68, ${severityAlpha})`;
        ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH);

        // Warning border
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);
        ctx.setLineDash([]);

        // Badge showing exact TAC %
        const badgeText = `${maxTac}% TAC`;
        ctx.font = 'bold 10px Inter, system-ui, sans-serif';
        const textW = ctx.measureText(badgeText).width;
        const badgeW = textW + 10;
        const badgeH = 16;
        const badgeX = elScreenX + elScreenW - badgeW;
        const badgeY = elScreenY;

        ctx.fillStyle = '#b91c1c';
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);
      }
    }

    // Top status pill
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(origin.x, origin.y - 24, 220, 20);
    ctx.fillStyle = '#fecaca';
    ctx.font = 'bold 10.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`TAC Heatmap: ${hasExceedance ? 'Exceedances Found (>300%)' : 'All Inks Normal (<=300%)'}`, origin.x + 8, origin.y - 14);
    ctx.restore();
  }

  private drawSlugBanner(
    ctx: CanvasRenderingContext2D,
    origin: { x: number; y: number },
    pxPerMm: number,
    state: ProjectState
  ) {
    if (!state.showSlugBanner || state.previewMode) return;
    const { numPages, pageWidthMm } = this.getSpreadDimensions(state);
    const spreadWidthPx = numPages * pageWidthMm * pxPerMm;
    const bannerHeight = 18 * state.zoom;
    const bannerY = origin.y - (state.settings.bleedMm + 14) * pxPerMm;

    ctx.save();
    ctx.fillStyle = '#0f0f12';
    ctx.fillRect(origin.x, bannerY, spreadWidthPx, bannerHeight);
    ctx.strokeStyle = '#2d2d34';
    ctx.lineWidth = 1;
    ctx.strokeRect(origin.x, bannerY, spreadWidthPx, bannerHeight);

    const patchW = Math.max(6, 10 * state.zoom);
    const patchH = Math.max(6, 10 * state.zoom);
    const patchGap = Math.max(2, 4 * state.zoom);
    const patchY = bannerY + (bannerHeight - patchH) / 2;
    const colors = ['#00a0e9', '#e6007e', '#fff100', '#111111'];
    const totalPatchesWidth = colors.length * patchW + (colors.length - 1) * patchGap;
    const rightPadding = 8;
    const patchStartX = origin.x + spreadWidthPx - totalPatchesWidth - rightPadding;

    const leftPadding = 8;
    const availTextWidth = Math.max(0, patchStartX - (origin.x + leftPadding) - 12);

    ctx.fillStyle = '#a0a0a5';
    const fontSize = Math.max(8, Math.min(11, 10 * state.zoom));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'middle';

    const title = state.settings.title || 'Untitled';
    const spreadNum = `${state.activeSpreadIndex + 1}/${state.spreads.length}`;
    const bleed = `${state.settings.bleedMm}mm`;

    // Adaptive candidate strings matching available width (prevents text/patch collision on single-page spreads)
    const candidates = [
      `RECTO PREPRESS SLUG | Doc: ${title} | Spread ${spreadNum} | Bleed: ${bleed}`,
      `Doc: ${title} | Spread ${spreadNum} | Bleed: ${bleed}`,
      `Doc: ${title} | Spread ${spreadNum} | Bleed: ${bleed}`,
      `Doc: ${title} | Spread ${spreadNum}`,
      `Doc: ${title} | Sp ${spreadNum}`,
      `${title} | ${spreadNum}`,
    ];

    let chosenText = candidates[candidates.length - 1];
    for (const cand of candidates) {
      if (ctx.measureText(cand).width <= availTextWidth) {
        chosenText = cand;
        break;
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(origin.x + leftPadding, bannerY, availTextWidth, bannerHeight);
    ctx.clip();
    ctx.fillText(chosenText, origin.x + leftPadding, bannerY + bannerHeight / 2);
    ctx.restore();

    if (patchStartX > origin.x + leftPadding) {
      let currentPatchX = patchStartX;
      for (const c of colors) {
        ctx.fillStyle = c;
        ctx.fillRect(currentPatchX, patchY, patchW, patchH);
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(currentPatchX, patchY, patchW, patchH);
        currentPatchX += patchW + patchGap;
      }
    }

    ctx.restore();
  }

  private drawReadingOrderOverlay(
    ctx: CanvasRenderingContext2D,
    origin: { x: number; y: number },
    pxPerMm: number,
    state: ProjectState
  ) {
    if (!state.showReadingOrder || state.previewMode) return;
    const spread = stateManager.getActiveSpread();
    const sorted = [...spread.elements].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    const pageWidthMm = state.settings.widthMm;

    ctx.save();
    for (let i = 0; i < sorted.length; i++) {
      const el = sorted[i];
      const pageIdx = spread.pages.findIndex(p => p.id === el.pageId);
      if (pageIdx === -1) continue;
      const elScreenX = origin.x + ((pageIdx * pageWidthMm + el.x) * pxPerMm);
      const elScreenY = origin.y + (el.y * pxPerMm);

      if (i < sorted.length - 1) {
        const next = sorted[i + 1];
        const nextIdx = spread.pages.findIndex(p => p.id === next.pageId);
        if (nextIdx !== -1) {
          const nextScreenX = origin.x + ((nextIdx * pageWidthMm + next.x) * pxPerMm);
          const nextScreenY = origin.y + (next.y * pxPerMm);
          ctx.strokeStyle = 'rgba(13, 153, 255, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(elScreenX + 10, elScreenY + 10);
          ctx.lineTo(nextScreenX + 10, nextScreenY + 10);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      ctx.fillStyle = '#0d99ff';
      ctx.beginPath();
      ctx.arc(elScreenX + 10, elScreenY + 10, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, elScreenX + 10, elScreenY + 10);
    }
    ctx.restore();
  }

  private drawCommentPins(
    ctx: CanvasRenderingContext2D,
    origin: { x: number; y: number },
    pxPerMm: number,
    state: ProjectState
  ) {
    if (!state.comments || state.comments.length === 0 || state.previewMode) return;
    ctx.save();
    for (const c of state.comments) {
      const position = reviewPinPosition(state, c, state.activeSpreadIndex);
      if (position?.spreadIndex !== state.activeSpreadIndex) continue;
      const px = origin.x + position.x * pxPerMm;
      const py = origin.y + position.y * pxPerMm;

      ctx.fillStyle = c.resolved ? '#2ec4b6' : '#f4a261';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.resolved ? '✓' : '●', px, py);
    }
    ctx.restore();
  }

  private drawMeasureTool(
    ctx: CanvasRenderingContext2D,
    origin: { x: number; y: number },
    pxPerMm: number,
    state: ProjectState
  ) {
    if (!state.activeMeasure || state.previewMode) return;
    const m = state.activeMeasure;
    const p1x = origin.x + m.startX * pxPerMm;
    const p1y = origin.y + m.startY * pxPerMm;
    const p2x = origin.x + m.currentX * pxPerMm;
    const p2y = origin.y + m.currentY * pxPerMm;

    ctx.save();
    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(p1x, p1y);
    ctx.lineTo(p2x, p2y);
    ctx.stroke();
    ctx.setLineDash([]);

    const drawCross = (x: number, y: number) => {
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
    };
    drawCross(p1x, p1y);
    drawCross(p2x, p2y);

    const midX = (p1x + p2x) / 2;
    const midY = (p1y + p2y) / 2;
    const label = `${m.distanceMm.toFixed(1)} mm (${m.angleDeg.toFixed(1)}°)`;
    ctx.font = 'bold 11px Inter, sans-serif';
    const textW = ctx.measureText(label).width;
    ctx.fillStyle = '#18181c';
    ctx.fillRect(midX - textW / 2 - 6, midY - 10, textW + 12, 20);
    ctx.strokeStyle = '#0d99ff';
    ctx.strokeRect(midX - textW / 2 - 6, midY - 10, textW + 12, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);
    ctx.restore();
  }

  private drawDimensionHud(
    ctx: CanvasRenderingContext2D,
    badgeX: number,
    badgeY: number,
    wMm: number,
    hMm: number,
    extraLabel?: string
  ) {
    ctx.save();
    const textW = `W: ${wMm.toFixed(1)} mm`;
    const textH = `H: ${hMm.toFixed(1)} mm`;
    const fullText = extraLabel ? `${extraLabel}  ${textW}  ${textH}` : `${textW}   ${textH}`;

    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const textMetrics = ctx.measureText(fullText);
    const padX = 8;
    const pillW = textMetrics.width + padX * 2;
    const pillH = 22;

    let bx = badgeX;
    let by = badgeY;
    if (bx + pillW > this.canvas.width - 10) bx = badgeX - pillW - 20;
    if (by + pillH > this.canvas.height - 10) by = badgeY - pillH - 20;
    if (bx < 10) bx = 10;
    if (by < 10) by = 10;

    // Dark sleek backdrop pill with subtle border
    ctx.fillStyle = 'rgba(18, 18, 22, 0.92)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;

    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(bx, by, pillW, pillH, 5);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(bx, by, pillW, pillH);
      ctx.strokeRect(bx, by, pillW, pillH);
    }

    // Typography
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let curX = bx + padX;
    const centerY = by + pillH / 2;

    if (extraLabel) {
      ctx.fillStyle = '#0d99ff';
      ctx.fillText(extraLabel, curX, centerY);
      curX += ctx.measureText(extraLabel).width + 6;
    }

    ctx.fillStyle = '#0d99ff';
    ctx.fillText('W:', curX, centerY);
    curX += ctx.measureText('W:').width + 3;

    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${wMm.toFixed(1)} mm`, curX, centerY);
    curX += ctx.measureText(`${wMm.toFixed(1)} mm`).width + 7;

    ctx.fillStyle = '#0d99ff';
    ctx.fillText('H:', curX, centerY);
    curX += ctx.measureText('H:').width + 3;

    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${hMm.toFixed(1)} mm`, curX, centerY);

    ctx.restore();
  }

  private drawSmartGuides(
    ctx: CanvasRenderingContext2D,
    origin: { x: number; y: number },
    pxPerMm: number,
    pageWidthMm: number
  ) {
    if (!this.activeSmartGuides) return;
    const { lines, spacings } = this.activeSmartGuides;
    if (lines.length === 0 && spacings.length === 0) return;

    ctx.save();

    // 1. Draw Smart Guide Alignment Lines (InDesign Smart Magenta #e6007e)
    for (const line of lines) {
      const pageStartMm = line.pageIndex * pageWidthMm;
      ctx.strokeStyle = '#e6007e';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);

      if (line.orientation === 'v') {
        const screenX = origin.x + (pageStartMm + line.posMm) * pxPerMm;
        const screenY1 = origin.y + line.minMm * pxPerMm;
        const screenY2 = origin.y + line.maxMm * pxPerMm;

        ctx.beginPath();
        ctx.moveTo(screenX, screenY1);
        ctx.lineTo(screenX, screenY2);
        ctx.stroke();

        // Center alignment tick mark
        ctx.setLineDash([]);
        ctx.fillStyle = '#e6007e';
        ctx.fillRect(screenX - 2.5, (screenY1 + screenY2) / 2 - 2.5, 5, 5);
      } else {
        const screenY = origin.y + line.posMm * pxPerMm;
        const screenX1 = origin.x + (pageStartMm + line.minMm) * pxPerMm;
        const screenX2 = origin.x + (pageStartMm + line.maxMm) * pxPerMm;

        ctx.beginPath();
        ctx.moveTo(screenX1, screenY);
        ctx.lineTo(screenX2, screenY);
        ctx.stroke();

        // Center alignment tick mark
        ctx.setLineDash([]);
        ctx.fillStyle = '#e6007e';
        ctx.fillRect((screenX1 + screenX2) / 2 - 2.5, screenY - 2.5, 5, 5);
      }
    }

    // 2. Draw Equal Spacing Distance Indicators (Cyan dimension brackets + pills)
    for (const sp of spacings) {
      const pageStartMm = sp.pageIndex * pageWidthMm;
      const x1 = origin.x + (pageStartMm + sp.startMm) * pxPerMm;
      const x2 = origin.x + (pageStartMm + sp.endMm) * pxPerMm;
      const y = origin.y + sp.crossMm * pxPerMm;

      ctx.strokeStyle = '#00e5ff';
      ctx.fillStyle = '#00e5ff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([]);

      // Dimension line
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      // End bracket bars
      ctx.moveTo(x1, y - 5);
      ctx.lineTo(x1, y + 5);
      ctx.moveTo(x2, y - 5);
      ctx.lineTo(x2, y + 5);
      ctx.stroke();

      // Dimension badge
      const label = `↔ ${sp.gapMm.toFixed(1)} mm`;
      ctx.font = 'bold 9px Inter, system-ui, sans-serif';
      const textW = ctx.measureText(label).width;
      const badgeW = textW + 10;
      const badgeH = 16;
      const badgeX = (x1 + x2) / 2 - badgeW / 2;
      const badgeY = y - 20;

      ctx.fillStyle = 'rgba(18, 18, 22, 0.92)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1;

      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
      }

      ctx.fillStyle = '#00e5ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, (x1 + x2) / 2, badgeY + badgeH / 2);
    }

    ctx.restore();
  }

  private renderDrawingPreview(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    screenW: number,
    screenH: number,
    wMm: number,
    hMm: number,
    activeTool: string,
    cursorScreenX: number,
    cursorScreenY: number
  ) {
    ctx.save();

    const isEllipse = activeTool === 'shape-ellipse';
    const isLine = activeTool === 'shape-line';
    const isFrame = activeTool === 'frame';
    const isText = activeTool === 'text';
    const isTable = activeTool === 'table';

    // Ghost preview fill & stroke
    ctx.fillStyle = 'rgba(13, 153, 255, 0.08)';
    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    if (isLine) {
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(screenX + screenW, screenY + screenH);
      ctx.stroke();
    } else if (isEllipse) {
      const rx = Math.max(0.5, screenW / 2);
      const ry = Math.max(0.5, screenH / 2);
      const cx = screenX + rx;
      const cy = screenY + ry;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(screenX, screenY, screenW, screenH);
      ctx.strokeRect(screenX, screenY, screenW, screenH);

      // Frame diagonal cross lines
      if (isFrame && screenW > 10 && screenH > 10) {
        ctx.save();
        ctx.strokeStyle = 'rgba(13, 153, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(screenX + screenW, screenY + screenH);
        ctx.moveTo(screenX + screenW, screenY);
        ctx.lineTo(screenX, screenY + screenH);
        ctx.stroke();
        ctx.restore();
      }

      // Table 3x3 grid preview lines
      if (isTable && screenW > 20 && screenH > 20) {
        ctx.save();
        ctx.strokeStyle = 'rgba(13, 153, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        for (let c = 1; c < 3; c++) {
          const gx = screenX + (screenW * c) / 3;
          ctx.moveTo(gx, screenY);
          ctx.lineTo(gx, screenY + screenH);
        }
        for (let r = 1; r < 3; r++) {
          const gy = screenY + (screenH * r) / 3;
          ctx.moveTo(screenX, gy);
          ctx.lineTo(screenX + screenW, gy);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Text icon indicator at top-left
      if (isText && screenW > 24 && screenH > 18) {
        ctx.save();
        ctx.fillStyle = 'rgba(13, 153, 255, 0.2)';
        ctx.fillRect(screenX, screenY, 18, 16);
        ctx.fillStyle = '#0d99ff';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('T', screenX + 9, screenY + 8);
        ctx.restore();
      }
    }

    // Corner handle markers
    if (!isLine && screenW > 15 && screenH > 15) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      const handles = [
        [screenX, screenY],
        [screenX + screenW, screenY],
        [screenX + screenW, screenY + screenH],
        [screenX, screenY + screenH],
      ];
      for (const [hx, hy] of handles) {
        ctx.fillRect(hx - 3, hy - 3, 6, 6);
        ctx.strokeRect(hx - 3, hy - 3, 6, 6);
      }
    }

    ctx.restore();

    // Floating Dimension HUD Pill beside cursor
    let toolBadge = '';
    if (isText) toolBadge = 'Text Frame';
    else if (isFrame) toolBadge = 'Graphic Frame';
    else if (isTable) toolBadge = 'Table';
    else if (isEllipse) toolBadge = 'Ellipse';
    else if (isLine) toolBadge = 'Line';
    else toolBadge = 'Shape';

    this.drawDimensionHud(ctx, cursorScreenX + 14, cursorScreenY + 14, wMm, hMm, toolBadge);
  }

  public refreshRulerPalette(): void {
    const style = getComputedStyle(this.rulerTop);
    this.rulerPalette = {
      background: style.backgroundColor,
      marks: style.getPropertyValue('--text-secondary').trim(),
      labels: style.color,
      cursor: style.accentColor,
    };
  }

  public drawRulers() {
    const state = stateManager.getState();
    this.rulers.draw(this.getSpreadScreenOrigin(state), state.zoom, { x: this.mouseMmX, y: this.mouseMmY }, this.rulerPalette);
  }

  private renderVectorPath(
    ctx: CanvasRenderingContext2D,
    el: VectorPathElement,
    origin: { x: number; y: number },
    pageStartMm: number,
    pxPerMm: number,
    isSelected: boolean,
    activePathId: string | null,
    monochrome = false,
  ) {
    if (!el.nodes || el.nodes.length === 0) return;

    const elScreenX = origin.x + ((pageStartMm + el.x) * pxPerMm);
    const elScreenY = origin.y + (el.y * pxPerMm);

    ctx.save();
    ctx.beginPath();

    const firstNode = el.nodes[0];
    const startX = elScreenX + firstNode.x * pxPerMm;
    const startY = elScreenY + firstNode.y * pxPerMm;
    ctx.moveTo(startX, startY);

    for (let i = 1; i < el.nodes.length; i++) {
      const prev = el.nodes[i - 1];
      const curr = el.nodes[i];
      const cp1x = elScreenX + (prev.x + (prev.handleOut?.x || 0)) * pxPerMm;
      const cp1y = elScreenY + (prev.y + (prev.handleOut?.y || 0)) * pxPerMm;
      const cp2x = elScreenX + (curr.x + (curr.handleIn?.x || 0)) * pxPerMm;
      const cp2y = elScreenY + (curr.y + (curr.handleIn?.y || 0)) * pxPerMm;
      const endx = elScreenX + curr.x * pxPerMm;
      const endy = elScreenY + curr.y * pxPerMm;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endx, endy);
    }

    if (el.closed && el.nodes.length >= 3) {
      const last = el.nodes[el.nodes.length - 1];
      const cp1x = elScreenX + (last.x + (last.handleOut?.x || 0)) * pxPerMm;
      const cp1y = elScreenY + (last.y + (last.handleOut?.y || 0)) * pxPerMm;
      const cp2x = elScreenX + (firstNode.x + (firstNode.handleIn?.x || 0)) * pxPerMm;
      const cp2y = elScreenY + (firstNode.y + (firstNode.handleIn?.y || 0)) * pxPerMm;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, startX, startY);
      ctx.closePath();
    }

    // Fill
    const gradient = el.closed && el.fillGradient;
    if (gradient || el.fillColor && el.fillColor !== 'transparent') {
      ctx.fillStyle = gradient ? canvasGradient(ctx, gradient, elScreenX, elScreenY, el.width * pxPerMm, el.height * pxPerMm, monochrome) : displayGradientColor(el.fillColor);
      ctx.fill();
    }
    if (el.closed) this.drawDecoration(ctx, el, elScreenX, elScreenY, pxPerMm);

    // Stroke
    if (el.strokeWidthMm > 0 && el.strokeColor !== 'transparent') {
      ctx.strokeStyle = displayGradientColor(el.strokeColor);
      ctx.lineWidth = Math.max(0.5, el.strokeWidthMm * pxPerMm);
      ctx.lineCap = el.strokeCap || 'round';
      ctx.lineJoin = el.strokeJoin || 'round';
      if (el.strokePattern) {
        ctx.setLineDash([el.strokePattern.dash * pxPerMm, el.strokePattern.gap * pxPerMm]);
      } else if (el.strokeDash === 'dashed') {
        ctx.setLineDash([4 * pxPerMm, 3 * pxPerMm]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Text on path
    if (el.textOnPath && el.textOnPath.text && el.nodes.length >= 2) {
      this.renderTextOnPath(ctx, el, elScreenX, elScreenY, pxPerMm);
    }

    // Draw handles and nodes if selected or actively being edited
    if (isSelected || el.id === activePathId) {
      this.renderPathNodesAndHandles(ctx, el, elScreenX, elScreenY, pxPerMm);
    }
  }

  private drawLineWithGrep(
    ctx: CanvasRenderingContext2D,
    lineText: string,
    startX: number,
    startY: number,
    fontSizePx: number,
    fontFamily: string,
    defaultColor: string,
    grepRules?: GrepStyleRule[]
  ): void {
    if (!grepRules || grepRules.length === 0) {
      ctx.fillText(lineText, startX, startY);
      return;
    }
    const segs = segmentTextWithGrep(lineText, grepRules, defaultColor);
    let curX = startX;
    const origFont = ctx.font;
    const origFill = ctx.fillStyle;
    for (const seg of segs) {
      if (seg.bold || seg.italic) {
        const weight = seg.bold ? 'bold ' : '';
        const slant = seg.italic ? 'italic ' : '';
        ctx.font = `${weight}${slant}${fontSizePx}px ${fontFamily}`;
      } else {
        ctx.font = origFont;
      }
      ctx.fillStyle = seg.color || defaultColor;
      ctx.fillText(seg.text, curX, startY);
      curX += ctx.measureText(seg.text).width;
    }
    ctx.font = origFont;
    ctx.fillStyle = origFill;
  }

  private renderTextOnPath(
    ctx: CanvasRenderingContext2D,
    el: VectorPathElement,
    elScreenX: number,
    elScreenY: number,
    pxPerMm: number
  ) {
    const textSettings = el.textOnPath!;
    const text = textSettings.text;
    if (!text) return;

    // Build segments
    const segments: { p0: { x: number; y: number }; c1: { x: number; y: number }; c2: { x: number; y: number }; p3: { x: number; y: number } }[] = [];
    for (let i = 1; i < el.nodes.length; i++) {
      const prev = el.nodes[i - 1];
      const curr = el.nodes[i];
      segments.push({
        p0: { x: elScreenX + prev.x * pxPerMm, y: elScreenY + prev.y * pxPerMm },
        c1: { x: elScreenX + (prev.x + (prev.handleOut?.x || 0)) * pxPerMm, y: elScreenY + (prev.y + (prev.handleOut?.y || 0)) * pxPerMm },
        c2: { x: elScreenX + (curr.x + (curr.handleIn?.x || 0)) * pxPerMm, y: elScreenY + (curr.y + (curr.handleIn?.y || 0)) * pxPerMm },
        p3: { x: elScreenX + curr.x * pxPerMm, y: elScreenY + curr.y * pxPerMm },
      });
    }

    if (el.closed && el.nodes.length >= 3) {
      const last = el.nodes[el.nodes.length - 1];
      const first = el.nodes[0];
      segments.push({
        p0: { x: elScreenX + last.x * pxPerMm, y: elScreenY + last.y * pxPerMm },
        c1: { x: elScreenX + (last.x + (last.handleOut?.x || 0)) * pxPerMm, y: elScreenY + (last.y + (last.handleOut?.y || 0)) * pxPerMm },
        c2: { x: elScreenX + (first.x + (first.handleIn?.x || 0)) * pxPerMm, y: elScreenY + (first.y + (first.handleIn?.y || 0)) * pxPerMm },
        p3: { x: elScreenX + first.x * pxPerMm, y: elScreenY + first.y * pxPerMm },
      });
    }

    if (segments.length === 0) return;

    interface SamplePoint {
      segIdx: number;
      t: number;
      x: number;
      y: number;
      cumDist: number;
    }

    const samples: SamplePoint[] = [];
    let totalLength = 0;
    const stepsPerSeg = 20;

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      for (let st = 0; st <= stepsPerSeg; st++) {
        if (s > 0 && st === 0) continue;
        const t = st / stepsPerSeg;
        const mt = 1 - t;
        const x = mt * mt * mt * seg.p0.x + 3 * mt * mt * t * seg.c1.x + 3 * mt * t * t * seg.c2.x + t * t * t * seg.p3.x;
        const y = mt * mt * mt * seg.p0.y + 3 * mt * mt * t * seg.c1.y + 3 * mt * t * t * seg.c2.y + t * t * t * seg.p3.y;

        if (samples.length > 0) {
          const prevSample = samples[samples.length - 1];
          totalLength += Math.hypot(x - prevSample.x, y - prevSample.y);
        }

        samples.push({
          segIdx: s,
          t,
          x,
          y,
          cumDist: totalLength,
        });
      }
    }

    if (totalLength < 1) return;

    ctx.save();
    const fontSizePx = (textSettings.fontSizePt * (96 / 72)) * (pxPerMm / MM_TO_PX);
    ctx.font = `${fontSizePx}px ${textSettings.fontFamily || 'Inter, sans-serif'}`;
    ctx.fillStyle = textSettings.color || '#111111';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const textWidth = ctx.measureText(text).width;
    let startDist = (textSettings.startOffsetMm || 0) * pxPerMm;
    if (textSettings.align === 'center') {
      startDist += (totalLength - textWidth) / 2;
    } else if (textSettings.align === 'right') {
      startDist += (totalLength - textWidth);
    }

    let curDist = startDist;

    for (let c = 0; c < text.length; c++) {
      const char = text[c];
      const charWidth = ctx.measureText(char).width;
      const targetDist = curDist + charWidth / 2;
      curDist += charWidth;

      if (targetDist < 0 || targetDist > totalLength) continue;

      let low = 0;
      let high = samples.length - 1;
      while (low < high - 1) {
        const mid = (low + high) >> 1;
        if (samples[mid].cumDist <= targetDist) {
          low = mid;
        } else {
          high = mid;
        }
      }

      const s0 = samples[low];
      const s1 = samples[high];
      const span = s1.cumDist - s0.cumDist;
      const frac = span > 0.0001 ? (targetDist - s0.cumDist) / span : 0;
      const seg = segments[s0.segIdx];
      const t = s0.t + frac * (s1.t - s0.t);

      const mt = 1 - t;
      const posX = mt * mt * mt * seg.p0.x + 3 * mt * mt * t * seg.c1.x + 3 * mt * t * t * seg.c2.x + t * t * t * seg.p3.x;
      const posY = mt * mt * mt * seg.p0.y + 3 * mt * mt * t * seg.c1.y + 3 * mt * t * t * seg.c2.y + t * t * t * seg.p3.y;

      const dx = 3 * mt * mt * (seg.c1.x - seg.p0.x) + 6 * mt * t * (seg.c2.x - seg.c1.x) + 3 * t * t * (seg.p3.x - seg.c2.x);
      const dy = 3 * mt * mt * (seg.c1.y - seg.p0.y) + 6 * mt * t * (seg.c2.y - seg.c1.y) + 3 * t * t * (seg.p3.y - seg.c2.y);
      const angle = Math.atan2(dy, dx);

      ctx.save();
      ctx.translate(posX, posY);
      ctx.rotate(angle);
      ctx.fillText(char, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  private renderPathNodesAndHandles(
    ctx: CanvasRenderingContext2D,
    el: VectorPathElement,
    elScreenX: number,
    elScreenY: number,
    pxPerMm: number
  ) {
    ctx.save();
    for (let i = 0; i < el.nodes.length; i++) {
      const n = el.nodes[i];
      const ax = elScreenX + n.x * pxPerMm;
      const ay = elScreenY + n.y * pxPerMm;

      // Handle In
      if (n.handleIn) {
        const hInX = ax + n.handleIn.x * pxPerMm;
        const hInY = ay + n.handleIn.y * pxPerMm;
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(hInX, hInY);
        ctx.stroke();

        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(hInX, hInY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Handle Out
      if (n.handleOut) {
        const hOutX = ax + n.handleOut.x * pxPerMm;
        const hOutY = ay + n.handleOut.y * pxPerMm;
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(hOutX, hOutY);
        ctx.stroke();

        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(hOutX, hOutY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Anchor point (square)
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.5;
      ctx.fillRect(ax - 3.5, ay - 3.5, 7, 7);
      ctx.strokeRect(ax - 3.5, ay - 3.5, 7, 7);
    }
    ctx.restore();
  }
}
