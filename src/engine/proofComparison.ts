export interface ProofPage {
  signature: string;
  textSignature: string;
  width: number;
  height: number;
}

export type ProofChange = 'unchanged' | 'text' | 'artwork' | 'size' | 'added' | 'removed';

export interface ProofMatch {
  before: number | null;
  after: number | null;
  change: ProofChange | 'uncertain';
  moved: boolean;
}

function classify(a: ProofPage, b: ProofPage): ProofChange {
  if (a.width !== b.width || a.height !== b.height) return 'size';
  if (a.textSignature !== b.textSignature) return 'text';
  return a.signature === b.signature ? 'unchanged' : 'artwork';
}

export function compareProofPages(before: ProofPage[], after: ProofPage[]): ProofChange[] {
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => {
    const a = before[index], b = after[index];
    if (!a) return 'added';
    if (!b) return 'removed';
    return classify(a, b);
  });
}

export function uniqueProofMatches(pages: ProofPage[]) {
  const indexes = new Map<string, number | null>();
  pages.forEach(({ signature }, index) => indexes.set(signature, indexes.has(signature) ? null : index));
  return indexes;
}

/** A stable ID can match a changed page. A PDF alone can only prove an exact, unique match. */
export function matchProofPages(before: ProofPage[], after: ProofPage[], ids?: { before: string[]; after: string[] }): ProofMatch[] {
  const originals = ids ? new Map(ids.before.map((key, index) => [key, index])) : uniqueProofMatches(before);
  const revised = ids ? undefined : uniqueProofMatches(after);
  const used = new Set<number>();
  const rows = after.map((page, index): ProofMatch => {
    const previous = ids ? originals.get(ids.after[index]) : revised?.get(page.signature) == null ? undefined : originals.get(page.signature);
    if (previous == null) return { before: null, after: index, change: 'added', moved: false };
    used.add(previous);
    return { before: previous, after: index, change: classify(before[previous], page), moved: previous !== index };
  });
  const removed = before.flatMap((page, index): ProofMatch[] =>
    used.has(index) ? [] : [{ before: index, after: null, change: 'removed', moved: false }]);
  // Without IDs an unmatched original and revision may be a changed page or separate insertions/removals.
  // Keep both visible and unpaired rather than implying that comments can follow the position.
  if (!ids && removed.length && rows.some(row => row.before === null)) {
    for (const row of rows) if (row.before === null) row.change = 'uncertain';
    for (const row of removed) row.change = 'uncertain';
  }
  return [...rows, ...removed];
}
