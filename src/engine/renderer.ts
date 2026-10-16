/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import {
  ProjectState,
  Spread,
  CanvasElement,
  TextElement,
  ImageElement,
  ShapeElement,
  TableElement,
  VectorPathElement,
  PeerPresence,
} from '../types/index';
import { mmToPx, Point2D } from './viewport';
import { getElementResizeHandles } from './hitTest';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  originPx: Point2D;
  zoom: number;
  selectedIds: string[];
  activeLayerColor?: string;
  displayQuality?: 'fast' | 'typical' | 'high';
  imageProxyMap?: Map<string, HTMLCanvasElement | HTMLImageElement>;
}

/** Draws an active element's bounding box and 8 InDesign selection handles. */
export function drawSelectionBoundingBox(
  rc: RenderContext,
  el: CanvasElement,
  pageOffsetX: number
): void {
  const { ctx, originPx, zoom, activeLayerColor = '#0d99ff' } = rc;
  const elXPx = originPx.x + mmToPx(pageOffsetX + el.x, zoom);
  const elYPx = originPx.y + mmToPx(el.y, zoom);
  const elWPx = mmToPx(el.width, zoom);
  const elHPx = mmToPx(el.height, zoom);

  ctx.save();
  ctx.strokeStyle = activeLayerColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(elXPx, elYPx, elWPx, elHPx);

  // Selection handles
  const handles = getElementResizeHandles(el, pageOffsetX);
  const handleSizePx = 6;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = activeLayerColor;
  ctx.lineWidth = 1;

  for (const h of handles) {
    const hXPx = originPx.x + mmToPx(h.xMm, zoom);
    const hYPx = originPx.y + mmToPx(h.yMm, zoom);

    ctx.fillRect(hXPx - handleSizePx / 2, hYPx - handleSizePx / 2, handleSizePx, handleSizePx);
    ctx.strokeRect(hXPx - handleSizePx / 2, hYPx - handleSizePx / 2, handleSizePx, handleSizePx);
  }

  ctx.restore();
}

/** Renders remote peer presence cursors on canvas. */
export function drawRemotePresenceCursors(
  ctx: CanvasRenderingContext2D,
  originPx: Point2D,
  peers: PeerPresence[],
  zoom: number
): void {
  for (const peer of peers) {
    const pXPx = originPx.x + mmToPx(peer.x, zoom);
    const pYPx = originPx.y + mmToPx(peer.y, zoom);

    ctx.save();
    ctx.fillStyle = peer.color || '#e63946';
    ctx.beginPath();
    ctx.moveTo(pXPx, pYPx);
    ctx.lineTo(pXPx + 12, pYPx + 12);
    ctx.lineTo(pXPx + 4, pYPx + 14);
    ctx.lineTo(pXPx, pYPx + 18);
    ctx.closePath();
    ctx.fill();

    // Peer label pill
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillStyle = peer.color || '#e63946';
    const labelW = ctx.measureText(peer.name).width + 8;
    ctx.fillRect(pXPx + 12, pYPx + 10, labelW, 16);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(peer.name, pXPx + 16, pYPx + 22);
    ctx.restore();
  }
}
