import type { CanvasElement, TextElement, BezierNode } from '../types';
import { calculateImageFitting } from './imageFitting';

interface Point { x: number; y: number }
interface Polygon { points: Point[]; minY: number; maxY: number; closed: boolean }
export interface WrapObstacle { polygons: Polygon[]; gap: number }
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const rectangle = (x: number, y: number, width: number, height: number): Point[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];

function rotate(point: Point, cx: number, cy: number, angle: number): Point {
  const cos = Math.cos(angle), sin = Math.sin(angle), x = point.x - cx, y = point.y - cy;
  return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
}

function flattenedPath(nodes: BezierNode[], closed: boolean): Point[] {
  if (!nodes.length) return [];
  const result: Point[] = [{ x: nodes[0].x, y: nodes[0].y }];
  const flatten = (a: Point, b: Point, c: Point, d: Point, depth: number) => {
    const length = Math.hypot(d.x - a.x, d.y - a.y);
    const distance = (p: Point) => length ? Math.abs((d.y - a.y) * p.x - (d.x - a.x) * p.y + d.x * a.y - d.y * a.x) / length : Math.hypot(p.x - a.x, p.y - a.y);
    if (depth === 9 || (distance(b) <= 0.05 && distance(c) <= 0.05)) { result.push(d); return; }
    const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd);
    flatten(a, ab, abc, center, depth + 1); flatten(center, bcd, cd, d, depth + 1);
  };
  for (let index = 1; index < nodes.length + (closed ? 1 : 0); index++) {
    const a = nodes[(index - 1) % nodes.length], d = nodes[index % nodes.length];
    flatten(a, { x: a.x + (a.handleOut?.x || 0), y: a.y + (a.handleOut?.y || 0) },
      { x: d.x + (d.handleIn?.x || 0), y: d.y + (d.handleIn?.y || 0) }, d, 0);
    if (result.length > 8192) {
      // A bounded conservative fallback for exceptionally complex imported paths.
      const controls = nodes.flatMap(node => [node, { x: node.x + (node.handleIn?.x || 0), y: node.y + (node.handleIn?.y || 0) }, { x: node.x + (node.handleOut?.x || 0), y: node.y + (node.handleOut?.y || 0) }]);
      const xs = controls.map(p => p.x), ys = controls.map(p => p.y);
      return rectangle(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
  }
  return result;
}

/** Prepare page-space silhouettes once, then scan each complete line band. */
export function prepareWrapObstacles(elements: CanvasElement[], frame: TextElement): WrapObstacle[] {
  return elements.filter(element => element.id !== frame.id && element.pageId === frame.pageId &&
    !element.pasteboard && element.textWrap && element.textWrap.mode !== 'none').map(element => {
    let paths: Point[][] = [], closed = true;
    let gap = Number.isFinite(element.textWrap!.standoffMm) ? Math.max(0, element.textWrap!.standoffMm) : 3;
    if (element.textWrap!.mode === 'contour' && element.type === 'path' && element.nodes.length) {
      paths = [flattenedPath(element.nodes, element.closed)]; closed = element.closed;
      gap += (element.strokeWidthMm || 0) / 2 + 0.05;
    } else if (element.textWrap!.mode === 'contour' && element.type === 'shape' && element.shapeKind === 'ellipse') {
      paths = [Array.from({ length: 128 }, (_, index) => ({ x: element.width / 2 + Math.cos(index / 128 * Math.PI * 2) * element.width / 2,
        y: element.height / 2 + Math.sin(index / 128 * Math.PI * 2) * element.height / 2 }))];
      gap += 0.02;
    } else if (element.textWrap!.mode === 'contour' && element.type === 'image' && element.alphaContour?.length) {
      const fit = calculateImageFitting(0, 0, element.width, element.height, (element.originalWidth || element.width * 96 / 25.4) * 25.4 / 96,
        (element.originalHeight || element.height * 96 / 25.4) * 25.4 / 96, element.fitMode, element.focalPoint);
      paths = element.alphaContour.flatMap((row, index, rows) => {
        if (row.minX > row.maxX) return [];
        const left = Math.max(0, fit.drawX + row.minX * fit.drawW), right = Math.min(element.width, fit.drawX + row.maxX * fit.drawW);
        const top = Math.max(0, fit.drawY + index / rows.length * fit.drawH), bottom = Math.min(element.height, fit.drawY + (index + 1) / rows.length * fit.drawH);
        return right > left && bottom > top ? [rectangle(left, top, right - left, bottom - top)] : [];
      });
    } else paths = [rectangle(0, 0, element.width, element.height)];
    const angle = element.rotation * Math.PI / 180, frameAngle = -frame.rotation * Math.PI / 180;
    const polygons = paths.filter(points => points.length > 1).map(points => {
      const transformed = points.map(point => {
        const world = rotate({ x: element.x + point.x, y: element.y + point.y }, element.x + element.width / 2, element.y + element.height / 2, angle);
        return rotate(world, frame.x + frame.width / 2, frame.y + frame.height / 2, frameAngle);
      });
      return { points: transformed, minY: Math.min(...transformed.map(p => p.y)), maxY: Math.max(...transformed.map(p => p.y)), closed };
    });
    return { polygons, gap };
  });
}

function bandBounds(polygon: Polygon, top: number, bottom: number): [number, number] | null {
  if (polygon.maxY < top || polygon.minY > bottom) return null;
  let left = Infinity, right = -Infinity;
  const add = (x: number) => { left = Math.min(left, x); right = Math.max(right, x); };
  const points = polygon.points;
  points.forEach(point => { if (point.y >= top && point.y <= bottom) add(point.x); });
  for (let i = 1; i < points.length + (polygon.closed ? 1 : 0); i++) {
    const a = points[(i - 1) % points.length], b = points[i % points.length];
    if (a.y === b.y) continue;
    for (const y of [top, bottom]) if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) add(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
  }
  return left <= right ? [left, right] : null;
}

/** Union all obstacles before choosing a free interval, independent of object order. */
export function availableTextInterval(obstacles: WrapObstacle[], left: number, width: number, top: number, height: number) {
  const intervals: [number, number][] = [];
  for (const obstacle of obstacles) for (const polygon of obstacle.polygons) {
    const band = bandBounds(polygon, top - obstacle.gap, top + height + obstacle.gap);
    if (band) {
      const a = Math.max(left, band[0] - obstacle.gap), b = Math.min(left + width, band[1] + obstacle.gap);
      if (b > a) intervals.push([a, b]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cursor = left, best = { left, width: 0 };
  for (const [start, end] of intervals) {
    if (start - cursor > best.width) best = { left: cursor, width: start - cursor };
    cursor = Math.max(cursor, end);
  }
  if (left + width - cursor > best.width) best = { left: cursor, width: left + width - cursor };
  return best;
}
