import type { ProjectState } from '../types';
import { bookReferenceKey, type BookReference } from './bookReferences';
import { readBookDelivery } from './bookDelivery';

export interface ArchivedChapter { id: string; name: string; state: ProjectState; recto: boolean }

export function readBookArchive(text: string, parseChapter: (text: string) => ProjectState) {
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
  return { title: saved.title as string, chapters, references, delivery };
}
