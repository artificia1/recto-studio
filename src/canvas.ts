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
  private isDrawingNew: boolean = false;
  private isMarquee: boolean = false;
  private activeHandle: string | null = null;

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
  private dragInitialPositions: Map<string, { x: number; y: number; locked: boolean }> = new Map();

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
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = stateManager.getState();
        if (state.selectedElementIds && state.selectedElementIds.length > 0) {
          stateManager.deleteSelectedElements();
        } else if (state.selectedElementId) {
          stateManager.deleteElement(state.selectedElementId);
        }
      } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        stateManager.toggleLock();
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        stateManager.applyImageFitMode('fill');
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        stateManager.applyImageFitMode('fit');
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        stateManager.applyImageFitMode('frameToContent');
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        stateManager.applyImageFitMode('contentToFrame');
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        stateManager.applyImageFitMode('center');
      } else if (e.key === 'v' || e.key === 'V') {
        stateManager.setTool('select');
      } else if (e.key === 't' || e.key === 'T') {
        stateManager.setTool('text');
      } else if (e.key === 'p' || e.key === 'P') {
        stateManager.setTool('pen');
      } else if (e.key === 'b' || e.key === 'B') {
        stateManager.setTool('table');
      } else if (e.key === 'Escape' || e.key === 'Enter') {
        if (this.activePenPathId) {
          this.activePenPathId = null;
          this.activePenNodeIndex = -1;
          this.isPenDraggingHandle = false;
          stateManager.setTool('select');
          this.render();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        stateManager.setTool('frame');
      } else if (e.key === 'm' || e.key === 'M') {
        stateManager.setTool('shape-rect');
      } else if (e.key === 'h' || e.key === 'H') {
        stateManager.setTool('hand');
      } else if (e.key === 'w' || e.key === 'W') {
        stateManager.toggleGuides();
      } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) stateManager.redo();
        else stateManager.undo();
      } else if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        stateManager.redo();
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

    const centerX = rect.width / 2 + state.panX;
    const centerY = rect.height / 2 + state.panY;

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

    if (e.button === 1 || state.activeTool === 'hand' || (e as any).spaceKey) {
      this.isPanning = true;
      this.panStartX = e.clientX - state.panX;
      this.panStartY = e.clientY - state.panY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const { x: mmX, y: mmY } = this.screenToSpreadMm(screenX, screenY, state);

    if (state.activeTool !== 'select') {
      if (state.activeTool === 'pen') {
        this.handlePenMouseDown(mmX, mmY, screenX, screenY, e);
        return;
      }
      const pageHit = this.findPageAtMm(mmX, mmY, state);
      if (pageHit) {
        this.isDrawingNew = true;
        this.drawStartMmX = pageHit.localX;
        this.drawStartMmY = pageHit.localY;
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
    const spread = stateManager.getActiveSpread();
    const ids = state.selectedElementIds && state.selectedElementIds.length > 0
      ? state.selectedElementIds
      : (state.selectedElementId ? [state.selectedElementId] : []);

    for (const id of ids) {
      const el = spread.elements.find(item => item.id === id);
      if (el) {
        const elLayer = state.layers?.find(l => l.id === (el.layerId || 'layer-1'));
        const isLocked = !!el.locked || Boolean(elLayer?.locked);
        this.dragInitialPositions.set(id, { x: el.x, y: el.y, locked: isLocked });
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
      for (const [id, initPos] of this.dragInitialPositions.entries()) {
        if (initPos.locked) continue;
        let newX = initPos.x + deltaMmX;
        let newY = initPos.y + deltaMmY;

        if (state.snapToGuides && this.dragInitialPositions.size === 1) {
          newX = this.snapCoordinate(newX, [
            state.settings.margins.insideMm,
            state.settings.margins.outsideMm,
            0,
            state.settings.widthMm,
          ]);
          newY = this.snapCoordinate(newY, [
            state.settings.margins.topMm,
            state.settings.margins.bottomMm,
            0,
            state.settings.heightMm,
          ]);
        }

        updates.push({
          id,
          partial: {
            x: Math.round(newX * 10) / 10,
            y: Math.round(newY * 10) / 10,
          },
        });
      }

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
      this.render();
      return;
    }

    if (state.activeTool === 'select' && state.selectedElementIds && state.selectedElementIds.length === 1) {
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
      this.canvas.style.cursor = state.activeTool === 'hand' ? 'grab' : 'default';
    }
    if (this.isDragging) {
      this.isDragging = false;
      this.dragInitialPositions.clear();
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
      const pageHit = this.findPageAtMm(endMmX, endMmY, state);

      let w = Math.abs((pageHit ? pageHit.localX : endMmX) - this.drawStartMmX);
      let h = Math.abs((pageHit ? pageHit.localY : endMmY) - this.drawStartMmY);

      if (w < 10) w = 60;
      if (h < 10) h = 40;

      const x = Math.min(this.drawStartMmX, (pageHit ? pageHit.localX : endMmX));
      const y = Math.min(this.drawStartMmY, (pageHit ? pageHit.localY : endMmY));

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

    const pageIdx = spread.pages.findIndex((p) => p.id === textEl.pageId);
    if (pageIdx === -1) return;

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
    if (!state.selectedElementId) return;

    const spread = stateManager.getActiveSpread();
    const el = spread.elements.find((item) => item.id === state.selectedElementId);
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
    if (el.locked || Boolean(elLayer?.locked) || elLayer?.visible === false) return null;

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
    if (el.locked || Boolean(elLayer?.locked) || elLayer?.visible === false) return null;

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
    const key = `${state.activeSpreadIndex}_${state.settings.preset}_${pageWidthMm}_${pageHeightMm}_${state.settings.bleedMm}_${state.zoom}_${state.showGuides}_${state.showBleed}_${state.showBaselineGrid}_${state.settings.margins.insideMm}_${state.settings.margins.outsideMm}_${state.settings.margins.topMm}_${state.settings.margins.bottomMm}_${state.settings.columnCount}_${state.settings.columnGutterMm}_${grid?.incrementPt}_${grid?.startMm}_${grid?.enabled}_${spread.pages.length}`;

    if (this.staticDirtyKey === key && this.staticCanvas.width > 0) {
      return;
    }

    const bleedMm = state.showBleed ? state.settings.bleedMm : 0;
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
    if (state.showBleed && state.settings.bleedMm > 0) {
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

      if (state.showGuides) {
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

  private getDisplayImage(src: string, quality: DisplayQuality): HTMLImageElement | HTMLCanvasElement | null {
    if (!src) return null;
    if (quality === 'fast') return null;

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

    const proxy = this.proxyCache.get(src);
    if (proxy) return proxy;

    let img = this.fullResCache.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      img.onload = () => {
        this.createImageProxy(src, img!);
        this.render();
      };
      this.fullResCache.set(src, img);
      return null;
    }

    if (img.complete && img.naturalWidth > 0) {
      stateManager.registerImageDimensions(src, img.naturalWidth, img.naturalHeight);
      return this.createImageProxy(src, img);
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

  public render() {
    const state = stateManager.getState();
    const rect = this.canvas.getBoundingClientRect();
    const ctx = this.ctx;

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const {
      numPages,
      pageWidthMm,
      pageHeightMm,
      spreadWidthPx,
      spreadHeightPx,
    } = this.getSpreadDimensions(state);

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

    const layerMap = new Map((state.layers || []).map(l => [l.id, l]));

    // Render Master Spread Elements (rendered behind regular page elements)
    if (spread.masterSpreadId) {
      const master = state.masterSpreads?.find(m => m.id === spread.masterSpreadId);
      if (master) {
        for (const mEl of master.elements) {
          const mLayer = layerMap.get(mEl.layerId || 'layer-1');
          if (mLayer && mLayer.visible === false) continue;

          const masterPage = master.pages.find(p => p.id === mEl.pageId);
          let targetPage = spread.pages.find(p => masterPage && p.side === masterPage.side);
          if (!targetPage) targetPage = spread.pages[0];
          if (!targetPage) continue;

          const pageIdx = spread.pages.findIndex(p => p.id === targetPage!.id);
          const pageStartMm = pageIdx * pageWidthMm;
          const elScreenX = origin.x + ((pageStartMm + mEl.x) * pxPerMm);
          const elScreenY = origin.y + (mEl.y * pxPerMm);
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

          if (img.src) {
            const displayBitmap = this.getDisplayImage(img.src, quality);
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
        const rows = Math.max(1, table.rows || 1);
        const cols = Math.max(1, table.cols || 1);
        const cellW = elScreenW / cols;
        const cellH = elScreenH / rows;
        const paddingPx = (table.cellPaddingMm || 1.5) * pxPerMm;
        const fontSizePx = (table.fontSizePt * (96 / 72)) * state.zoom;
        const borderColor = table.borderColor || '#333333';
        const borderWidthPx = (table.borderWidthMm || 0.3) * pxPerMm;

        // Render cell backgrounds
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cellX = elScreenX + (c * cellW);
            const cellY = elScreenY + (r * cellH);
            const cell = table.cells?.[r]?.[c];

            let cellBg = cell?.fillColor;
            if (!cellBg) {
              if (r < (table.headerRowCount || 0)) {
                cellBg = table.headerFillColor || '#242424';
              } else if (table.alternateRowColor && r % 2 === 1) {
                cellBg = table.alternateRowColor;
              } else {
                cellBg = '#ffffff';
              }
            }

            if (cellBg && cellBg !== 'transparent') {
              ctx.fillStyle = cellBg;
              ctx.fillRect(cellX, cellY, cellW, cellH);
            }
          }
        }

        // Render grid lines
        if (borderWidthPx > 0) {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = borderWidthPx;
          ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);

          for (let r = 1; r < rows; r++) {
            const y = elScreenY + (r * cellH);
            ctx.beginPath();
            ctx.moveTo(elScreenX, y);
            ctx.lineTo(elScreenX + elScreenW, y);
            ctx.stroke();
          }

          for (let c = 1; c < cols; c++) {
            const x = elScreenX + (c * cellW);
            ctx.beginPath();
            ctx.moveTo(x, elScreenY);
            ctx.lineTo(x, elScreenY + elScreenH);
            ctx.stroke();
          }
        }

        // Render cell text content
        ctx.font = `${fontSizePx}px ${table.fontFamily || 'Inter, sans-serif'}`;
        for (let r = 0; r < rows; r++) {
          const isHeader = r < (table.headerRowCount || 0);
          for (let c = 0; c < cols; c++) {
            const cellX = elScreenX + (c * cellW);
            const cellY = elScreenY + (r * cellH);
            const cell = table.cells?.[r]?.[c];
            const textStr = cell?.text || '';

            if (textStr) {
              ctx.save();
              ctx.beginPath();
              ctx.rect(cellX + paddingPx, cellY + paddingPx, Math.max(1, cellW - (paddingPx * 2)), Math.max(1, cellH - (paddingPx * 2)));
              ctx.clip();

              const textColor = cell?.textColor || (isHeader ? (table.headerTextColor || '#ffffff') : '#111111');
              ctx.fillStyle = textColor;
              ctx.textBaseline = 'middle';

              const align = cell?.align || (isHeader ? 'center' : 'left');
              let tx = cellX + paddingPx;
              if (align === 'center') {
                ctx.textAlign = 'center';
                tx = cellX + cellW / 2;
              } else if (align === 'right') {
                ctx.textAlign = 'right';
                tx = cellX + cellW - paddingPx;
              } else {
                ctx.textAlign = 'left';
              }

              const ty = cellY + cellH / 2;
              ctx.fillText(textStr, tx, ty);
              ctx.restore();
            }
          }
        }
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

        const paddingPx = (text.paddingMm || 2) * pxPerMm;
        const availWidthPx = elScreenW - (paddingPx * 2);
        const colCount = Math.max(1, text.columns || 1);
        const colGutterPx = (text.columnGutterMm || 4) * pxPerMm;
        const singleColWidthPx = (availWidthPx - (colGutterPx * (colCount - 1))) / colCount;

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
        const processedText = formatOpenTypeText(text.text, text.openTypeFeatures);

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
                    lineWords.push(wordList.shift()!);
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

                if (metrics.width - trailingHang > lineMaxW && currentLineWords.length > 0) {
                  allLines.push({
                    text: currentLineWords.join(' '),
                    isLastInPara: false,
                    indentX: lineIndent,
                    availWidth: lineMaxW,
                  });
                  if (isDropLine) {
                    dropCapLinesRemaining--;
                  }
                  currentLineWords = [word];
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

        if (isOverflowing && state.showGuides) {
          const badgeSize = 10 * state.zoom;
          ctx.fillStyle = '#e63946';
          ctx.fillRect(elScreenX + elScreenW - badgeSize, elScreenY + elScreenH - badgeSize, badgeSize, badgeSize);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(elScreenX + elScreenW - badgeSize / 2, elScreenY + elScreenH - badgeSize + 2);
          ctx.lineTo(elScreenX + elScreenW - badgeSize / 2, elScreenY + elScreenH - 2);
          ctx.moveTo(elScreenX + elScreenW - badgeSize + 2, elScreenY + elScreenH - badgeSize / 2);
          ctx.lineTo(elScreenX + elScreenW - 2, elScreenY + elScreenH - badgeSize / 2);
          ctx.stroke();
        }
      }

      ctx.restore();
      if (isSelected) {
        const elLayer = layerMap.get(el.layerId || 'layer-1') || state.layers?.[0];
        const layerColor = elLayer?.colorHex || '#0d99ff';
        const isElementLocked = el.locked || Boolean(elLayer?.locked);

        ctx.strokeStyle = isElementLocked ? '#f59e0b' : layerColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(elScreenX, elScreenY, elScreenW, elScreenH);

        if (isElementLocked) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(elScreenX, elScreenY - 14, 28, 14);
          ctx.fillStyle = '#111111';
          ctx.font = 'bold 8px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('LOCK', elScreenX + 14, elScreenY - 3);
        } else if (!state.selectedElementIds || state.selectedElementIds.length <= 1) {
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

    // Render interactive rubber-band line when linking
    if (state.linkingFromFrameId) {
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
    if (state.activeTool === 'pen' && this.activePenPathId) {
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

    if (state.selectedElementIds && state.selectedElementIds.length > 1) {
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

    if (this.isMarquee) {
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

    this.drawRulers();
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
