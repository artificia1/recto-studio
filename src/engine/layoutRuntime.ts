import type { BreakNode, KnuthItem } from './knuthPlass';
import type { WrapObstacle } from './wrapGeometry';
import type { StoryRun } from '../types';
import type { RunStyle, StoryMeasure } from './storyLayout';

type LinePlan = { tokens: { text: string; width: number; style: RunStyle }[]; starts: number[] };

interface LayoutKernels {
  place(obstacles: WrapObstacle[], x: number, y: number, padding: number, bottom: number,
    width: number, gutter: number, columns: number):
    ((column: number, y: number, height: number, gridStart: number, pitch: number) =>
      { column: number; y: number; inset: number; width: number; fits: boolean } | undefined) | undefined;
  optimalBreaks(items: KnuthItem[], widths: number | number[], tolerance: number, hyphenCost: number):
    Pick<BreakNode, 'itemIndex' | 'ratio'>[] | null | undefined;
  storyLines(runs: StoryRun[], resolve: (run: StoryRun) => RunStyle, measure: StoryMeasure,
    x: number, width: number, gutter: number, column: number, columns: number,
    y: number, padding: number, bottom: number, height: number): LinePlan | undefined;
}

export let layoutKernels: LayoutKernels | undefined;
let loading: Promise<void> | undefined;

export function warmLayout() {
  loading ??= import('./layoutWasm').then(async ({ loadLayoutKernels }) => {
    layoutKernels = await loadLayoutKernels();
  }).catch(() => undefined);
  return loading;
}
