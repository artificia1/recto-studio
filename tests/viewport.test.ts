import { describe, it, expect } from 'vitest';
import {
  MM_TO_PX,
  PX_TO_MM,
  mmToPx,
  pxToMm,
  calculateSpreadGeometry,
  getSpreadScreenOrigin,
  screenToSpreadMm,
  spreadMmToScreen,
  snapCoordinate,
} from '../src/engine/viewport';

describe('Viewport & Coordinate Geometry Engine', () => {
  it('converts millimeters to pixels accurately at 96 DPI CSS baseline', () => {
    // 1 inch = 25.4 mm = 96 px => 96 / 25.4 = 3.7795275591...
    expect(MM_TO_PX).toBeCloseTo(3.7795275591, 6);
    expect(PX_TO_MM).toBeCloseTo(1 / 3.7795275591, 6);

    // 25.4 mm should equal exactly 96 px at 100% zoom
    expect(mmToPx(25.4, 1.0)).toBeCloseTo(96.0, 4);

    // Scaling by zoom factor
    expect(mmToPx(25.4, 2.0)).toBeCloseTo(192.0, 4);
    expect(mmToPx(25.4, 0.5)).toBeCloseTo(48.0, 4);

    // Inverse conversion
    expect(pxToMm(96.0, 1.0)).toBeCloseTo(25.4, 4);
    expect(pxToMm(192.0, 2.0)).toBeCloseTo(25.4, 4);
  });

  it('computes spread physical geometry across facing page spreads', () => {
    // Standard A4 facing page spread (2 pages of 210 x 297 mm)
    const geom = calculateSpreadGeometry(210, 297, 2, 1.0);
    expect(geom.spreadWidthMm).toBe(420);
    expect(geom.spreadHeightMm).toBe(297);
    expect(geom.spreadWidthPx).toBeCloseTo(420 * MM_TO_PX, 4);
    expect(geom.spreadHeightPx).toBeCloseTo(297 * MM_TO_PX, 4);
  });

  it('computes screen spread origin with pan offsets and center-anchoring', () => {
    const containerRect = { width: 1200, height: 800 };
    const geom = calculateSpreadGeometry(210, 297, 2, 1.0);

    // Centered with 0 pan
    const originZero = getSpreadScreenOrigin(containerRect, geom, { zoom: 1.0, panX: 0, panY: 0 });
    expect(originZero.x).toBeCloseTo(600 - geom.spreadWidthPx / 2, 4);
    expect(originZero.y).toBeCloseTo(400 - geom.spreadHeightPx / 2, 4);

    // Offset by panX = +100, panY = -50
    const originPan = getSpreadScreenOrigin(containerRect, geom, { zoom: 1.0, panX: 100, panY: -50 });
    expect(originPan.x).toBeCloseTo(originZero.x + 100, 4);
    expect(originPan.y).toBeCloseTo(originZero.y - 50, 4);
  });

  it('translates coordinates bidirectionally between screen pixels and spread millimeters', () => {
    const origin = { x: 250, y: 150 };
    const zoom = 1.5;

    const testMm = { x: 75, y: 120 };
    const screenCoord = spreadMmToScreen(testMm.x, testMm.y, origin, zoom);

    // Round-trip screenToSpreadMm
    const recoveredMm = screenToSpreadMm(screenCoord.x, screenCoord.y, origin, zoom);
    expect(recoveredMm.x).toBeCloseTo(testMm.x, 5);
    expect(recoveredMm.y).toBeCloseTo(testMm.y, 5);
  });

  it('calculates magnetic snapping within physical millimeter thresholds', () => {
    const targets = [0, 20, 190, 210]; // Margin and trim targets (mm)
    const thresholdMm = 2.0;

    // 1. Within snapping threshold (19.2mm -> snaps to 20mm)
    const snapNear = snapCoordinate(19.2, targets, thresholdMm);
    expect(snapNear.didSnap).toBe(true);
    expect(snapNear.snapped).toBe(20);
    expect(snapNear.delta).toBeCloseTo(0.8, 4);

    // 2. Exact match
    const snapExact = snapCoordinate(210, targets, thresholdMm);
    expect(snapExact.didSnap).toBe(true);
    expect(snapExact.snapped).toBe(210);
    expect(snapExact.delta).toBe(0);

    // 3. Outside threshold (15mm is > 2mm from 0 and 20)
    const snapFar = snapCoordinate(15.0, targets, thresholdMm);
    expect(snapFar.didSnap).toBe(false);
    expect(snapFar.snapped).toBe(15.0);
    expect(snapFar.delta).toBe(0);
  });
});
