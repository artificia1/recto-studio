import { assembleArchivedBook, readBookArchive, type BookArchive } from '../../src/engine/bookArchive';
import { bookCoverDimensions } from '../../src/engine/bookDelivery';
import { limits, sha256, type PublishingWorkspace } from './workspace';
import { validatePublishingProject } from './publication';
import type { ProjectState } from '../../src/types';

const archiveLimit = 128 * 1024 * 1024;

export async function loadBook(workspace: PublishingWorkspace, file: string, expected?: string) {
  const bytes = await workspace.read(file, ['.rectobook'], archiveLimit);
  const revision = sha256(bytes);
  if (expected && revision !== expected) throw new Error('The book archive changed. Inspect it again before exporting.');
  const archive = readBookArchive(bytes.toString('utf8'), text => validatePublishingProject(Buffer.from(text)));
  const assembled = assembleForReview(archive);
  const { source, chapters, pages } = assembled;
  const pageCount = pages.length;
  const dimensions = archive.delivery && bookCoverDimensions(source.settings, pageCount, archive.delivery);
  return { file, source, revision, archive, pages, delivery: archive.delivery, report: { title: archive.title, pageCount, chapters,
    blankPages: pages.filter(page => !page.pageId).length,
    approvedProof: archive.proof ? { approvedAt: archive.proof.approvedAt, pages: archive.proof.pages.length } : null,
    cover: dimensions ? { ...dimensions, approved: archive.delivery?.approvedDimensions === dimensions.signature } : null,
  } };
}

function assembleForReview(archive: BookArchive) {
  const inputPages = archive.chapters.reduce((sum, chapter) => sum + chapter.state.spreads.reduce((count, spread) => count + spread.pages.length, 0), 0);
  if (inputPages > limits.pages) {
    throw new Error('This server supports books up to 500 pages.');
  }
  const book = assembleArchivedBook(archive);
  if (book.pages.length > limits.pages) throw new Error('This server supports books up to 500 pages including inserted blanks.');
  return book;
}

export function replaceBookProofChapter(archive: BookArchive, id: string, source: ProjectState, revised: ProjectState) {
  const chapter = archive.chapters.find(item => item.id === id);
  if (!chapter) throw new Error('Choose a chapter ID from this book archive.');
  const ids = new Set(chapter.state.spreads.flatMap(spread => spread.pages.map(page => page.id)));
  if (!source.spreads.some(spread => spread.pages.some(page => ids.has(page.id)))) {
    throw new Error('The edit preview does not share page IDs with the selected chapter.');
  }
  return assembleForReview({ ...archive, chapters: archive.chapters.map(item => item.id === id ? { ...item, state: revised } : item) });
}

export async function confirmBookRevision(workspace: PublishingWorkspace, file: string, expected: string) {
  if (sha256(await workspace.read(file, ['.rectobook'], archiveLimit)) !== expected) {
    throw new Error('The book archive changed. Inspect it again before exporting.');
  }
}
