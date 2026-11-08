import type { ProjectState } from '../types';
import type { RectoBook } from './bookEngine';

/** Assemble editable chapter snapshots before rendering; never copy empty PDF pages. */
export function assembleBook(book: RectoBook, load: (path: string) => ProjectState): ProjectState {
  if (!book.chapters.length) throw new Error('Add at least one chapter to the book.');
  const chapters = book.chapters.map(chapter => structuredClone(load(chapter.filePath)));
  const output = structuredClone(chapters[0]);
  output.spreads = []; output.masterSpreads = []; output.paragraphStyles = [];
  output.characterStyles = []; output.layers = []; output.embeddedFonts = [];
  output.crossReferences = []; output.indexEntries = []; output.conditions = []; output.objectStyles = [];
  output.settings.footnotes = []; output.comments = []; output.storyRevisions = [];
  output.settings.title = book.title;
  output.selectedElementId = null; output.selectedElementIds = []; output.activeSpreadIndex = 0;
  let pageNumber = 1;
  chapters.forEach((original, index) => {
    if (original.settings.widthMm !== output.settings.widthMm || original.settings.heightMm !== output.settings.heightMm || original.settings.bleedMm !== output.settings.bleedMm) {
      throw new Error('Book chapters must use the same page size and bleed.');
    }
    const ids = new Map<string, string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.id === 'string') ids.set(record.id, `book-${index}-${record.id}`);
        Object.values(record).forEach(collect);
      }
    };
    collect(original);
    const remap = (value: unknown, key = ''): unknown => {
      if (Array.isArray(value)) return value.map(item => remap(item, key));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, k)]));
      if (typeof value !== 'string') return value;
      if (key === 'id' || /Id$|Ids$/.test(key)) return ids.get(value) || value;
      if (['text', 'rawStoryText'].includes(key)) return value.replace(/\{xref:([^}]+)\}/g, (_, id: string) => `{xref:${ids.get(id) || id}}`);
      return value;
    };
    const state = remap(original) as ProjectState;
    const chapter = book.chapters[index];
    if (chapter.forceRectoOpening && pageNumber % 2 === 0) {
      output.spreads.push({ id: `book-blank-${index}`, spreadIndex: output.spreads.length, elements: [], pages: [{ id: `book-blank-page-${index}`, pageNumber: pageNumber++, side: 'left' }] });
    }
    chapter.startPageNumber = pageNumber;
    chapter.pageCount = state.spreads.reduce((count, spread) => count + spread.pages.length, 0);
    let first = true;
    for (const spread of state.spreads) {
      spread.spreadIndex = output.spreads.length;
      for (const page of spread.pages) {
        page.pageNumber = pageNumber++;
        // A single page can be placed on its physical book side; paired spreads retain geometry.
        if (spread.pages.length === 1) page.side = page.pageNumber % 2 ? 'right' : 'left';
        if (first) { page.section = { title: chapter.title, startNumber: page.pageNumber, numbering: 'arabic', prefix: '' }; first = false; }
      }
      output.spreads.push(spread);
    }
    output.paragraphStyles.push(...state.paragraphStyles);
    output.masterSpreads.push(...state.masterSpreads);
    output.layers.push(...(state.layers || []));
    output.characterStyles!.push(...(state.characterStyles || []));
    output.settings.footnotes!.push(...(state.settings.footnotes || []));
    output.crossReferences!.push(...(state.crossReferences || []));
    output.indexEntries!.push(...(state.indexEntries || []));
    output.conditions!.push(...(state.conditions || []));
    output.objectStyles!.push(...(state.objectStyles || []));
    output.storyRevisions!.push(...(state.storyRevisions || []));
    for (const font of state.embeddedFonts || []) {
      const existing = output.embeddedFonts!.find(item => item.family === font.family);
      if (existing && (existing.data !== font.data || JSON.stringify(existing.variations || {}) !== JSON.stringify(font.variations || {}))) throw new Error(`Chapters contain different font files or instances named ${font.family}. Resolve this conflict before export.`);
      if (!existing) output.embeddedFonts!.push(font);
    }
  });
  output.activeLayerId = output.layers[0]?.id || '';
  return output;
}
