import type { BreakNode, KnuthItem } from './knuthPlass';
import type { WrapObstacle } from './wrapGeometry';

type LinePlan = { words: string[]; advances: number[]; starts: number[] };

interface LayoutKernels {
  place(obstacles: WrapObstacle[], x: number, y: number, padding: number, bottom: number,
    width: number, gutter: number, columns: number):
    ((column: number, y: number, height: number, gridStart: number, pitch: number) =>
      { column: number; y: number; inset: number; width: number; fits: boolean } | undefined) | undefined;
  optimalBreaks(items: KnuthItem[], widths: number | number[], tolerance: number, hyphenCost: number):
    Pick<BreakNode, 'itemIndex' | 'ratio'>[] | null | undefined;
  uniformLines(text: string, measure: (text: string) => number, widths: number[],
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
