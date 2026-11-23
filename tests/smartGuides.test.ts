import { describe, expect, it } from 'vitest';
import { createSmartGuideSnap } from '../src/engine/interaction/smartGuides';
import { StateManager } from '../src/state/stateManager';
import type { CanvasElement } from '../src/types';

const settings = new StateManager().getState().settings;
const element = (id: string, x: number, y: number, width: number, height: number) =>
  ({ id, x, y, width, height } as CanvasElement);

describe('smart guides', () => {
  it('preserves the first target when two anchors are equally close', () => {
    const first = element('first', 73, 65, 8, 10);
    const second = element('second', 71, 45, 8, 9);
    const snap = createSmartGuideSnap(settings, [first, second], 'moving');
    const result = snap({ x: 72, y: 103, width: 21, height: 11 }, 1);
    expect(result.x).toBe(73);
    expect(result.guides.lines[0]).toEqual({ orientation: 'v', posMm: 73, minMm: 61, maxMm: 118, pageIndex: 1 });
  });

  it('snaps to equal spacing and excludes the moving frame from the index', () => {
    const snap = createSmartGuideSnap(settings, [element('left', 21, 23, 10, 33),
      element('moving', 47, 79, 13, 18), element('right', 83, 111, 9, 21)], 'moving');
    const result = snap({ x: 50, y: 79, width: 13, height: 18 }, 0);
    expect(result.x).toBe(50.5);
    expect(result.guides.spacings.map(({ startMm, endMm, gapMm }) => [startMm, endMm, gapMm]))
      .toEqual([[31, 50.5, 19.5], [63.5, 83, 19.5]]);
    expect(result.guides.lines).toEqual([]);
  });
});
