import type { ProjectState } from '../types';
import { bookReferenceKey, type BookReference } from './bookReferences';
import { readBookDelivery, type BookDeliveryRecipe } from './bookDelivery';
import { assembleBook } from './bookAssembly';
import { readApprovedBookProof, type ApprovedBookProof, type BookProofPage } from './bookProof';
import type { RectoBook } from './bookEngine';

export interface ArchivedChapter { id: string; name: string; state: ProjectState; recto: boolean }
export interface BookArchive {
  title: string;
  chapters: ArchivedChapter[];
  references: BookReference[];
  delivery?: BookDeliveryRecipe;
  proof?: ApprovedBookProof;
}

export function readBookArchive(text: string, parseChapter: (text: string) => ProjectState): BookArchive {
  const saved = JSON.parse(text);
  if (!saved || ![1, 2].includes(saved.version) || typeof saved.title !== 'string' ||
    !Array.isArray(saved.chapters) || saved.chapters.length > 100) throw new Error('Unsupported book archive.');
  const chapters: ArchivedChapter[] = saved.chapters.map((entry: Partial<ArchivedChapter>) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.recto !== 'boolean' ||
      (saved.version === 2 && (typeof entry.id !== 'string' || !entry.id || entry.id.length > 200))) {
      throw new Error('Invalid chapter entry.');
    }
    return { id: entry.id && saved.version === 2 ? entry.id : crypto.randomUUID(), name: entry.name,
      recto: entry.recto, state: parseChapter(JSON.stringify(entry.state)) };
  });
  if (new Set(chapters.map(chapter => chapter.id)).size !== chapters.length) throw new Error('Book chapter IDs must be unique.');
  const references: BookReference[] = saved.version === 2 ? saved.references ?? [] : [];
  if (!Array.isArray(references) || references.length > 1000 ||
    references.some(ref => !ref || typeof ref.key !== 'string' || !bookReferenceKey.test(ref.key) ||
      typeof ref.chapterId !== 'string' || typeof ref.elementId !== 'string' || !ref.elementId ||
      (ref.paragraphId !== undefined && typeof ref.paragraphId !== 'string') || !['page', 'title', 'caption'].includes(ref.format)) ||
    new Set(references.map(ref => ref.key)).size !== references.length) throw new Error('Invalid book reference list.');
  const delivery = saved.version === 2 && saved.delivery !== undefined ? readBookDelivery(saved.delivery, parseChapter) : undefined;
  const proof = saved.version === 2 && saved.proof !== undefined ? readApprovedBookProof(saved.proof) : undefined;
  return { title: saved.title, chapters, references, delivery, proof };
}

export function assembleArchivedBook(archive: BookArchive) {
  const snapshots = new Map(archive.chapters.map(chapter => [chapter.id, chapter.state]));
  const manifest: RectoBook = { title: archive.title, styleSourceChapterId: archive.chapters[0]?.id || '', references: archive.references,
    chapters: archive.chapters.map(chapter => ({ id: chapter.id, filePath: chapter.id, title: chapter.state.settings.title || chapter.name,
      forceRectoOpening: chapter.recto, startPageNumber: 1, pageCount: 0 })) };
  const source = assembleBook(manifest, id => snapshots.get(id)!);
  const pages: BookProofPage[] = [];
  for (const chapter of manifest.chapters) {
    const chapterId = chapter.id, chapterTitle = chapter.title;
    if (chapter.startPageNumber > pages.length + 1) {
      pages.push({ key: JSON.stringify([chapterId, null]), chapterId, chapterTitle, pageNumber: pages.length + 1 });
    }
    for (const spread of snapshots.get(chapter.id)!.spreads) for (const page of spread.pages) {
      pages.push({ key: JSON.stringify([chapterId, page.id]), chapterId, chapterTitle, pageId: page.id, spreadId: spread.id,
        pageNumber: pages.length + 1 });
    }
  }
  return { source, chapters: manifest.chapters, pages };
}
