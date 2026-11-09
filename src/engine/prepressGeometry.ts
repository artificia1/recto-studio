import Clipper from 'clipper-lib';
import type { CanvasElement } from '../types';

export interface InkPoint { X: number; Y: number }
export type InkPaths = InkPoint[][];
const SCALE = 10000;
export function polygonBoolean(subject: InkPaths, clip: InkPaths, operation: 'intersection' | 'difference'): InkPaths {
  const engine = new Clipper.Clipper();
  engine.AddPaths(subject, Clipper.PolyType.ptSubject, true); engine.AddPaths(clip, Clipper.PolyType.ptClip, true);
  const result: InkPaths = [];
  engine.Execute(operation === 'intersection' ? Clipper.ClipType.ctIntersection : Clipper.ClipType.ctDifference, result, Clipper.PolyFillType.pftNonZero, Clipper.PolyFillType.pftNonZero);
  return result;
}
export function offsetInkPaths(paths: InkPaths, deltaMm: number): InkPaths {
  if (!Number.isFinite(deltaMm) || Math.abs(deltaMm) > 5) throw new Error('Choke/spread offsets must be within 5 mm.');
  const engine = new Clipper.ClipperOffset(2, 0.002 * SCALE), result: InkPaths = [];
  engine.AddPaths(paths, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon); engine.Execute(result, deltaMm * SCALE); return result;
}
export const inkAreaMm2 = (paths: InkPaths) => Math.abs(paths.reduce((sum, path) => sum + Clipper.Clipper.Area(path), 0)) / SCALE ** 2;
export const inkCoordinates = (paths: InkPaths) => paths.map(path => path.map(point => ({ x: point.X / SCALE, y: point.Y / SCALE })));

/** Closed fill geometry in page millimetres, including rotation and cubic handles. */
export function elementInkPaths(element: CanvasElement): InkPaths {
  const points: { x: number; y: number }[] = [];
  if (element.type === 'shape' && element.shapeKind === 'rectangle') points.push({ x: 0, y: 0 }, { x: element.width, y: 0 }, { x: element.width, y: element.height }, { x: 0, y: element.height });
  else if (element.type === 'shape' && element.shapeKind === 'ellipse') {
    const count = Math.max(32, Math.min(1024, Math.ceil(Math.PI * Math.sqrt(Math.max(element.width, element.height) / 0.02))));
    for (let i = 0; i < count; i++) { const angle = 2 * Math.PI * i / count; points.push({ x: element.width / 2 * (1 + Math.cos(angle)), y: element.height / 2 * (1 + Math.sin(angle)) }); }
  } else if (element.type === 'path' && element.closed && element.nodes.length >= 3) {
    points.push(element.nodes[0]);
    const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const cubic = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }, depth = 0) => {
      const length = Math.hypot(d.x - a.x, d.y - a.y);
      const distance = (p: { x: number; y: number }) => length ? Math.abs((d.x - a.x) * (a.y - p.y) - (a.x - p.x) * (d.y - a.y)) / length : Math.hypot(p.x - a.x, p.y - a.y);
      if (depth >= 12 || Math.max(distance(b), distance(c)) <= 0.005) { points.push(d); return; }
      const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d), abc = midpoint(ab, bc), bcd = midpoint(bc, cd), middle = midpoint(abc, bcd);
      cubic(a, ab, abc, middle, depth + 1); cubic(middle, bcd, cd, d, depth + 1);
    };
    for (let i = 0; i < element.nodes.length; i++) {
      const a = element.nodes[i], d = element.nodes[(i + 1) % element.nodes.length];
      cubic(a, { x: a.x + (a.handleOut?.x || 0), y: a.y + (a.handleOut?.y || 0) }, { x: d.x + (d.handleIn?.x || 0), y: d.y + (d.handleIn?.y || 0) }, d);
      if (points.length > 16000) throw new Error('This path is too complex for automatic trapping. Simplify its nodes.');
    }
  } else return [];
  const angle = (element.rotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), cx = element.width / 2, cy = element.height / 2;
  const path = points.map(point => ({ X: Math.round((element.x + cx + (point.x - cx) * cos - (point.y - cy) * sin) * SCALE), Y: Math.round((element.y + cy + (point.x - cx) * sin + (point.y - cy) * cos) * SCALE) }));
  if (path.some(point => !Number.isSafeInteger(point.X) || !Number.isSafeInteger(point.Y) || Math.abs(point.X) > 1e10 || Math.abs(point.Y) > 1e10)) throw new Error('Path coordinates exceed trapping limits.');
  if (!Clipper.Clipper.Orientation(path)) path.reverse(); return [path];
}
