import { assembleBook } from '../../src/engine/bookAssembly';
import { readBookArchive } from '../../src/engine/bookArchive';
import { bookCoverDimensions } from '../../src/engine/bookDelivery';
import { limits, sha256, type PublishingWorkspace } from './workspace';
import { validatePublishingProject } from './publication';

export async function loadBook(workspace: PublishingWorkspace, file: string, expected?: string) {
  const bytes = await workspace.read(file, ['.rectobook'], limits.project);
  const revision = sha256(bytes);
  if (expected && revision !== expected) throw new Error('The book archive changed. Inspect it again before exporting.');
  const archive = readBookArchive(bytes.toString('utf8'), text => validatePublishingProject(Buffer.from(text)));
  const snapshots = new Map(archive.chapters.map(chapter => [chapter.id, chapter.state]));
  const chapters = archive.chapters.map(chapter => ({ id: chapter.id, filePath: chapter.id,
    title: chapter.state.settings.title || chapter.name, forceRectoOpening: chapter.recto,
    pageCount: chapter.state.spreads.reduce((sum, spread) => sum + spread.pages.length, 0), startPageNumber: 1 }));
  if (chapters.reduce((sum, chapter) => sum + chapter.pageCount, 0) > limits.pages) {
    throw new Error('This server supports books up to 500 pages.');
  }
  const source = assembleBook({ title: archive.title, styleSourceChapterId: chapters[0]?.id || '', chapters,
    references: archive.references }, id => snapshots.get(id)!);
  const pageCount = source.spreads.reduce((sum, spread) => sum + spread.pages.length, 0);
  if (pageCount > limits.pages) throw new Error('This server supports books up to 500 pages including inserted blanks.');
  const dimensions = archive.delivery && bookCoverDimensions(source.settings, pageCount, archive.delivery);
  return { file, source, revision, report: { title: archive.title, pageCount, chapters,
    blankPages: pageCount - chapters.reduce((sum, chapter) => sum + chapter.pageCount, 0),
    cover: dimensions ? { ...dimensions, approved: archive.delivery?.approvedDimensions === dimensions.signature } : null,
  } };
}

export async function confirmBookRevision(workspace: PublishingWorkspace, file: string, expected: string) {
  if (sha256(await workspace.read(file, ['.rectobook'], limits.project)) !== expected) {
    throw new Error('The book archive changed. Inspect it again before exporting.');
  }
}
