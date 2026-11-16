import type { BreakNode, KnuthItem } from './knuthPlass';

type LinePlan = { words: string[]; advances: number[]; starts: number[] };

interface LayoutKernels {
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
