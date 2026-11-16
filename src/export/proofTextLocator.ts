interface TextFragment {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

export const normalizeProofText = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();

export function locateProofText(
  items: TextFragment[], query: string, matchCase: boolean,
  viewport: { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] },
  limit: number,
) {
  const key = (text: string) => matchCase ? normalizeProofText(text) : normalizeProofText(text).toLowerCase();
  const needle = key(query);
  if (!needle) return [];
  let text = '';
  const fragments: { item: TextFragment; start: number; end: number }[] = [];
  for (const item of items) {
    const value = key(item.str);
    if (!value) continue;
    if (text) text += ' ';
    const start = text.length;
    text += value;
    fragments.push({ item, start, end: text.length });
  }

  function box(item: TextFragment) {
    const [a, b, c, d, x, y] = item.transform;
    const horizontal = Math.hypot(a, b) || 1;
    const vertical = Math.hypot(c, d) || 1;
    const advance = [item.width * a / horizontal, item.width * b / horizontal] as const;
    const rise = [item.height * c / vertical, item.height * d / vertical] as const;
    const corners = [viewport.convertToViewportPoint(x, y),
      viewport.convertToViewportPoint(x + advance[0], y + advance[1]),
      viewport.convertToViewportPoint(x + rise[0], y + rise[1]),
      viewport.convertToViewportPoint(x + advance[0] + rise[0], y + advance[1] + rise[1])];
    const xs = corners.map(point => point[0] / viewport.width);
    const ys = corners.map(point => point[1] / viewport.height);
    return { left: Math.max(0, Math.min(...xs)), top: Math.max(0, Math.min(...ys)),
      right: Math.min(1, Math.max(...xs)), bottom: Math.min(1, Math.max(...ys)) };
  }

  const matches: { fragments: string[]; boxes: ReturnType<typeof box>[] }[] = [];
  let cursor = 0;
  for (let start = text.indexOf(needle); start >= 0 && matches.length < limit; start = text.indexOf(needle, start + needle.length)) {
    const end = start + needle.length;
    while (cursor < fragments.length && fragments[cursor].end <= start) cursor++;
    const selected: TextFragment[] = [];
    for (let index = cursor; index < fragments.length && fragments[index].start < end; index++) selected.push(fragments[index].item);
    matches.push({ fragments: selected.map(item => item.str.slice(0, 500)), boxes: selected.map(box) });
  }
  return matches;
}
