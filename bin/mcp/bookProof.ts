import { approvedProofPayload, compareBookProof, describeBookProofRevision, makeBookProof, type ApprovedBookProof } from '../../src/engine/bookProof';
import { fontManager } from '../../src/fontManager';
import { openProof } from './proof';
import { loadBook, replaceBookProofChapter } from './book';
import { loadProject } from './publication';
import type { PublishingWorkspace } from './workspace';
import type { DraftPlans } from './plans';

type BookReviewArgs = { book: string; revision?: string; chapterId?: string; planId?: string };

async function currentBook(workspace: PublishingWorkspace, plans: DraftPlans, args: BookReviewArgs) {
  const book = await loadBook(workspace, args.book, args.revision);
  if (!args.planId || !args.chapterId) return book;
  const plan = await plans.preview(workspace, args.planId);
  const base = await loadProject(workspace, plan.file, plan.revision);
  return { ...book, ...replaceBookProofChapter(book.archive, args.chapterId, base.source, plan.source) };
}

function requireProof(proof?: ApprovedBookProof) {
  if (!proof) throw new Error('Open the book in Recto, approve a proof, and save the book archive first.');
  return proof;
}

export async function reviewBook(workspace: PublishingWorkspace, plans: DraftPlans, args: BookReviewArgs) {
  const book = await currentBook(workspace, plans, args);
  const approved = requireProof(book.archive.proof);
  const current = await fontManager.withProjectFonts(book.source.embeddedFonts, () => makeBookProof(book.source, book.pages, book.delivery));
  const before = await openProof(await approvedProofPayload(approved));
  let after: Awaited<ReturnType<typeof openProof>> | undefined;
  try {
    after = await openProof(current.payload);
    const report = compareBookProof(approved, current.snapshot, await before.scan(), await after.scan());
    return { revision: book.revision, ...await describeBookProofRevision(approved, current, report), warnings: current.warnings.slice(0, 30) };
  } finally { await after?.destroy(); await before.destroy(); }
}

export async function renderBookProofPage(workspace: PublishingWorkspace, plans: DraftPlans, args: BookReviewArgs & {
  edition: 'approved' | 'current'; page: number; maxEdge: number;
}) {
  const book = await currentBook(workspace, plans, args);
  const proof = args.edition === 'approved' ? requireProof(book.archive.proof) : undefined;
  const page = (proof?.pages || book.pages)[args.page - 1];
  if (!page) throw new Error('The requested page is missing from this edition.');
  const bytes = proof ? await approvedProofPayload(proof) :
    (await fontManager.withProjectFonts(book.source.embeddedFonts, () => makeBookProof(book.source, book.pages, book.delivery))).payload;
  const renderer = await openProof(bytes);
  try {
    if (renderer.length !== (proof?.pages || book.pages).length) throw new Error('The proof page map does not match its PDF.');
    const png = await renderer.png([args.page - 1], args.maxEdge);
    const image = png.bytes.length <= 3 * 1024 * 1024 ? png : await renderer.png([args.page - 1], 1024);
    return { ...image, page, edition: args.edition, revision: book.revision };
  } finally { await renderer.destroy(); }
}
