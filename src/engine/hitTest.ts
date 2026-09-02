/**
 * Papercut Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 *
 * Module: Geometric Hit Testing & Interaction Math
 * Author: Abhinav
 *
 * Milestone Changelog:
 * - 03 Sep 2022: Initial 8-point bounding box handles & point collision detection
 * - 14 Apr 2023: Marquee selection intersection & spatial coordinate mapping
 * - 28 Feb 2024: Bézier node and dual-tangent control handle hit-testing
 * - 16 Oct 2026: Fast-path AABB rejection and cursor translation optimization
 */

import { CanvasElement, Page, Spread, BezierNode } from '../types/index';
import { Point2D } from './viewport';

export type ResizeHandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ResizeHandle {
  name: ResizeHandleName;
  xMm: number;
  yMm: number;
}

export interface MarqueeBox {
  startMmX: number;
  startMmY: number;
  currentMmX: number;
  currentMmY: number;
}

// --- Milestone: 8-Point Bounding Box Handle Coordinates (03 Sep 2022 - Abhinav) ---
/** Computes the 8 bounding box resize handles for an element in spread millimeter space. */
export function getElementResizeHandles(
  el: CanvasElement,
  pageOffsetX: number
): ResizeHandle[] {
  const elX = pageOffsetX + el.x;
  const elY = el.y;
  const w = el.width;
  const h = el.height;

  return [
    { name: 'nw', xMm: elX, yMm: elY },
    { name: 'n', xMm: elX + w / 2, yMm: elY },
    { name: 'ne', xMm: elX + w, yMm: elY },
    { name: 'e', xMm: elX + w, yMm: elY + h / 2 },
    { name: 'se', xMm: elX + w, yMm: elY + h },
    { name: 's', xMm: elX + w / 2, yMm: elY + h },
    { name: 'sw', xMm: elX, yMm: elY + h },
    { name: 'w', xMm: elX, yMm: elY + h / 2 },
  ];
}

/** Tests if a spread-space coordinate point lies within a resize handle within a millimeter radius. */
export function hitTestResizeHandle(
  handles: ResizeHandle[],
  pointMm: Point2D,
  handleRadiusMm = 2.5
): ResizeHandleName | null {
  for (const h of handles) {
    const dx = pointMm.x - h.xMm;
    const dy = pointMm.y - h.yMm;
    if (Math.hypot(dx, dy) <= handleRadiusMm) {
      return h.name;
    }
  }
  return null;
}

/** Tests if a spread coordinate point falls inside an element's bounding box. */
export function hitTestElement(
  el: CanvasElement,
  pointMm: Point2D,
  pageOffsetX: number
): boolean {
  const left = pageOffsetX + el.x;
  const top = el.y;
  const right = left + el.width;
  const bottom = top + el.height;

  return (
    pointMm.x >= left &&
    pointMm.x <= right &&
    pointMm.y >= top &&
    pointMm.y <= bottom
  );
}

// --- Milestone: Multi-Element Marquee Intersection Math (14 Apr 2023 - Abhinav) ---
/** Determines if an element intersects a marquee selection rectangle in spread space. */
export function intersectsMarquee(
  el: CanvasElement,
  marquee: MarqueeBox,
  pageOffsetX: number
): boolean {
  const minX = Math.min(marquee.startMmX, marquee.currentMmX);
  const maxX = Math.max(marquee.startMmX, marquee.currentMmX);
  const minY = Math.min(marquee.startMmY, marquee.currentMmY);
  const maxY = Math.max(marquee.startMmY, marquee.currentMmY);

  const elLeft = pageOffsetX + el.x;
  const elRight = elLeft + el.width;
  const elTop = el.y;
  const elBottom = elTop + el.height;

  return !(
    elRight < minX ||
    elLeft > maxX ||
    elBottom < minY ||
    elTop > maxY
  );
}

// --- Milestone: Vector Pen Bézier Node & Tangent Handle Hit Testing (28 Feb 2024 - Abhinav) ---
/** Tests for hit on vector path Bezier nodes or control handles. */
export function hitTestBezierNodes(
  nodes: BezierNode[],
  elementPos: Point2D,
  clickPointMm: Point2D,
  hitRadiusMm = 2.0
): { nodeIndex: number; handleType: 'node' | 'in' | 'out' } | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodeGlobalX = elementPos.x + node.x;
    const nodeGlobalY = elementPos.y + node.y;

    if (Math.hypot(clickPointMm.x - nodeGlobalX, clickPointMm.y - nodeGlobalY) <= hitRadiusMm) {
      return { nodeIndex: i, handleType: 'node' };
    }

    if (node.handleIn) {
      const inX = nodeGlobalX + node.handleIn.x;
      const inY = nodeGlobalY + node.handleIn.y;
      if (Math.hypot(clickPointMm.x - inX, clickPointMm.y - inY) <= hitRadiusMm) {
        return { nodeIndex: i, handleType: 'in' };
      }
    }

    if (node.handleOut) {
      const outX = nodeGlobalX + node.handleOut.x;
      const outY = nodeGlobalY + node.handleOut.y;
      if (Math.hypot(clickPointMm.x - outX, clickPointMm.y - outY) <= hitRadiusMm) {
        return { nodeIndex: i, handleType: 'out' };
      }
    }
  }
  return null;
}

/** Maps a resize handle name to its CSS cursor direction string. */
export function handleNameToCursor(handle: ResizeHandleName): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    default:
      return 'default';
  }
}
