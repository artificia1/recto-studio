import type { PreflightIssue, ProjectState } from '../types';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../zip';
import { bookCoverDimensions, type BookDeliveryRecipe } from './bookDelivery';
import { publicationSnapshot } from './publicationReferences';
import { publicationPreflight } from './publicationPreflight';
import { captureComposedLayout } from './layoutChanges';
import { matchProofPages, type ProofPage } from './proofComparison';
import { fontManager } from '../fontManager';

export const maxBookProofBytes = 32 * 1024 * 1024;
export const maxBookProofPages = 500;

export interface BookProofPage {
  key: string;
  pageNumber: number;
  chapterId: string;
  chapterTitle: string;
  pageId?: string;
  spreadId?: string;
}

interface ProofFinding {
  key: string;
  page: number;
  severity: PreflightIssue['severity'];
  message: string;
}

export interface BookProofSnapshot {
  pages: BookProofPage[];
  findings: ProofFinding[];
  coverSignature?: string;
}

export interface ApprovedBookProof extends BookProofSnapshot {
  version: 1;
  approvedAt: string;
  pdf: string;
  sha256: string;
}

export function readApprovedBookProof(value: unknown): ApprovedBookProof {
  const proof = value as Partial<ApprovedBookProof> | null;
  const validText = (text: unknown, limit: number) => typeof text === 'string' && text.length > 0 && text.length <= limit;
  if (!proof || proof.version !== 1 || !validText(proof.approvedAt, 40) || !Number.isFinite(Date.parse(proof.approvedAt!)) ||
      typeof proof.pdf !== 'string' || proof.pdf.length > Math.ceil(maxBookProofBytes / 3) * 4 ||
      proof.pdf.length % 4 !== 0 || !proof.pdf.startsWith('JVBERi0') ||
      typeof proof.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(proof.sha256) ||
      (proof.coverSignature !== undefined && !validText(proof.coverSignature, 300)) ||
      !Array.isArray(proof.pages) || !proof.pages.length || proof.pages.length > maxBookProofPages ||
      !proof.pages.every((page, index) => page && page.pageNumber === index + 1 &&
        validText(page.key, 4096) && validText(page.chapterId, 200) && typeof page.chapterTitle === 'string' &&
        page.chapterTitle.length <= 512 && (page.pageId === undefined || validText(page.pageId, 1024)) &&
        (page.pageId === undefined ? page.spreadId === undefined : validText(page.spreadId, 1024)) &&
        page.key === JSON.stringify([page.chapterId, page.pageId ?? null])) ||
      new Set(proof.pages.map(page => page.key)).size !== proof.pages.length ||
      !Array.isArray(proof.findings) || proof.findings.length > 20_000 ||
      !proof.findings.every(item => item && validText(item.key, 6000) && validText(item.message, 4000) &&
        (item.severity === 'error' || item.severity === 'warning' || item.severity === 'info') && Number.isInteger(item.page) && item.page > 0)) {
    throw new Error('The approved book proof is invalid or exceeds the review limits.');
  }
  return proof as ApprovedBookProof;
}

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function approvedProofPdf(proof: ApprovedBookProof) {
  const bytes = new Uint8Array(base64ToUint8Array(proof.pdf));
  if (bytes.byteLength > maxBookProofBytes || await digest(bytes) !== proof.sha256) throw new Error('The approved PDF no longer matches its recorded checksum.');
  return bytes;
}

export async function approveBookProof(snapshot: BookProofSnapshot, bytes: Uint8Array<ArrayBuffer>): Promise<ApprovedBookProof> {
  if (bytes.byteLength > maxBookProofBytes) throw new Error('The approved PDF must be at most 32 MiB.');
  return readApprovedBookProof({
    ...snapshot, version: 1, approvedAt: new Date().toISOString(), pdf: uint8ArrayToBase64(bytes), sha256: await digest(bytes),
  });
}

export async function makeBookProof(source: ProjectState, pages: BookProofPage[], delivery?: BookDeliveryRecipe) {
  if (!pages.length || pages.length > maxBookProofPages) throw new Error('Book proof review supports up to 500 pages, including blank pages.');
  const { exportDocumentToPdf, pdfStoryMeasure } = await import('../export/pdfExport');
  await fontManager.restoreFonts(source.embeddedFonts);
  const measure = pdfStoryMeasure();
  const state = publicationSnapshot(source, measure);
  const issues = publicationPreflight(state, 'print');
  for (const location of captureComposedLayout(state, measure).overset.values()) {
    issues.push({ id: 'book-overset', code: 'OVERSET_TEXT', severity: 'error', message: 'Text is overset.',
      spreadIndex: 0, pageNumber: location.page, elementId: location.frameId });
  }
  const findings = issues.map(issue => {
    const identity = pages[issue.pageNumber - 1]?.key;
    const frame = issue.elementId?.replace(/^book-\d+-/, '');
    return { key: JSON.stringify([identity, frame, issue.code, issue.severity, issue.message]),
      page: issue.pageNumber, severity: issue.severity, message: issue.message };
  });
  const snapshot = { pages, findings, coverSignature: delivery && bookCoverDimensions(state.settings, pages.length, delivery).signature };
  const warnings = new Set<string>();
  const pdf = await exportDocumentToPdf(source, { download: false, fetchExternalAssets: false, visualProof: true,
    overprintBlack: false, onWarning: warning => warnings.add(warning) });
  if (pdf.getNumberOfPages() !== pages.length) throw new Error('The proof page map does not match the exported PDF.');
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  if (bytes.byteLength > maxBookProofBytes) throw new Error('The proof PDF exceeds 32 MiB. Reduce the size of embedded artwork before reviewing.');
  return { snapshot, bytes, warnings: [...warnings] };
}

export function compareBookProof(before: BookProofSnapshot, after: BookProofSnapshot, original: ProofPage[], revised: ProofPage[]) {
  if (before.pages.length !== original.length || after.pages.length !== revised.length) throw new Error('The proof page map does not match its PDF.');
  const rows = matchProofPages(original, revised, { before: before.pages.map(page => page.key), after: after.pages.map(page => page.key) });
  const beforeKeys = new Set(before.findings.map(item => item.key));
  const afterKeys = new Set(after.findings.map(item => item.key));
  return {
    rows,
    beforePages: before.pages.length,
    afterPages: after.pages.length,
    changed: rows.filter(row => row.change !== 'unchanged').length,
    moved: rows.filter(row => row.moved).length,
    newFindings: after.findings.filter(item => !beforeKeys.has(item.key)),
    resolvedFindings: before.findings.filter(item => !afterKeys.has(item.key)),
    coverReview: before.coverSignature !== after.coverSignature,
  };
}

export async function describeBookProofRevision(approved: ApprovedBookProof,
  current: Awaited<ReturnType<typeof makeBookProof>>, comparison: ReturnType<typeof compareBookProof>) {
  return {
    version: 1,
    approvedAt: approved.approvedAt,
    approvedSha256: approved.sha256,
    currentSha256: await digest(current.bytes),
    ...comparison,
    rows: comparison.rows.map(({ before, after, ...row }) => ({
      ...row,
      before: before === null ? null : approved.pages[before],
      after: after === null ? null : current.snapshot.pages[after],
    })),
    warnings: current.warnings,
  };
}
