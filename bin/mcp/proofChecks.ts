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

function uniqueChecks(checks: ProofCheck[]) {
  if (new Set(checks.map(check => check.name)).size !== checks.length) throw new Error('Use a unique name for each protected region.');
}

async function openEdition(workspace: PublishingWorkspace, file: string, expected: string | undefined, edition: string) {
  const bytes = await workspace.read(file, ['.pdf'], limits.pdf);
  const revision = sha256(bytes);
  if (expected && expected !== revision) throw new Error(`The ${edition} PDF has changed. Confirm its revision again.`);
  return { revision, proof: await openProof(bytes) };
}

export async function validateProofContract(workspace: PublishingWorkspace, args: {
  approvedPdf: string; approvedRevision: string; checks: ProofCheck[];
}) {
  uniqueChecks(args.checks);
  const approved = await openEdition(workspace, args.approvedPdf, args.approvedRevision, 'approved');
  try {
    if (args.checks.some(check => check.approved.page > approved.proof.length)) throw new Error('A check references a missing page in the approved PDF.');
  } finally { await approved.proof.destroy(); }
}

export async function verifyProofRegions(workspace: PublishingWorkspace, args: {
  approvedPdf: string; approvedRevision: string; currentPdf: string; currentRevision?: string;
  checks: ProofCheck[]; maxEdge: number;
}) {
  uniqueChecks(args.checks);
  const approved = await openEdition(workspace, args.approvedPdf, args.approvedRevision, 'approved');
  let current: Awaited<ReturnType<typeof openEdition>> | undefined;
  try {
    current = await openEdition(workspace, args.currentPdf, args.currentRevision, 'current');
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
        changedBounds: diff?.comparable ? diff.changedBounds : null,
        renderedPixels: { width: after.width, height: after.height },
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
