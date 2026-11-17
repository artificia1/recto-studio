import type { PdfProofRegion } from '../../src/export/pdfRasterNode';
import { openProof, visualDiff } from './proof';
import { limits, sha256, type PublishingWorkspace } from './workspace';

interface Selection {
  page: number;
  bounds: PdfProofRegion;
}

interface ProofCheck {
  name: string;
  approved: Selection;
  current: Selection;
  maxChangedFraction: number;
}

export async function verifyProofRegions(workspace: PublishingWorkspace, args: {
  approvedPdf: string; approvedRevision: string; currentPdf: string; currentRevision?: string;
  checks: ProofCheck[]; maxEdge: number;
}) {
  if (new Set(args.checks.map(check => check.name)).size !== args.checks.length) {
    throw new Error('Use a unique name for each protected region.');
  }
  async function openEdition(file: string, expected: string | undefined, edition: string) {
    const bytes = await workspace.read(file, ['.pdf'], limits.pdf);
    const revision = sha256(bytes);
    if (expected && expected !== revision) throw new Error(`The ${edition} PDF has changed. Confirm its revision again.`);
    return { revision, proof: await openProof(bytes) };
  }
  const approved = await openEdition(args.approvedPdf, args.approvedRevision, 'approved');
  let current: Awaited<ReturnType<typeof openEdition>> | undefined;
  try {
    current = await openEdition(args.currentPdf, args.currentRevision, 'current');
    const rows = [];
    let preview: { name: string; kind: 'diff' | 'current'; bytes: Buffer } | undefined;
    for (const check of args.checks) {
      const before = await approved.proof.region(check.approved.page - 1, check.approved.bounds, args.maxEdge);
      const after = await current.proof.region(check.current.page - 1, check.current.bounds, args.maxEdge);
      const sameSize = Math.abs(before.widthPt - after.widthPt) <= 0.01 && Math.abs(before.heightPt - after.heightPt) <= 0.01;
      const diff = sameSize ? await visualDiff(before, after) : undefined;
      const changedFraction = diff?.comparable ? diff.changedPixels / (after.width * after.height) : null;
      const status = changedFraction === null ? 'geometry-changed' :
        changedFraction > check.maxChangedFraction ? 'changed' : 'passed';
      rows.push({ ...check, status, changedFraction, changedPixels: diff?.comparable ? diff.changedPixels : null,
        approvedSizePt: { width: before.widthPt, height: before.heightPt },
        currentSizePt: { width: after.widthPt, height: after.heightPt } });
      if (status !== 'passed' && !preview) {
        const bytes = diff?.comparable ? diff.bytes : after.bytes;
        if (bytes.length <= limits.proofImage) preview = { name: check.name, kind: diff?.comparable ? 'diff' : 'current', bytes };
      }
    }
    return { image: preview?.bytes, report: {
      passed: rows.every(row => row.status === 'passed'), rows,
      approvedRevision: approved.revision, currentRevision: current.revision,
      preview: preview ? { name: preview.name, kind: preview.kind } : null,
    } };
  } finally { await Promise.allSettled([approved.proof.destroy(), current?.proof.destroy()]); }
}
