import {
  ProjectState,
  Spread,
  Page,
  CanvasElement,
  TextElement,
  ImageElement,
  ImageFitMode,
  ShapeElement,
  TableElement,
  VectorPathElement,
  BezierNode,
  TextOnPathSettings,
  DisplayQuality,
  OpenTypeFeatures,
} from './types';
import { stateManager, numberToSuperscript } from './state';
import { collabSession } from './collab';
import { assetStore } from './engine/assetStore';
import { tableEngine } from './engine/tableEngine';

export const MM_TO_PX = 3.7795275591;

export function formatOpenTypeText(str: string, features?: OpenTypeFeatures): string {
  if (!features || !str) return str;
  let res = str;
  if (features.fractions) {
    res = res
      .replace(/\b1\/2\b/g, '½')
      .replace(/\b1\/4\b/g, '¼')
      .replace(/\b3\/4\b/g, '¾')
      .replace(/\b1\/3\b/g, '⅓')
      .replace(/\b2\/3\b/g, '⅔')
      .replace(/\b1\/8\b/g, '⅛')
      .replace(/\b3\/8\b/g, '⅜')
      .replace(/\b5\/8\b/g, '⅝')
      .replace(/\b7\/8\b/g, '⅞');
  }
  if (features.ligatures) {
    res = res
      .replace(/ffi/g, 'ﬃ')
      .replace(/ffl/g, 'ﬄ')
      .replace(/fi/g, 'ﬁ')
      .replace(/fl/g, 'ﬂ')
      .replace(/ff/g, 'ﬀ');
  }
  return res;
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

export interface ImageFitTransform {
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
  scaleX?: number;
  scaleY?: number;
}

export function calculateImageFitting(
  frameX: number,
  frameY: number,
  frameW: number,
  frameH: number,
  imgW: number,
  imgH: number,
  fitMode: ImageFitMode = 'fill'
): ImageFitTransform {
  if (imgW <= 0 || imgH <= 0 || frameW <= 0 || frameH <= 0) {
    return { drawX: frameX, drawY: frameY, drawW: frameW, drawH: frameH, scaleX: 1, scaleY: 1 };
  }

  switch (fitMode) {
    case 'fill': {
      // 1. Fill Frame Proportionally (Ctrl+Alt+Shift+C):
      // Scales image proportionally to fill the frame; crops excess. Centered in frame.
      const scale = Math.max(frameW / imgW, frameH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      return { drawX, drawY, drawW, drawH, scaleX: scale, scaleY: scale };
    }

    case 'fit': {
      // 2. Fit Content Proportionally (Ctrl+Alt+Shift+E):
      // Scales image proportionally so entire content fits within frame; no crop. Centered in frame.
      const scale = Math.min(frameW / imgW, frameH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      return { drawX, drawY, drawW, drawH, scaleX: scale, scaleY: scale };
    }

    case 'frameToContent': {
      // 3. Fit Frame to Content (Ctrl+Alt+C):
      // Proportional content fit matching adjusted frame bounds.
      const scale = Math.min(frameW / imgW, frameH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      return { drawX, drawY, drawW, drawH, scaleX: scale, scaleY: scale };
    }

    case 'contentToFrame':
    case 'stretch': {
      // 4. Fit Content to Frame (Ctrl+Alt+E):
      // Anamorphic stretch: content dimensions match frame bounds exactly.
      return {
        drawX: frameX,
        drawY: frameY,
        drawW: frameW,
        drawH: frameH,
        scaleX: frameW / imgW,
        scaleY: frameH / imgH,
      };
    }

    case 'center': {
      // 5. Center Content (Ctrl+Shift+E):
      // Centers content within frame without altering intrinsic scale.
      const drawW = imgW;
      const drawH = imgH;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      return { drawX, drawY, drawW, drawH, scaleX: 1, scaleY: 1 };
    }

    default:
      return { drawX: frameX, drawY: frameY, drawW: frameW, drawH: frameH, scaleX: 1, scaleY: 1 };
  }
}

export class SpreadCanvas {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rulerTop: HTMLCanvasElement;
  private rulerLeft: HTMLCanvasElement;
  private ctxTop: CanvasRenderingContext2D;
  private ctxLeft: CanvasRenderingContext2D;

  private isDragging: boolean = false;
  private isResizing: boolean = false;
  private isPanning: boolean = false;
  private isSpacePanning: boolean = false;
  private isDrawingNew: boolean = false;
  private isMarquee: boolean = false;
  private activeHandle: string | null = null;
  private overflownTextFrameIds: Set<string> = new Set();

  private activePenPathId: string | null = null;
  private activePenNodeIndex: number = -1;
  private isPenDraggingHandle: boolean = false;
  private activeNodeDrag: {
    pathId: string;
    nodeIndex: number;
    part: 'anchor' | 'handleIn' | 'handleOut';
    startDragX: number;
    startDragY: number;
    initialNode: BezierNode;
  } | null = null;

  private marqueeStartMmX: number = 0;
  private marqueeStartMmY: number = 0;
  private marqueeCurrentMmX: number = 0;
  private marqueeCurrentMmY: number = 0;
  private dragInitialPositions: Map<string, { x: number; y: number; locked: boolean; width: number; height: number; pageId: string }> = new Map();
  private activeSmartGuides: {
    lines: {
      orientation: 'v' | 'h';
      posMm: number;
      minMm: number;
      maxMm: number;
      pageIndex: number;
    }[];
    spacings: {
      orientation: 'h' | 'v';
      startMm: number;
      endMm: number;
      crossMm: number;
      gapMm: number;
      pageIndex: number;
    }[];
  } = { lines: [], spacings: [] };

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
  private _dragUpdates: Array<{ id: string; partial: Partial<CanvasElement> }> = [];

  // Multi-tier image caches (Full-Res vs Downscaled Viewport Proxy)
  private fullResCache: Map<string, HTMLImageElement> = new Map();
  private proxyCache: Map<string, HTMLCanvasElement> = new Map();

  // Static layer offscreen canvas caching
  private staticCanvas: HTMLCanvasElement = document.createElement('canvas');
  private staticCtx: CanvasRenderingContext2D = this.staticCanvas.getContext('2d')!;
  private staticDirtyKey: string = '';
  private staticBleedPx: number = 0;

  // Text layout memoization
  private textLayoutCache: Map<string, any> = new Map();

  // Active in-place canvas overlay editor (WordPad/Figma style)
  private activeInlineEditor: { elementId: string; el: HTMLElement } | null = null;

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    rulerTop: HTMLCanvasElement,
    rulerLeft: HTMLCanvasElement
  ) {
    this.container = container;
    this.canvas = canvas;
    this.rulerTop = rulerTop;
    this.rulerLeft = rulerLeft;

    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctxTop = rulerTop.getContext('2d')!;
    this.ctxLeft = rulerLeft.getContext('2d')!;

    this.initEvents();
    this.resizeCanvas();

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.render();
    });

    stateManager.subscribe(() => {
      this.render();
    });

    collabSession.onPeersChange(() => {
      this.render();
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

    this.rulerTop.width = w * dpr;
    this.rulerTop.height = 24 * dpr;
    this.rulerTop.style.width = `${w}px`;
    this.rulerTop.style.height = '24px';
    this.ctxTop.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.rulerLeft.width = 24 * dpr;
    this.rulerLeft.height = h * dpr;
    this.rulerLeft.style.width = '24px';
    this.rulerLeft.style.height = `${h}px`;
    this.ctxLeft.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private initEvents() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    window.addEventListener('mousemove', this.handleMouseMove.bind(this));
    window.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
    this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));

    this.canvas.addEventListener('dragover', (e) => e.preventDefault());
    this.canvas.addEventListener('drop', this.handleFileDrop.bind(this));

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      const isMod = e.ctrlKey || e.metaKey;

      if (e.code === 'Space' && !this.isSpacePanning) {
        e.preventDefault();
        this.isSpacePanning = true;
        this.canvas.style.cursor = 'grab';
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const state = stateManager.getState();
        const hasSelection = (state.selectedElementIds && state.selectedElementIds.length > 0) || !!state.selectedElementId;
        if (hasSelection) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          else if (e.key === 'ArrowRight') dx = step;
          else if (e.key === 'ArrowUp') dy = -step;
          else if (e.key === 'ArrowDown') dy = step;
          stateManager.nudgeSelectedElements(dx, dy);
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = stateManager.getState();
        if (state.selectedElementIds && state.selectedElementIds.length > 0) {
          stateManager.deleteSelectedElements();
        } else if (state.selectedElementId) {
          stateManager.deleteElement(state.selectedElementId);
        }
      } else if (isMod && e.altKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        stateManager.applyImageFitMode('fill');
      } else if (isMod && e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        stateManager.applyImageFitMode('fit');
      } else if (isMod && e.altKey && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        stateManager.applyImageFitMode('contentToFrame');
      } else if (isMod && !e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        stateManager.applyImageFitMode('center');
      } else if (!isMod && !e.altKey && (e.key === 'v' || e.key === 'V')) {
        stateManager.setTool('select');
      } else if (!isMod && !e.altKey && (e.key === 't' || e.key === 'T')) {
        stateManager.setTool('text');
      } else if (!isMod && !e.altKey && (e.key === 'p' || e.key === 'P')) {
        stateManager.setTool('pen');
      } else if (!isMod && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        stateManager.setTool('table');
      } else if (e.key === 'Escape' || e.key === 'Enter') {
        if (this.activePenPathId) {
          this.activePenPathId = null;
          this.activePenNodeIndex = -1;
          this.isPenDraggingHandle = false;
          stateManager.setTool('select');
          this.render();
        }
      } else if (!isMod && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        stateManager.setTool('frame');
      } else if (!isMod && !e.altKey && (e.key === 'm' || e.key === 'M')) {
        stateManager.setTool('shape-rect');
      } else if (!isMod && !e.altKey && (e.key === 'h' || e.key === 'H')) {
        stateManager.setTool('hand');
      } else if (isMod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) stateManager.redo();
        else stateManager.undo();
      } else if (isMod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        stateManager.redo();
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.isSpacePanning = false;
        if (!this.isPanning) {
          const state = stateManager.getState();
          this.canvas.style.cursor = state.activeTool === 'hand' ? 'grab' : 'default';
        }
      }
    });
  }

  private getSpreadDimensions(state: ProjectState) {
    const spread = stateManager.getActiveSpread();
    const numPages = spread.pages.length;
    const pageWidthMm = state.settings.widthMm;
    const pageHeightMm = state.settings.heightMm;

    const spreadWidthMm = pageWidthMm * numPages;
    const spreadHeightMm = pageHeightMm;

    const dims = this._spreadDims;
    dims.numPages = numPages;
    dims.pageWidthMm = pageWidthMm;
    dims.pageHeightMm = pageHeightMm;
    dims.spreadWidthMm = spreadWidthMm;
    dims.spreadHeightMm = spreadHeightMm;
    dims.spreadWidthPx = spreadWidthMm * MM_TO_PX * state.zoom;
    dims.spreadHeightPx = spreadHeightMm * MM_TO_PX * state.zoom;

    return dims;
  }

  private getSpreadScreenOrigin(state: ProjectState) {
    const rect = this.canvas.getBoundingClientRect();
    const { spreadWidthPx, spreadHeightPx } = this.getSpreadDimensions(state);

    const canvasW = rect.width > 0 ? rect.width : (this.canvas.width || spreadWidthPx);
    const canvasH = rect.height > 0 ? rect.height : (this.canvas.height || spreadHeightPx);

    const centerX = canvasW / 2 + state.panX;
    const centerY = canvasH / 2 + state.panY;

    this._origin.x = centerX - spreadWidthPx / 2;
    this._origin.y = centerY - spreadHeightPx / 2;

    return this._origin;
  }

  private screenToSpreadMm(screenX: number, screenY: number, state: ProjectState) {
    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    this._pointMm.x = (screenX - origin.x) / pxPerMm;
    this._pointMm.y = (screenY - origin.y) / pxPerMm;
    return this._pointMm;
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

  private handleMouseDown(e: MouseEvent) {
    if (this.activeInlineEditor) {
      this.closeInlineTextEditor(true);
    }
    const state = stateManager.getState();
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (e.button === 1 || state.activeTool === 'hand' || this.isSpacePanning || (e as any).spaceKey) {
      this.isPanning = true;
      this.panStartX = e.clientX - state.panX;
      this.panStartY = e.clientY - state.panY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const { x: mmX, y: mmY } = this.screenToSpreadMm(screenX, screenY, state);

    if (state.comments && state.comments.length > 0 && !state.previewMode) {
      const activeComments = state.comments.filter(c => c.spreadIndex === state.activeSpreadIndex);
      for (const c of activeComments) {
        const dx = mmX - c.x;
        const dy = mmY - c.y;
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
        this.handlePenMouseDown(mmX, mmY, screenX, screenY, e);
        return;
      }
      if (state.activeTool === 'text') {
        const hit = this.hitTestElements(mmX, mmY, state);
        if (hit && hit.type === 'text' && !hit.locked) {
          stateManager.selectElement(hit.id);
          this.openInlineTextEditor(hit.id);
          return;
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
        stateManager.setLinkingFromFrame(null);
      }
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
            const pathEl = el as VectorPathElement;
            const initialNode = JSON.parse(JSON.stringify(pathEl.nodes[nodeHit.nodeIndex]));
            this.activeNodeDrag = {
              pathId: el.id,
              nodeIndex: nodeHit.nodeIndex,
              part: nodeHit.part,
              startDragX: screenX,
              startDragY: screenY,
              initialNode,
            };
            return;
          }
        }

        const handle = this.hitTestHandles(screenX, screenY, state);
        if (handle) {
          this.isResizing = true;
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
    this.isDragging = true;
    this.dragStartX = screenX;
    this.dragStartY = screenY;
    this.dragInitialPositions.clear();
    this.activeSmartGuides = { lines: [], spacings: [] };
    const spread = stateManager.getActiveSpread();
    const ids = state.selectedElementIds && state.selectedElementIds.length > 0
      ? state.selectedElementIds
      : (state.selectedElementId ? [state.selectedElementId] : []);

    for (const id of ids) {
      const el = spread.elements.find(item => item.id === id);
      if (el) {
        const elLayer = state.layers?.find(l => l.id === (el.layerId || 'layer-1'));
        const isLocked = !!el.locked || Boolean(elLayer?.locked) || Boolean(el.editorialOnly);
        this.dragInitialPositions.set(id, {
          x: el.x,
          y: el.y,
          locked: isLocked,
          width: el.width,
          height: el.height,
          pageId: el.pageId,
        });
      }
    }
  }

  private handleMouseMove(e: MouseEvent) {
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

    if (state.linkingFromFrameId) {
      this.render();
    }

    if (this.isPenDraggingHandle && this.activePenPathId) {
      const spread = stateManager.getActiveSpread();
      const pathEl = spread.elements.find(item => item.id === this.activePenPathId) as VectorPathElement | undefined;
      if (pathEl && pathEl.nodes[this.activePenNodeIndex]) {
        const pageHit = this.findPageAtMm(mmX, mmY, state);
        const mouseX = pageHit ? pageHit.localX : mmX;
        const mouseY = pageHit ? pageHit.localY : mmY;
        const node = pathEl.nodes[this.activePenNodeIndex];
        const anchorAbsX = pathEl.x + node.x;
        const anchorAbsY = pathEl.y + node.y;
        const dx = mouseX - anchorAbsX;
        const dy = mouseY - anchorAbsY;
        if (Math.hypot(dx, dy) >= 0.5) {
          const newNodes = pathEl.nodes.map((n, idx) => {
            if (idx !== this.activePenNodeIndex) return n;
            return {
              ...n,
              handleOut: { x: dx, y: dy },
              handleIn: { x: -dx, y: -dy },
            };
          });
          const bounds = this.recalculatePathBounds(newNodes);
          stateManager.updateElement(pathEl.id, {
            nodes: newNodes,
            width: bounds.width,
            height: bounds.height,
          });
        }
      }
      this.render();
      return;
    }

    if (this.activeNodeDrag) {
      const dxPx = screenX - this.activeNodeDrag.startDragX;
      const dyPx = screenY - this.activeNodeDrag.startDragY;
      const pxPerMm = MM_TO_PX * state.zoom;
      const deltaMmX = dxPx / pxPerMm;
      const deltaMmY = dyPx / pxPerMm;

      const spread = stateManager.getActiveSpread();
      const pathEl = spread.elements.find(item => item.id === this.activeNodeDrag!.pathId) as VectorPathElement | undefined;
      if (pathEl) {
        const idx = this.activeNodeDrag.nodeIndex;
        const part = this.activeNodeDrag.part;
        const init = this.activeNodeDrag.initialNode;

        const newNodes = pathEl.nodes.map((n, i) => {
          if (i !== idx) return n;
          if (part === 'anchor') {
            return {
              ...n,
              x: init.x + deltaMmX,
              y: init.y + deltaMmY,
            };
          } else if (part === 'handleOut') {
            const newHOut = {
              x: (init.handleOut?.x || 0) + deltaMmX,
              y: (init.handleOut?.y || 0) + deltaMmY,
            };
            const split = e.altKey;
            return {
              ...n,
              handleOut: newHOut,
              handleIn: split ? n.handleIn : { x: -newHOut.x, y: -newHOut.y },
            };
          } else if (part === 'handleIn') {
            const newHIn = {
              x: (init.handleIn?.x || 0) + deltaMmX,
              y: (init.handleIn?.y || 0) + deltaMmY,
            };
            const split = e.altKey;
            return {
              ...n,
              handleIn: newHIn,
              handleOut: split ? n.handleOut : { x: -newHIn.x, y: -newHIn.y },
            };
          }
          return n;
        });

        const bounds = this.recalculatePathBounds(newNodes);
        stateManager.updateElement(pathEl.id, {
          nodes: newNodes,
          width: bounds.width,
          height: bounds.height,
        });
      }
      this.render();
      return;
    }

    if (state.activeTool === 'pen' && this.activePenPathId) {
      this.render();
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
      this.render();
      return;
    }

    if (this.isDragging && this.dragInitialPositions.size > 0) {
      const dxPx = screenX - this.dragStartX;
      const dyPx = screenY - this.dragStartY;
      const pxPerMm = MM_TO_PX * state.zoom;
      const deltaMmX = dxPx / pxPerMm;
      const deltaMmY = dyPx / pxPerMm;

      const updates = this._dragUpdates;
      updates.length = 0;
      this.activeSmartGuides = { lines: [], spacings: [] };

      if (state.snapToGuides && this.dragInitialPositions.size === 1) {
        const spread = stateManager.getActiveSpread();
        const [id, initPos] = Array.from(this.dragInitialPositions.entries())[0];
        if (!initPos.locked) {
          let newX = initPos.x + deltaMmX;
          let newY = initPos.y + deltaMmY;
          const w = initPos.width;
          const h = initPos.height;
          const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === initPos.pageId));
          const pageWidthMm = state.settings.widthMm;
          const pageHeightMm = state.settings.heightMm;
          const snapThresholdMm = 2.0;

          const otherElements = spread.elements.filter((e) => e.id !== id);

          // 1. X-Axis Smart Guides (vertical laser lines)
          let bestSnapDiffX = Infinity;
          let snappedNewX = newX;
          let activeLineX: { posMm: number; minMm: number; maxMm: number } | null = null;

          const testPointsX = [
            { offset: 0, type: 'left' },
            { offset: w / 2, type: 'center' },
            { offset: w, type: 'right' },
          ];

          const targetAnchorsX: { posMm: number; minY: number; maxY: number }[] = [];

          // Page borders & center & margins
          targetAnchorsX.push({ posMm: 0, minY: 0, maxY: pageHeightMm });
          targetAnchorsX.push({ posMm: pageWidthMm / 2, minY: 0, maxY: pageHeightMm });
          targetAnchorsX.push({ posMm: pageWidthMm, minY: 0, maxY: pageHeightMm });
          targetAnchorsX.push({
            posMm: state.settings.margins.insideMm,
            minY: state.settings.margins.topMm,
            maxY: pageHeightMm - state.settings.margins.bottomMm,
          });
          targetAnchorsX.push({
            posMm: pageWidthMm - state.settings.margins.outsideMm,
            minY: state.settings.margins.topMm,
            maxY: pageHeightMm - state.settings.margins.bottomMm,
          });

          // Other elements
          for (const other of otherElements) {
            const oMinY = Math.min(newY, other.y);
            const oMaxY = Math.max(newY + h, other.y + other.height);
            targetAnchorsX.push({ posMm: other.x, minY: oMinY, maxY: oMaxY });
            targetAnchorsX.push({ posMm: other.x + other.width / 2, minY: oMinY, maxY: oMaxY });
            targetAnchorsX.push({ posMm: other.x + other.width, minY: oMinY, maxY: oMaxY });
          }

          for (const tp of testPointsX) {
            const curTestX = newX + tp.offset;
            for (const target of targetAnchorsX) {
              const diff = Math.abs(curTestX - target.posMm);
              if (diff <= snapThresholdMm && diff < bestSnapDiffX) {
                bestSnapDiffX = diff;
                snappedNewX = target.posMm - tp.offset;
                activeLineX = {
                  posMm: target.posMm,
                  minMm: Math.min(target.minY, newY) - 4,
                  maxMm: Math.max(target.maxY, newY + h) + 4,
                };
              }
            }
          }

          if (activeLineX) {
            newX = snappedNewX;
            this.activeSmartGuides.lines.push({
              orientation: 'v',
              posMm: activeLineX.posMm,
              minMm: activeLineX.minMm,
              maxMm: activeLineX.maxMm,
              pageIndex: pageIdx,
            });
          }

          // 2. Y-Axis Smart Guides (horizontal laser lines)
          let bestSnapDiffY = Infinity;
          let snappedNewY = newY;
          let activeLineY: { posMm: number; minMm: number; maxMm: number } | null = null;

          const testPointsY = [
            { offset: 0, type: 'top' },
            { offset: h / 2, type: 'center' },
            { offset: h, type: 'bottom' },
          ];

          const targetAnchorsY: { posMm: number; minX: number; maxX: number }[] = [];

          // Page borders & center & margins
          targetAnchorsY.push({ posMm: 0, minX: 0, maxX: pageWidthMm });
          targetAnchorsY.push({ posMm: pageHeightMm / 2, minX: 0, maxX: pageWidthMm });
          targetAnchorsY.push({ posMm: pageHeightMm, minX: 0, maxX: pageWidthMm });
          targetAnchorsY.push({
            posMm: state.settings.margins.topMm,
            minX: state.settings.margins.insideMm,
            maxX: pageWidthMm - state.settings.margins.outsideMm,
          });
          targetAnchorsY.push({
            posMm: pageHeightMm - state.settings.margins.bottomMm,
            minX: state.settings.margins.insideMm,
            maxX: pageWidthMm - state.settings.margins.outsideMm,
          });

          // Other elements
          for (const other of otherElements) {
            const oMinX = Math.min(newX, other.x);
            const oMaxX = Math.max(newX + w, other.x + other.width);
            targetAnchorsY.push({ posMm: other.y, minX: oMinX, maxX: oMaxX });
            targetAnchorsY.push({ posMm: other.y + other.height / 2, minX: oMinX, maxX: oMaxX });
            targetAnchorsY.push({ posMm: other.y + other.height, minX: oMinX, maxX: oMaxX });
          }

          for (const tp of testPointsY) {
            const curTestY = newY + tp.offset;
            for (const target of targetAnchorsY) {
              const diff = Math.abs(curTestY - target.posMm);
              if (diff <= snapThresholdMm && diff < bestSnapDiffY) {
                bestSnapDiffY = diff;
                snappedNewY = target.posMm - tp.offset;
                activeLineY = {
                  posMm: target.posMm,
                  minMm: Math.min(target.minX, newX) - 4,
                  maxMm: Math.max(target.maxX, newX + w) + 4,
                };
              }
            }
          }

          if (activeLineY) {
            newY = snappedNewY;
            this.activeSmartGuides.lines.push({
              orientation: 'h',
              posMm: activeLineY.posMm,
              minMm: activeLineY.minMm,
              maxMm: activeLineY.maxMm,
              pageIndex: pageIdx,
            });
          }

          // 3. Distance Snapping (Equal Gaps between horizontal neighbors)
          const leftNeighbors = otherElements.filter((e) => (e.x + e.width) <= newX + snapThresholdMm);
          const rightNeighbors = otherElements.filter((e) => e.x >= (newX + w) - snapThresholdMm);

          if (leftNeighbors.length > 0 && rightNeighbors.length > 0) {
            leftNeighbors.sort((a, b) => (b.x + b.width) - (a.x + a.width));
            rightNeighbors.sort((a, b) => a.x - b.x);
            const leftEl = leftNeighbors[0];
            const rightEl = rightNeighbors[0];

            const gap1 = newX - (leftEl.x + leftEl.width);
            const gap2 = rightEl.x - (newX + w);

            if (gap1 > 1 && gap2 > 1 && Math.abs(gap1 - gap2) <= snapThresholdMm) {
              const equalGap = (gap1 + gap2) / 2;
              newX = (leftEl.x + leftEl.width) + equalGap;
              this.activeSmartGuides.spacings.push({
                orientation: 'h',
                startMm: leftEl.x + leftEl.width,
                endMm: newX,
                crossMm: newY + h / 2,
                gapMm: equalGap,
                pageIndex: pageIdx,
              });
              this.activeSmartGuides.spacings.push({
                orientation: 'h',
                startMm: newX + w,
                endMm: rightEl.x,
                crossMm: newY + h / 2,
                gapMm: equalGap,
                pageIndex: pageIdx,
              });
            }
          }

          updates.push({
            id,
            partial: {
              x: Math.round(newX * 10) / 10,
              y: Math.round(newY * 10) / 10,
            },
          });
        }
      } else {
        for (const [id, initPos] of this.dragInitialPositions.entries()) {
          if (initPos.locked) continue;
          updates.push({
            id,
            partial: {
              x: Math.round((initPos.x + deltaMmX) * 10) / 10,
              y: Math.round((initPos.y + deltaMmY) * 10) / 10,
            },
          });
        }
      }

      if (updates.length > 0) {
        stateManager.updateElements(updates);
      }
      this.render();
      return;

      if (updates.length > 0) {
        stateManager.updateElements(updates);
      }
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

      stateManager.updateElement(state.selectedElementId, {
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        width: Math.round(newW * 10) / 10,
        height: Math.round(newH * 10) / 10,
      });
      return;
    }

    if (this.isDrawingNew && this.drawTargetPage) {
      const spread = stateManager.getActiveSpread();
      const { pageWidthMm } = this.getSpreadDimensions(state);
      const pageIdx = Math.max(0, spread.pages.findIndex((p) => p.id === this.drawTargetPage!.id));
      const pageStartMm = pageIdx * pageWidthMm;
      this.drawCurrentMmX = mmX - pageStartMm;
      this.drawCurrentMmY = mmY;
      this.render();
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
    } else if (state.activeTool === 'frame' || state.activeTool === 'table' || state.activeTool === 'pen' || state.activeTool.startsWith('shape')) {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default';
    }

    this.drawRulers();
  }

  private snapCoordinate(val: number, snapPoints: number[], thresholdMm: number = 2): number {
    for (const pt of snapPoints) {
      if (Math.abs(val - pt) <= thresholdMm) {
        return pt;
      }
    }
    return val;
  }

  private handleMouseUp(e: MouseEvent) {
    const state = stateManager.getState();
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = (this.isSpacePanning || state.activeTool === 'hand') ? 'grab' : 'default';
    }
    if (this.isDragging) {
      this.isDragging = false;
      this.dragInitialPositions.clear();
      this.activeSmartGuides = { lines: [], spacings: [] };
      this.render();
    }
    if (this.isResizing) {
      this.isResizing = false;
      this.activeHandle = null;
    }
    if (this.isPenDraggingHandle) {
      this.isPenDraggingHandle = false;
    }
    if (this.activeNodeDrag) {
      this.activeNodeDrag = null;
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
      const targetLocalX = endMmX - pageStartMm;
      const targetLocalY = endMmY;

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
    if (this.activeInlineEditor) {
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

  public openInlineTextEditor(elementId: string): void {
    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find((item) => item.id === elementId);
    if (!el || el.type !== 'text') return;
    const textEl = el as TextElement;

    this.closeInlineTextEditor(true);

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
    textarea.value = textEl.text || '';
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
    const finish = (commit: boolean) => {
      if (isClosed) return;
      isClosed = true;
      const updatedText = textarea.value;
      textarea.remove();
      this.activeInlineEditor = null;
      if (commit && updatedText !== textEl.text) {
        stateManager.updateElement(textEl.id, { text: updatedText });
      }
      this.render();
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

    textarea.addEventListener('blur', () => {
      finish(true);
    });

    const parent = this.canvas.parentElement || this.container;
    parent.appendChild(textarea);

    this.activeInlineEditor = {
      elementId: textEl.id,
      el: textarea,
    };

    textarea.focus();
    textarea.select();
    this.render();
  }

  public closeInlineTextEditor(commit: boolean = true): void {
    if (!this.activeInlineEditor) return;
    const { elementId, el } = this.activeInlineEditor;
    this.activeInlineEditor = null;
    const text = (el as HTMLTextAreaElement | HTMLInputElement).value;
    el.remove();
    if (commit) {
      const spread = stateManager.getActiveSpread();
      const currentEl = spread.elements.find((item) => item.id === elementId);
      if (currentEl && currentEl.type === 'text' && (currentEl as TextElement).text !== text) {
        stateManager.updateElement(elementId, { text });
      }
    }
    this.render();
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
      this.openInlineTextEditor(el.id);
    } else if (el.type === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        if (input.files && input.files[0]) {
          const reader = new FileReader();
          reader.onload = (re) => {
            if (typeof re.target?.result === 'string') {
              stateManager.updateElement(el.id, { src: re.target.result });
            }
          };
          reader.readAsDataURL(input.files[0]);
        }
      };
      input.click();
    } else if (el.type === 'table') {
      this.openInlineTableCellEditor(el.id, e);
    } else if (el.type === 'path') {
      this.openInlineTextOnPathEditor(el.id);
    }
  }

  private handleFileDrop(e: DragEvent) {
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
    const reader = new FileReader();
    reader.onload = (re) => {
      if (typeof re.target?.result !== 'string') return;
      const dataUrl = re.target.result;

      if (hit && hit.type === 'image') {
        stateManager.updateElement(hit.id, { src: dataUrl });
      } else {
        const pageHit = this.findPageAtMm(mmX, mmY, state);
        if (pageHit) {
          stateManager.addElement({
            id: `elem-drop-${Date.now()}`,
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
            src: dataUrl,
            fitMode: 'fill',
            borderColor: '#111111',
            borderWidthMm: 0.3,
          });
        }
      }
    };
    reader.readAsDataURL(file);
  }

  private hitTestElements(spreadMmX: number, spreadMmY: number, state: ProjectState): CanvasElement | null {
    const spread = stateManager.getActiveSpread();
    const { pageWidthMm } = this.getSpreadDimensions(state);
    const layerMap = new Map((state.layers || []).map(l => [l.id, l]));

    const elements = [...spread.elements].sort((a, b) => {
      const layerA = layerMap.get(a.layerId || 'layer-1');
      const layerB = layerMap.get(b.layerId || 'layer-1');
      const orderA = layerA ? layerA.order : 0;
      const orderB = layerB ? layerB.order : 0;
      if (orderA !== orderB) {
        return orderB - orderA;
      }
      return b.zIndex - a.zIndex;
    });

    for (const el of elements) {
      const elLayer = layerMap.get(el.layerId || 'layer-1');
      if (elLayer && (elLayer.visible === false || elLayer.locked === true)) {
        continue;
      }

      const pageIdx = spread.pages.findIndex(p => p.id === el.pageId);
      if (pageIdx === -1) continue;

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
    const spread = stateManager.getActiveSpread();
    if (!spread.masterSpreadId) return null;
    const master = state.masterSpreads?.find((m) => m.id === spread.masterSpreadId);
    if (!master) return null;

    const { pageWidthMm, pageHeightMm } = this.getSpreadDimensions(state);

    for (let i = master.elements.length - 1; i >= 0; i--) {
      const mEl = master.elements[i];
      if (spread.detachedMasterElementIds?.includes(mEl.id)) continue;
      if (spread.elements.some((e) => e.masterSourceId === mEl.id)) continue;

      const masterPage = master.pages.find((p) => p.id === mEl.pageId);
      let targetPage = spread.pages.find((p) => masterPage && p.side === masterPage.side);
      if (!targetPage) targetPage = spread.pages[0];
      if (!targetPage) continue;

      const pageIdx = spread.pages.findIndex((p) => p.id === targetPage!.id);
      if (pageIdx === -1) continue;

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

  private handlePenMouseDown(mmX: number, mmY: number, screenX: number, screenY: number, e: MouseEvent) {
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
          this.activePenNodeIndex = -1;
          this.isPenDraggingHandle = false;
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
        this.activePenNodeIndex = newNodes.length - 1;
        this.isPenDraggingHandle = true;
        this.render();
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
    this.activePenNodeIndex = 0;
    this.isPenDraggingHandle = true;
    this.render();
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
      if (dist <= handleRadius + 2) {
        return h.name;
      }
    }
    return null;
  }

  private updateStaticBuffer(
    state: ProjectState,
    spread: Spread,
    pxPerMm: number,
    numPages: number,
    pageWidthMm: number,
    pageHeightMm: number,
    spreadWidthPx: number,
    spreadHeightPx: number
  ) {
    const grid = state.settings.baselineGrid;
    const key = `${state.activeSpreadIndex}_${state.settings.preset}_${pageWidthMm}_${pageHeightMm}_${state.settings.bleedMm}_${state.zoom}_${state.showGuides}_${state.showBleed}_${state.showBaselineGrid}_${Boolean(state.previewMode)}_${state.settings.margins.insideMm}_${state.settings.margins.outsideMm}_${state.settings.margins.topMm}_${state.settings.margins.bottomMm}_${state.settings.columnCount}_${state.settings.columnGutterMm}_${grid?.incrementPt}_${grid?.startMm}_${grid?.enabled}_${spread.pages.length}`;

    if (this.staticDirtyKey === key && this.staticCanvas.width > 0) {
      return;
    }

    const bleedMm = (!state.previewMode && state.showBleed) ? state.settings.bleedMm : 0;
    const paddingPx = Math.ceil(Math.max(30, bleedMm * pxPerMm + 24));
    const targetW = Math.ceil(spreadWidthPx + paddingPx * 2);
    const targetH = Math.ceil(spreadHeightPx + paddingPx * 2);

    this.staticCanvas.width = targetW;
    this.staticCanvas.height = targetH;
    this.staticBleedPx = paddingPx;

    const sctx = this.staticCtx;
    sctx.clearRect(0, 0, targetW, targetH);

    const originX = paddingPx;
    const originY = paddingPx;

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

      sctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      sctx.shadowBlur = 18;
      sctx.shadowOffsetX = 0;
      sctx.shadowOffsetY = 4;

      sctx.fillStyle = '#ffffff';
      sctx.fillRect(pageX, originY, pageW, spreadHeightPx);

      sctx.shadowColor = 'transparent';
      sctx.shadowBlur = 0;

      sctx.strokeStyle = '#cccccc';
      sctx.lineWidth = 1;
      sctx.strokeRect(pageX, originY, pageW, spreadHeightPx);

      if (!state.previewMode && state.showGuides) {
        const margins = state.settings.margins;
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

        if (state.settings.columnCount > 1) {
          const colCount = state.settings.columnCount;
          const gutterMm = state.settings.columnGutterMm;
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
          const pitchMm = (grid.incrementPt * 25.4) / 72;
          const startMm = grid.startMm ?? margins.topMm;
          const maxMm = pageHeightMm - margins.bottomMm;

          sctx.strokeStyle = '#3a86ff2e';
          sctx.lineWidth = 0.5;

          sctx.beginPath();
          for (let yMm = startMm; yMm <= maxMm; yMm += pitchMm) {
            const yPx = originY + (yMm * pxPerMm);
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

    this.staticDirtyKey = key;
  }

  private getDisplayImage(src: string, quality: DisplayQuality, proxySrc?: string, assetId?: string): HTMLImageElement | HTMLCanvasElement | null {
    if (!src && !proxySrc) return null;
    if (quality === 'fast') return null;

    const effectiveSrc = (quality !== 'high' && proxySrc)
      ? proxySrc
      : (quality !== 'high' && assetId ? assetStore.getScreenProxy(assetId) || src : src);

    if (quality === 'high') {
      let img = this.fullResCache.get(src);
      if (!img) {
        img = new Image();
        img.src = src;
        img.onload = () => this.render();
        this.fullResCache.set(src, img);
      }
      if (img.complete && img.naturalWidth > 0) {
        stateManager.registerImageDimensions(src, img.naturalWidth, img.naturalHeight);
        return img;
      }
      return null;
    }

    const proxy = this.proxyCache.get(effectiveSrc);
    if (proxy) return proxy;

    let img = this.fullResCache.get(effectiveSrc);
    if (!img) {
      img = new Image();
      img.src = effectiveSrc;
      img.onload = () => {
        this.createImageProxy(effectiveSrc, img!);
        this.fullResCache.delete(effectiveSrc);
        this.render();
      };
      this.fullResCache.set(effectiveSrc, img);
      return null;
    }

    if (img.complete && img.naturalWidth > 0) {
      stateManager.registerImageDimensions(src, img.naturalWidth, img.naturalHeight);
      const createdProxy = this.createImageProxy(effectiveSrc, img);
      this.fullResCache.delete(effectiveSrc);
      return createdProxy;
    }
    return null;
  }

  private createImageProxy(src: string, img: HTMLImageElement): HTMLCanvasElement {
    const maxDim = 800;
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
    const origStaticCanvas = this.staticCanvas;
    const origStaticDirtyKey = this.staticDirtyKey;

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
      this.staticCanvas = document.createElement('canvas');
      this.staticDirtyKey = '';

      // Set clean preview mode at 300 DPI with uncompressed assets and zero selection overlays
      state.zoom = exportZoom;
      state.panX = 0;
      state.panY = 0;
      state.previewMode = true;
      state.displayQuality = 'high';
      state.selectedElementId = null;
      state.selectedElementIds = [];

      this.render();

      return offCanvas.toDataURL('image/png');
    } finally {
      this.canvas = origCanvas;
      this.ctx = origCtx;
      this.staticCanvas = origStaticCanvas;
      this.staticDirtyKey = origStaticDirtyKey;

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

  public render() {
    this.overflownTextFrameIds.clear();
    const state = stateManager.getState();
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
    const ctx = this.ctx;

    ctx.fillStyle = state.previewMode ? '#ffffff' : '#1e1e1e';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;
    const spread = stateManager.getActiveSpread();

    this.updateStaticBuffer(
      state,
      spread,
      pxPerMm,
      numPages,
      pageWidthMm,
      pageHeightMm,
      spreadWidthPx,
      spreadHeightPx
    );

    ctx.drawImage(this.staticCanvas, origin.x - this.staticBleedPx, origin.y - this.staticBleedPx);

    // In preview mode, clip all artwork to the pristine page trim rect
    if (state.previewMode) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(origin.x, origin.y, spreadWidthPx, spreadHeightPx);
      ctx.clip();
    }

    const layerMap = new Map((state.layers || []).map(l => [l.id, l]));

    // Render Master Spread Elements (rendered behind regular page elements)
    if (spread.masterSpreadId) {
      const master = state.masterSpreads?.find(m => m.id === spread.masterSpreadId);
      if (master) {
        for (const mEl of master.elements) {
          if (spread.detachedMasterElementIds?.includes(mEl.id)) continue;
          if (spread.elements.some(e => e.masterSourceId === mEl.id)) continue;
          const mLayer = layerMap.get(mEl.layerId || 'layer-1');
          if (mLayer && mLayer.visible === false) continue;

          const masterPage = master.pages.find(p => p.id === mEl.pageId);
          let targetPage = spread.pages.find(p => masterPage && p.side === masterPage.side);
          if (!targetPage) targetPage = spread.pages[0];
          if (!targetPage) continue;

          const pageIdx = spread.pages.findIndex(p => p.id === targetPage!.id);
          const pageStartMm = pageIdx * pageWidthMm;
          let masterY = mEl.y;
          if (masterY + (mEl.height || 0) > pageHeightMm - 2) {
            masterY = Math.max(0, pageHeightMm - (state.settings.margins.bottomMm || 15) + 2);
          }
          const elScreenX = origin.x + ((pageStartMm + mEl.x) * pxPerMm);
          const elScreenY = origin.y + (masterY * pxPerMm);
          const elScreenW = mEl.width * pxPerMm;
          const elScreenH = mEl.height * pxPerMm;

          ctx.save();
          ctx.globalAlpha = mEl.opacity * 0.9;

          if (mEl.type === 'shape') {
            const shape = mEl as ShapeElement;
            ctx.fillStyle = shape.fillColor || '#ffffff';
            ctx.strokeStyle = shape.strokeColor || '#000000';
            ctx.lineWidth = (shape.strokeWidthMm || 0.3) * pxPerMm;
            if (shape.shapeKind === 'line') {
              ctx.beginPath();
              ctx.moveTo(elScreenX, elScreenY);
              ctx.lineTo(elScreenX + elScreenW, elScreenY + elScreenH);
              ctx.stroke();
            } else if (shape.shapeKind === 'rectangle') {
              if (shape.fillColor && shape.fillColor !== 'transparent') ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH);
              if (shape.strokeWidthMm > 0) ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);
            }
          } else if (mEl.type === 'text') {
            const textEl = mEl as TextElement;
            const evalText = stateManager.evaluateTokens(textEl.text, targetPage.pageNumber);
            const fontSizePx = (textEl.fontSizePt * (96 / 72)) * state.zoom;
            ctx.fillStyle = textEl.color || '#666666';
            ctx.font = `${fontSizePx}px ${textEl.fontFamily || 'sans-serif'}`;
            ctx.textBaseline = 'top';
            if (textEl.alignment === 'right') {
              ctx.textAlign = 'right';
              ctx.fillText(evalText, elScreenX + elScreenW, elScreenY);
            } else if (textEl.alignment === 'center') {
              ctx.textAlign = 'center';
              ctx.fillText(evalText, elScreenX + elScreenW / 2, elScreenY);
            } else {
              ctx.textAlign = 'left';
              ctx.fillText(evalText, elScreenX, elScreenY);
            }
          }
          ctx.restore();
        }
      }
    }

    const visibleElements = spread.elements.filter(el => {
      const elLayer = layerMap.get(el.layerId || 'layer-1');
      return !elLayer || elLayer.visible !== false;
    });
    const sortedElements = [...visibleElements].sort((a, b) => {
      const layerA = layerMap.get(a.layerId || 'layer-1');
      const layerB = layerMap.get(b.layerId || 'layer-1');
      const orderA = layerA ? layerA.order : 0;
      const orderB = layerB ? layerB.order : 0;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.zIndex - b.zIndex;
    });
    for (const el of sortedElements) {
      const pageIdx = spread.pages.findIndex(p => p.id === el.pageId);
      if (pageIdx === -1) continue;

      const pageStartMm = pageIdx * pageWidthMm;
      const elScreenX = origin.x + ((pageStartMm + el.x) * pxPerMm);
      const elScreenY = origin.y + (el.y * pxPerMm);
      const elScreenW = el.width * pxPerMm;
      const elScreenH = el.height * pxPerMm;
      const isSelected = state.selectedElementIds ? state.selectedElementIds.includes(el.id) : state.selectedElementId === el.id;

      ctx.save();
      ctx.globalAlpha = el.opacity;

      if (el.shadow && el.shadow.color) {
        ctx.shadowColor = el.shadow.color;
        ctx.shadowBlur = (el.shadow.blurMm || 3) * pxPerMm;
        ctx.shadowOffsetX = (el.shadow.offsetX || 2) * pxPerMm;
        ctx.shadowOffsetY = (el.shadow.offsetY || 2) * pxPerMm;
      }

      if (el.type === 'shape') {
        const shape = el as ShapeElement;
        ctx.fillStyle = shape.fillColor || '#ffffff';
        ctx.strokeStyle = shape.strokeColor || '#000000';
        ctx.lineWidth = (shape.strokeWidthMm || 0.3) * pxPerMm;

        if (shape.strokeDash === 'dashed') {
          ctx.setLineDash([6, 4]);
        }

        if (shape.shapeKind === 'rectangle') {
          if (shape.fillColor && shape.fillColor !== 'transparent') ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH);
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
          if (shape.fillColor && shape.fillColor !== 'transparent') ctx.fill();
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
          ctx.fillStyle = '#f8f8f8';
          ctx.fillRect(elScreenX, elScreenY, elScreenW, elScreenH);

          if (img.src || img.proxySrc) {
            const displayBitmap = this.getDisplayImage(img.src, quality, img.proxySrc, img.assetId);
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
                img.fitMode || 'fill'
              );

              ctx.save();
              ctx.beginPath();
              ctx.rect(elScreenX, elScreenY, elScreenW, elScreenH);
              ctx.clip();
              ctx.drawImage(displayBitmap, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
              ctx.restore();
            } else {
              ctx.fillStyle = '#888888';
              ctx.font = `${Math.max(10, 11 * state.zoom)}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('Loading display proxy...', elScreenX + elScreenW / 2, elScreenY + elScreenH / 2);
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
            ctx.fillText(img.caption || 'Image Frame (Drop photo here)', elScreenX + elScreenW / 2, elScreenY + elScreenH / 2);
          }
        }

        if (img.borderWidthMm > 0) {
          ctx.strokeStyle = img.borderColor || '#333333';
          ctx.lineWidth = img.borderWidthMm * pxPerMm;
          ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);
        }
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        this.renderVectorPath(ctx, pathEl, origin, pageStartMm, pxPerMm, isSelected, this.activePenPathId);
      } else if (el.type === 'table') {
        const table = el as TableElement;
        tableEngine.renderCanvasTable(ctx, table, elScreenX, elScreenY, elScreenW, elScreenH, pxPerMm, state.zoom, [table]);
      } else if (el.type === 'text') {
        const text = el as TextElement;
        if (this.activeInlineEditor && this.activeInlineEditor.elementId === el.id) {
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

        const pStyle = text.paragraphStyleId ? state.paragraphStyles.find(s => s.id === text.paragraphStyleId) : undefined;
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

        if (text.letterSpacingPt && (ctx as any).letterSpacing !== undefined) {
          (ctx as any).letterSpacing = `${(text.letterSpacingPt * (96 / 72) * state.zoom).toFixed(2)}px`;
        } else if ((ctx as any).letterSpacing !== undefined) {
          (ctx as any).letterSpacing = '0px';
        }

        if (text.openTypeFeatures?.smallCaps && (ctx as any).fontVariantCaps !== undefined) {
          (ctx as any).fontVariantCaps = 'all-small-caps';
        } else if ((ctx as any).fontVariantCaps !== undefined) {
          (ctx as any).fontVariantCaps = 'normal';
        }

        // Baseline Grid snapping parameters
        const grid = state.settings.baselineGrid;
        const useBaselineGrid = Boolean(text.snapToBaseline && grid?.enabled);
        const pitchMm = grid?.incrementPt ? (grid.incrementPt * 25.4) / 72 : 4.2333;
        const pitchPx = pitchMm * pxPerMm;
        const startMm = grid?.startMm ?? state.settings.margins.topMm;
        const gridStartY = origin.y + (startMm * pxPerMm);

        const obstacles = spread.elements.filter(
          (other) =>
            other.id !== text.id &&
            other.pageId === text.pageId &&
            Boolean(other.textWrap && other.textWrap.mode && other.textWrap.mode !== 'none')
        );

        const footnotes = stateManager.getFootnotesForElement(text.id);
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
        const totalFootnoteHeightPx = footnotes.length > 0
          ? fnRuleGapPx + (footnotes.length * fnLineSpacingPx) + (4 * state.zoom)
          : 0;

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

        if (obstacles.length > 0) {
          const paragraphs = processedText.split('\n');
          let pIdx = 0;
          let wordList: string[] = paragraphs[0] ? paragraphs[0].trim().split(/\s+/).filter(Boolean) : [];

          for (let c = 0; c < colCount; c++) {
            const colX = elScreenX + paddingPx + (c * (singleColWidthPx + colGutterPx));
            let currentY = elScreenY + paddingPx;

            if (useBaselineGrid) {
              if (currentY < gridStartY) {
                currentY = gridStartY;
              } else {
                const k = Math.ceil((currentY - gridStartY) / pitchPx);
                currentY = gridStartY + (k * pitchPx);
              }
            }

            while (currentY + fontSizePx <= bottomLimit && (pIdx < paragraphs.length || wordList.length > 0)) {
              if (wordList.length === 0) {
                pIdx++;
                if (pIdx >= paragraphs.length) break;
                const nextPara = paragraphs[pIdx].trim();
                if (!nextPara) {
                  if (useBaselineGrid) {
                    const nextTentative = currentY + Math.max(lineSpacingPx, pitchPx * 0.8);
                    const k = Math.ceil((nextTentative - gridStartY) / pitchPx);
                    currentY = gridStartY + (k * pitchPx);
                  } else {
                    currentY += lineSpacingPx;
                  }
                  continue;
                }
                wordList = nextPara.split(/\s+/).filter(Boolean);
              }

              let lineIndent = 0;
              let lineAvailW = singleColWidthPx;
              let isLineBlocked = false;

              for (const obs of obstacles) {
                const obsStandoffPx = (obs.textWrap?.standoffMm || 0) * pxPerMm;
                const obsMinX = origin.x + ((pageStartMm + obs.x) * pxPerMm) - obsStandoffPx;
                const obsMaxX = origin.x + ((pageStartMm + obs.x + obs.width) * pxPerMm) + obsStandoffPx;
                const obsMinY = origin.y + (obs.y * pxPerMm) - obsStandoffPx;
                const obsMaxY = origin.y + ((obs.y + obs.height) * pxPerMm) + obsStandoffPx;

                if (currentY + fontSizePx > obsMinY && currentY < obsMaxY) {
                  let obsL = obsMinX;
                  let obsR = obsMaxX;

                  if (obs.textWrap?.mode === 'contour' && obs.type === 'shape' && (obs as ShapeElement).shapeKind === 'ellipse') {
                    const midY = currentY + fontSizePx / 2;
                    const cy = (obsMinY + obsMaxY) / 2;
                    const ry = (obsMaxY - obsMinY) / 2;
                    if (Math.abs(midY - cy) < ry && ry > 0) {
                      const rx = (obsMaxX - obsMinX) / 2;
                      const dx = rx * Math.sqrt(Math.max(0, 1 - Math.pow((midY - cy) / ry, 2)));
                      const cx = (obsMinX + obsMaxX) / 2;
                      obsL = cx - dx;
                      obsR = cx + dx;
                    } else {
                      continue;
                    }
                  }

                  const colLeft = colX;
                  const colRight = colX + singleColWidthPx;
                  const overlapL = Math.max(colLeft, obsL);
                  const overlapR = Math.min(colRight, obsR);

                  if (overlapL < overlapR) {
                    const spaceLeft = Math.max(0, obsL - colLeft);
                    const spaceRight = Math.max(0, colRight - obsR);

                    if (spaceLeft < 20 && spaceRight < 20) {
                      isLineBlocked = true;
                      break;
                    } else if (spaceLeft >= spaceRight && spaceLeft >= 20) {
                      lineAvailW = Math.min(lineAvailW, spaceLeft);
                    } else {
                      lineIndent = Math.max(lineIndent, obsR - colLeft);
                      lineAvailW = Math.min(lineAvailW, colRight - (colLeft + lineIndent));
                    }
                  }
                }
              }

              if (isLineBlocked || lineAvailW < 20) {
                if (useBaselineGrid) {
                  const nextTentative = currentY + Math.max(lineSpacingPx, pitchPx * 0.8);
                  const k = Math.ceil((nextTentative - gridStartY) / pitchPx);
                  currentY = gridStartY + (k * pitchPx);
                } else {
                  currentY += lineSpacingPx;
                }
                continue;
              }

              const lineWords: string[] = [];
              while (wordList.length > 0) {
                const nextWord = wordList[0];
                const testText = lineWords.length === 0 ? nextWord : lineWords.join(' ') + ' ' + nextWord;
                const testWidth = ctx.measureText(testText).width;
                const trailingHang = getTrailingHangOffset(testText, ctx, Boolean(text.opticalMarginAlignment));
                if (testWidth - trailingHang <= lineAvailW) {
                  lineWords.push(wordList.shift()!);
                } else {
                  if (lineWords.length === 0) {
                    const chunks = splitWordIntoFitChunks(nextWord, lineAvailW, ctx);
                    if (chunks.length > 1) {
                      lineWords.push(chunks[0]);
                      wordList[0] = chunks.slice(1).join('');
                    } else {
                      lineWords.push(wordList.shift()!);
                    }
                  }
                  break;
                }
              }

              const isParaEnd = wordList.length === 0;
              const lineStr = lineWords.join(' ');

              if (lineStr) {
                const hangL = getLeadingHangOffset(lineStr, ctx, Boolean(text.opticalMarginAlignment));
                const hangR = getTrailingHangOffset(lineStr, ctx, Boolean(text.opticalMarginAlignment));

                if (text.alignment === 'center') {
                  ctx.textAlign = 'center';
                  ctx.fillText(lineStr, colX + lineIndent + (lineAvailW - hangL + hangR) / 2, currentY);
                } else if (text.alignment === 'right') {
                  ctx.textAlign = 'right';
                  ctx.fillText(lineStr, colX + lineIndent + lineAvailW + hangR, currentY);
                } else if (text.alignment === 'justify' && !isParaEnd && lineWords.length > 1) {
                  let totalWordsW = 0;
                  const wWidths: number[] = [];
                  for (const w of lineWords) {
                    const wW = ctx.measureText(w).width;
                    wWidths.push(wW);
                    totalWordsW += wW;
                  }
                  const totalTargetW = lineAvailW + hangL + hangR;
                  const excess = totalTargetW - totalWordsW;
                  const gap = Math.max(0, excess / (lineWords.length - 1));
                  let curWordX = colX + lineIndent - hangL;
                  ctx.textAlign = 'left';
                  for (let w = 0; w < lineWords.length; w++) {
                    ctx.fillText(lineWords[w], curWordX, currentY);
                    curWordX += wWidths[w] + gap;
                  }
                } else {
                  ctx.textAlign = 'left';
                  ctx.fillText(lineStr, colX + lineIndent - hangL, currentY);
                }
              }

              if (useBaselineGrid) {
                const nextTentative = currentY + Math.max(lineSpacingPx, pitchPx * 0.8);
                const k = Math.ceil((nextTentative - gridStartY) / pitchPx);
                currentY = gridStartY + (k * pitchPx);
              } else {
                currentY += lineSpacingPx;
              }
            }
          }

          if (pIdx < paragraphs.length || wordList.length > 0) {
            isOverflowing = true;
          }
        } else {
          interface FormattedLine {
            text: string;
            isLastInPara: boolean;
            indentX: number;
            availWidth: number;
          }

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
            let currentY = elScreenY + paddingPx;
            const targetColLines = isBalanced
              ? (c < extraLines ? baseLinesPerCol + 1 : baseLinesPerCol)
              : Infinity;
            let linesInCol = 0;

            if (useBaselineGrid) {
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
                  ctx.textAlign = 'center';
                  ctx.fillText(line.text, colX + line.indentX + (line.availWidth - hangL + hangR) / 2, currentY);
                } else if (text.alignment === 'right') {
                  ctx.textAlign = 'right';
                  ctx.fillText(line.text, colX + line.indentX + line.availWidth + hangR, currentY);
                } else if (text.alignment === 'justify' && !line.isLastInPara) {
                  const words = line.text.trim().split(/\s+/);
                  if (words.length <= 1) {
                    ctx.textAlign = 'left';
                    ctx.fillText(line.text, colX + line.indentX - hangL, currentY);
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
                      ctx.fillText(words[w], curWordX, currentY);
                      curWordX += wWidths[w] + gap;
                    }
                  }
                } else {
                  ctx.textAlign = 'left';
                  ctx.fillText(line.text, colX + line.indentX - hangL, currentY);
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

        if (footnotes.length > 0) {
          const fnStartY = elScreenY + elScreenH - paddingPx - totalFootnoteHeightPx + fnRuleGapPx;
          const ruleThicknessPx = (fnSettings.separatorRuleThicknessPt || 0.5) * (96 / 72) * state.zoom;
          const maxRuleW = (fnSettings.separatorRuleWidthMm || 30) * pxPerMm;
          const ruleW = Math.min(availWidthPx * 0.45, maxRuleW);

          ctx.save();
          // Separator rule
          ctx.strokeStyle = '#888888';
          ctx.lineWidth = Math.max(0.5, ruleThicknessPx);
          ctx.beginPath();
          ctx.moveTo(elScreenX + paddingPx, fnStartY);
          ctx.lineTo(elScreenX + paddingPx + ruleW, fnStartY);
          ctx.stroke();

          // Footnote lines
          ctx.fillStyle = text.color || '#222222';
          ctx.font = `${fnFontSizePx}px ${fnSettings.fontFamily || text.fontFamily || 'serif'}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';

          footnotes.forEach((fn, idx) => {
            const lineY = fnStartY + (3 * state.zoom) + (idx * fnLineSpacingPx);
            const marker = numberToSuperscript(fn.number);
            const lineText = `${marker} ${fn.text}`;
            ctx.fillText(lineText, elScreenX + paddingPx, lineY);
          });
          ctx.restore();
        }

        ctx.restore();

        if (isOverflowing) {
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

    // Render Thread Vectors for linked frames
    for (const el of spread.elements) {
      if (el.type === 'text') {
        const textEl = el as TextElement;
        const isSelected = state.selectedElementIds ? state.selectedElementIds.includes(textEl.id) : state.selectedElementId === textEl.id;
        if ((isSelected || state.linkingFromFrameId === textEl.id) && textEl.nextFrameId) {
          const pageIdxA = spread.pages.findIndex(p => p.id === textEl.pageId);
          const fromPageStart = (pageIdxA !== -1 ? pageIdxA : 0) * pageWidthMm;
          const fromX = origin.x + ((fromPageStart + textEl.x + textEl.width) * pxPerMm) - 7;
          const fromY = origin.y + ((textEl.y + textEl.height) * pxPerMm) - 7;

          const targetEl = spread.elements.find(e => e.id === textEl.nextFrameId);
          if (targetEl && targetEl.type === 'text') {
            const pageIdxB = spread.pages.findIndex(p => p.id === targetEl.pageId);
            const toPageStart = (pageIdxB !== -1 ? pageIdxB : 0) * pageWidthMm;
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
            const otherSpread = state.spreads.find(s => s.elements.some(e => e.id === textEl.nextFrameId));
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
        if (typeof (ctx as any).roundRect === 'function') {
          ctx.beginPath();
          (ctx as any).roundRect(peerScreenX + 12, peerScreenY + 12, badgeWidth, 18, 4);
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

    this.drawSlugBanner(ctx, origin, pxPerMm, state);
    this.drawReadingOrderOverlay(ctx, origin, pxPerMm, state);
    this.drawCommentPins(ctx, origin, pxPerMm, state);
    this.drawMeasureTool(ctx, origin, pxPerMm, state);

    this.drawRulers();
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
      `RECTO PREPRESS SLUG | Doc: ${title} | Spread ${spreadNum} | Bleed: ${bleed} | PDF/X-1a CMYK`,
      `Doc: ${title} | Spread ${spreadNum} | Bleed: ${bleed} | PDF/X-1a`,
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
    const comments = state.comments.filter(c => c.spreadIndex === state.activeSpreadIndex);

    ctx.save();
    for (const c of comments) {
      const px = origin.x + c.x * pxPerMm;
      const py = origin.y + c.y * pxPerMm;

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

    if (typeof (ctx as any).roundRect === 'function') {
      ctx.beginPath();
      (ctx as any).roundRect(bx, by, pillW, pillH, 5);
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

      if (typeof (ctx as any).roundRect === 'function') {
        ctx.beginPath();
        (ctx as any).roundRect(badgeX, badgeY, badgeW, badgeH, 3);
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

  private drawRulers() {
    const state = stateManager.getState();
    const origin = this.getSpreadScreenOrigin(state);
    const pxPerMm = MM_TO_PX * state.zoom;

    const ctxT = this.ctxTop;
    const wT = this.rulerTop.getBoundingClientRect().width;
    ctxT.fillStyle = '#2d2d2d';
    ctxT.fillRect(0, 0, wT, 24);

    ctxT.strokeStyle = '#555555';
    ctxT.fillStyle = '#aaaaaa';
    ctxT.font = '9px Inter, sans-serif';
    ctxT.textAlign = 'left';
    ctxT.lineWidth = 1;

    const startMmX = Math.floor(-origin.x / pxPerMm);
    const endMmX = Math.ceil((wT - origin.x) / pxPerMm);

    for (let mm = startMmX; mm <= endMmX; mm++) {
      const screenX = origin.x + (mm * pxPerMm);
      if (mm % 50 === 0) {
        ctxT.beginPath();
        ctxT.moveTo(screenX, 10);
        ctxT.lineTo(screenX, 24);
        ctxT.stroke();
        ctxT.fillText(`${mm}`, screenX + 2, 9);
      } else if (mm % 10 === 0) {
        ctxT.beginPath();
        ctxT.moveTo(screenX, 16);
        ctxT.lineTo(screenX, 24);
        ctxT.stroke();
      }
    }

    const cursorTopX = origin.x + (this.mouseMmX * pxPerMm);
    ctxT.strokeStyle = '#0d99ff';
    ctxT.beginPath();
    ctxT.moveTo(cursorTopX, 0);
    ctxT.lineTo(cursorTopX, 24);
    ctxT.stroke();

    const ctxL = this.ctxLeft;
    const hL = this.rulerLeft.getBoundingClientRect().height;
    ctxL.fillStyle = '#2d2d2d';
    ctxL.fillRect(0, 0, 24, hL);

    ctxL.strokeStyle = '#555555';
    ctxL.fillStyle = '#aaaaaa';
    ctxL.font = '9px Inter, sans-serif';
    ctxL.textAlign = 'right';
    ctxL.lineWidth = 1;

    const startMmY = Math.floor(-origin.y / pxPerMm);
    const endMmY = Math.ceil((hL - origin.y) / pxPerMm);

    for (let mm = startMmY; mm <= endMmY; mm++) {
      const screenY = origin.y + (mm * pxPerMm);
      if (mm % 50 === 0) {
        ctxL.beginPath();
        ctxL.moveTo(10, screenY);
        ctxL.lineTo(24, screenY);
        ctxL.stroke();
        ctxL.save();
        ctxL.translate(9, screenY - 2);
        ctxL.rotate(-Math.PI / 2);
        ctxL.fillText(`${mm}`, 0, 0);
        ctxL.restore();
      } else if (mm % 10 === 0) {
        ctxL.beginPath();
        ctxL.moveTo(16, screenY);
        ctxL.lineTo(24, screenY);
        ctxL.stroke();
      }
    }

    const cursorLeftY = origin.y + (this.mouseMmY * pxPerMm);
    ctxL.strokeStyle = '#0d99ff';
    ctxL.beginPath();
    ctxL.moveTo(0, cursorLeftY);
    ctxL.lineTo(24, cursorLeftY);
    ctxL.stroke();
  }

  private renderVectorPath(
    ctx: CanvasRenderingContext2D,
    el: VectorPathElement,
    origin: { x: number; y: number },
    pageStartMm: number,
    pxPerMm: number,
    isSelected: boolean,
    activePathId: string | null
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
    if (el.fillColor && el.fillColor !== 'transparent') {
      ctx.fillStyle = el.fillColor;
      ctx.fill();
    }

    // Stroke
    if (el.strokeWidthMm > 0 && el.strokeColor !== 'transparent') {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = Math.max(0.5, el.strokeWidthMm * pxPerMm);
      ctx.lineCap = el.strokeCap || 'round';
      ctx.lineJoin = el.strokeJoin || 'round';
      if (el.strokeDash === 'dashed') {
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
