/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

// Physical print coordinate space (mm) <-> Screen raster space (px)
// Constant: 96 DPI CSS baseline => 96 / 25.4 ≈ 3.7795275591 px/mm

export const MM_TO_PX = 3.7795275591;
export const PX_TO_MM = 1 / MM_TO_PX;

export interface Point2D {
  x: number;
  y: number;
}

export interface ViewportRect {
  width: number;
  height: number;
}

export interface ViewportTransformState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface SpreadGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  numPages: number;
  spreadWidthMm: number;
  spreadHeightMm: number;
  spreadWidthPx: number;
  spreadHeightPx: number;
}

/** Converts millimeters to screen pixels at the given zoom level. */
export function mmToPx(mm: number, zoom = 1): number {
  return mm * MM_TO_PX * zoom;
}

/** Converts screen pixels to millimeters at the given zoom level. */
export function pxToMm(px: number, zoom = 1): number {
  return px / (MM_TO_PX * zoom);
}

/** Computes physical spread geometry given page trim dimensions, page count, and zoom. */
export function calculateSpreadGeometry(
  pageWidthMm: number,
  pageHeightMm: number,
  numPages: number,
  zoom: number,
  geometry: SpreadGeometry = { pageWidthMm: 0, pageHeightMm: 0, numPages: 0, spreadWidthMm: 0, spreadHeightMm: 0,
    spreadWidthPx: 0, spreadHeightPx: 0 },
): SpreadGeometry {
  geometry.numPages = Math.max(1, numPages);
  geometry.pageWidthMm = pageWidthMm;
  geometry.pageHeightMm = geometry.spreadHeightMm = pageHeightMm;
  geometry.spreadWidthMm = pageWidthMm * geometry.numPages;
  geometry.spreadWidthPx = mmToPx(geometry.spreadWidthMm, zoom);
  geometry.spreadHeightPx = mmToPx(pageHeightMm, zoom);
  return geometry;
}

/** Calculates the top-left screen pixel position of the active spread. */
export function getSpreadScreenOrigin(
  containerRect: ViewportRect,
  spreadGeometry: SpreadGeometry,
  viewport: ViewportTransformState,
  point: Point2D = { x: 0, y: 0 },
): Point2D {
  const centerX = containerRect.width / 2 + viewport.panX;
  const centerY = containerRect.height / 2 + viewport.panY;

  point.x = centerX - spreadGeometry.spreadWidthPx / 2;
  point.y = centerY - spreadGeometry.spreadHeightPx / 2;
  return point;
}

/** Transforms screen pixels to physical spread millimeters. */
export function screenToSpreadMm(
  screenX: number,
  screenY: number,
  spreadOriginPx: Point2D,
  zoom: number,
  point: Point2D = { x: 0, y: 0 },
): Point2D {
  const pxPerMm = MM_TO_PX * zoom;
  point.x = (screenX - spreadOriginPx.x) / pxPerMm;
  point.y = (screenY - spreadOriginPx.y) / pxPerMm;
  return point;
}

/** Transforms physical spread millimeters to screen pixels. */
export function spreadMmToScreen(
  spreadMmX: number,
  spreadMmY: number,
  spreadOriginPx: Point2D,
  zoom: number
): Point2D {
  const pxPerMm = MM_TO_PX * zoom;
  return {
    x: spreadOriginPx.x + spreadMmX * pxPerMm,
    y: spreadOriginPx.y + spreadMmY * pxPerMm,
  };
}

/** Snaps a coordinate value against candidate snap targets within a physical millimeter threshold. */
export function snapCoordinate(
  valueMm: number,
  targetsMm: number[],
  thresholdMm = 2
): { snapped: number; didSnap: boolean; delta: number } {
  let closestTarget = valueMm;
  let minDelta = Infinity;

  for (const target of targetsMm) {
    const delta = Math.abs(valueMm - target);
    if (delta <= thresholdMm && delta < minDelta) {
      minDelta = delta;
      closestTarget = target;
    }
  }

  if (minDelta !== Infinity) {
    return {
      snapped: closestTarget,
      didSnap: true,
      delta: closestTarget - valueMm,
    };
  }

  return {
    snapped: valueMm,
    didSnap: false,
    delta: 0,
  };
}
