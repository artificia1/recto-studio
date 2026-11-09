export interface ProofPage {
  signature: string;
  textSignature: string;
  width: number;
  height: number;
}

export type ProofChange = 'unchanged' | 'text' | 'artwork' | 'size' | 'added' | 'removed';

export function compareProofPages(before: ProofPage[], after: ProofPage[]): ProofChange[] {
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => {
    const a = before[index], b = after[index];
    if (!a) return 'added';
    if (!b) return 'removed';
    if (a.width !== b.width || a.height !== b.height) return 'size';
    if (a.textSignature !== b.textSignature) return 'text';
    return a.signature === b.signature ? 'unchanged' : 'artwork';
  });
}

export function uniqueProofMatches(pages: ProofPage[]) {
  const indexes = new Map<string, number | null>();
  pages.forEach(({ signature }, index) => indexes.set(signature, indexes.has(signature) ? null : index));
  return indexes;
}
