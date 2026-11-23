import type { CanvasElement, DocumentSettings } from '../../types';

type Bounds = Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'>;
type Anchor = { position: number; start: number; end: number; order: number };
export interface SmartGuides {
  lines: { orientation: 'v' | 'h'; posMm: number; minMm: number; maxMm: number; pageIndex: number }[];
  spacings: { orientation: 'h' | 'v'; startMm: number; endMm: number; crossMm: number; gapMm: number; pageIndex: number }[];
}

export function sameSmartGuides(a: SmartGuides, b: SmartGuides): boolean {
  return a.lines.length === b.lines.length && a.spacings.length === b.spacings.length &&
    a.lines.every((line, index) => {
      const other = b.lines[index];
      return line.orientation === other.orientation && line.pageIndex === other.pageIndex &&
        line.posMm === other.posMm && line.minMm === other.minMm && line.maxMm === other.maxMm;
    }) && a.spacings.every((spacing, index) => {
      const other = b.spacings[index];
      return spacing.orientation === other.orientation && spacing.pageIndex === other.pageIndex &&
        spacing.startMm === other.startMm && spacing.endMm === other.endMm &&
        spacing.crossMm === other.crossMm && spacing.gapMm === other.gapMm;
    });
}

const threshold = 2;

function lowerBound<T>(items: T[], value: number, position: (item: T) => number, afterEqual = false): number {
  let low = 0, high = items.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2), current = position(items[mid]);
    if (current < value || (afterEqual && current === value)) low = mid + 1;
    else high = mid;
  }
  return low;
}

const anchorPosition = (item: Anchor) => item.position;
const edgePosition = (item: number) => item;

function snapAxis(anchors: Anchor[], origin: number, size: number) {
  let best: { anchor: Anchor; origin: number; distance: number } | undefined;
  for (const offset of [0, size / 2, size]) {
    const point = origin + offset;
    const index = lowerBound(anchors, point, anchorPosition);
    const before = anchors[index - 1], after = anchors[index];
    let anchor = before ?? after;
    if (before && after) {
      const left = point - before.position, right = after.position - point;
      if (right < left || (right === left && after.order < before.order)) anchor = after;
    }
    if (!anchor) continue;
    const distance = Math.abs(point - anchor.position);
    if (distance <= threshold && (!best || distance < best.distance)) best = { anchor, origin: anchor.position - offset, distance };
  }
  return best;
}

/** Index one drag's stationary geometry and preserve guide priority for ties. */
export function createSmartGuideSnap(settings: DocumentSettings, elements: CanvasElement[], movingId: string) {
  const { widthMm: width, heightMm: height, margins } = settings;
  const x: Anchor[] = [], y: Anchor[] = [];
  const add = (axis: Anchor[], position: number, start: number, end: number) => {
    axis.push({ position, start, end, order: axis.length });
  };
  for (const position of [0, width / 2, width]) add(x, position, 0, height);
  for (const position of [margins.insideMm, width - margins.outsideMm]) add(x, position, margins.topMm, height - margins.bottomMm);
  for (const position of [0, height / 2, height]) add(y, position, 0, width);
  for (const position of [margins.topMm, height - margins.bottomMm]) add(y, position, margins.insideMm, width - margins.outsideMm);

  const leftEdges: number[] = [], rightEdges: number[] = [];
  for (const element of elements) {
    if (element.id === movingId) continue;
    const right = element.x + element.width, bottom = element.y + element.height;
    for (const position of [element.x, element.x + element.width / 2, right]) add(x, position, element.y, bottom);
    for (const position of [element.y, element.y + element.height / 2, bottom]) add(y, position, element.x, right);
    leftEdges.push(element.x);
    rightEdges.push(right);
  }
  const sortedUnique = (axis: Anchor[]) => axis.sort((a, b) => a.position - b.position || a.order - b.order)
    .filter((anchor, index) => !index || anchor.position !== axis[index - 1].position);
  const horizontal = sortedUnique(x), vertical = sortedUnique(y);
  leftEdges.sort((a, b) => a - b);
  rightEdges.sort((a, b) => a - b);

  return (bounds: Bounds, pageIndex: number) => {
    let { x, y } = bounds;
    const { width, height } = bounds;
    const guides: SmartGuides = { lines: [], spacings: [] };
    const snapX = snapAxis(horizontal, x, width);
    if (snapX) {
      x = snapX.origin;
      guides.lines.push({ orientation: 'v', posMm: snapX.anchor.position,
        minMm: Math.min(snapX.anchor.start, y) - 4, maxMm: Math.max(snapX.anchor.end, y + height) + 4, pageIndex });
    }
    const snapY = snapAxis(vertical, y, height);
    if (snapY) {
      y = snapY.origin;
      guides.lines.push({ orientation: 'h', posMm: snapY.anchor.position,
        minMm: Math.min(snapY.anchor.start, x) - 4, maxMm: Math.max(snapY.anchor.end, x + width) + 4, pageIndex });
    }

    const left = rightEdges[lowerBound(rightEdges, x + threshold, edgePosition, true) - 1];
    const right = leftEdges[lowerBound(leftEdges, x + width - threshold, edgePosition)];
    if (left !== undefined && right !== undefined) {
      const firstGap = x - left, secondGap = right - (x + width);
      if (firstGap > 1 && secondGap > 1 && Math.abs(firstGap - secondGap) <= threshold) {
        const gapMm = (firstGap + secondGap) / 2;
        x = left + gapMm;
        const common = { orientation: 'h' as const, crossMm: y + height / 2, gapMm, pageIndex };
        guides.spacings.push({ ...common, startMm: left, endMm: x }, { ...common, startMm: x + width, endMm: right });
      }
    }
    return { x, y, guides };
  };
}
