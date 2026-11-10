/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Multi-document book engine (.rectobook).
 * Orchestrates multi-chapter publications with dynamic sequential repagination,
 * style synchronization, unified contents and ordinary PDF export.
 */

import { ProjectState, ParagraphStyle, MasterSpread } from '../types/index';
import { exportDocumentToPdf, ExportOptions } from '../export/pdfExport';
import { jsPDF } from 'jspdf';
import { assembleBook } from './bookAssembly';
import { publicationHeadings } from './publicationReferences';
import type { BookReference } from './bookReferences';

export interface BookChapter {
  id: string;
  title: string;
  filePath: string;
  pageCount: number;
  startPageNumber: number;
  forceRectoOpening?: boolean;
}

export interface RectoBook {
  title: string;
  styleSourceChapterId: string;
  chapters: BookChapter[];
  references?: BookReference[];
  colorMode?: 'cmyk' | 'rgb';
  iccProfile?: string;
}

export interface UnifiedTocItem {
  title: string;
  chapterTitle: string;
  pageNumber: number;
  level: number;
  styleId?: string;
}

export class BookEngine {
  /**
   * Initializes a new Recto Book manifest.
   */
  public createBook(
    title: string,
    chapters: { title: string; filePath: string; forceRectoOpening?: boolean }[]
  ): RectoBook {
    const bookChapters: BookChapter[] = chapters.map((c, idx) => ({
      id: `chap-${idx + 1}-${Date.now()}`,
      title: c.title,
      filePath: c.filePath,
      pageCount: 1,
      startPageNumber: 1,
      forceRectoOpening: c.forceRectoOpening !== false,
    }));

    return {
      title,
      styleSourceChapterId: bookChapters[0]?.id || '',
      chapters: bookChapters,
      colorMode: 'cmyk',
      iccProfile: 'FOGRA39',
    };
  }

  /**
   * Dynamically repaginates all chapters across the book manifest.
   * If a chapter specifies forceRectoOpening, starts on an odd (right-hand) page.
   */
  public repaginateBook(
    book: RectoBook,
    loadChapterState: (filePath: string) => ProjectState
  ): RectoBook {
    let currentPage = 1;

    for (const chapter of book.chapters) {
      if (chapter.forceRectoOpening && currentPage % 2 === 0) {
        // Verso/left page: advance to next Recto/right page (odd number)
        currentPage += 1;
      }

      chapter.startPageNumber = currentPage;
      const state = loadChapterState(chapter.filePath);

      let totalPagesInChapter = 0;
      for (const spread of state.spreads) {
        totalPagesInChapter += spread.pages.length;
      }
      chapter.pageCount = Math.max(1, totalPagesInChapter);
      currentPage += chapter.pageCount;
    }

    return book;
  }

  /**
   * Synchronizes typography styles, swatches, and master spreads
   * from the designated Style Source chapter into all other chapters.
   */
  public syncBookStyles(
    book: RectoBook,
    loadChapterState: (filePath: string) => ProjectState,
    saveChapterState: (filePath: string, state: ProjectState) => void
  ): { syncedChaptersCount: number; syncedStyleCount: number } {
    const sourceChapter = book.chapters.find((c) => c.id === book.styleSourceChapterId) || book.chapters[0];
    if (!sourceChapter) {
      return { syncedChaptersCount: 0, syncedStyleCount: 0 };
    }

    const sourceState = loadChapterState(sourceChapter.filePath);
    const sourceStyles: ParagraphStyle[] = JSON.parse(JSON.stringify(sourceState.paragraphStyles || []));
    const sourceMasters: MasterSpread[] = JSON.parse(JSON.stringify(sourceState.masterSpreads || []));

    let syncedChaptersCount = 0;

    for (const chapter of book.chapters) {
      if (chapter.id === sourceChapter.id) continue;

      const targetState = loadChapterState(chapter.filePath);
      targetState.paragraphStyles = [...targetState.paragraphStyles.filter(style => !sourceStyles.some(source => source.id === style.id)), ...structuredClone(sourceStyles)];
      targetState.masterSpreads = [...targetState.masterSpreads.filter(master => !sourceMasters.some(source => source.id === master.id)), ...structuredClone(sourceMasters)];
      targetState.characterStyles = [...(targetState.characterStyles || []).filter(style => !sourceState.characterStyles?.some(source => source.id === style.id)), ...structuredClone(sourceState.characterStyles || [])];
      targetState.layers = [...(targetState.layers || []).filter(layer => !sourceState.layers?.some(source => source.id === layer.id)), ...structuredClone(sourceState.layers || [])];
      targetState.settings.colorMode = sourceState.settings.colorMode;
      targetState.settings.iccProfile = sourceState.settings.iccProfile;

      saveChapterState(chapter.filePath, targetState);
      syncedChaptersCount++;
    }

    return {
      syncedChaptersCount,
      syncedStyleCount: sourceStyles.length,
    };
  }

  /**
   * Generates a unified, cross-document Table of Contents querying headings across all chapters.
   */
  public generateUnifiedBookToc(
    book: RectoBook,
    loadChapterState: (filePath: string) => ProjectState
  ): UnifiedTocItem[] {
    if (book.references) {
      const combined = assembleBook(book, loadChapterState);
      return publicationHeadings(combined).map(heading => ({
        title: heading.title, level: heading.level, pageNumber: heading.pageNumber,
        chapterTitle: book.chapters.findLast(chapter => chapter.startPageNumber <= heading.pageNumber)?.title || '',
      }));
    }
    const repaginated = this.repaginateBook(book, loadChapterState);
    const tocItems: UnifiedTocItem[] = [];

    for (const chapter of repaginated.chapters) {
      const state = loadChapterState(chapter.filePath);
      const chapterOffset = chapter.startPageNumber - 1;

      /* Query composed manuscript headings, including headings inside a threaded story. */
      const pages = state.spreads.flatMap(spread => spread.pages);
      for (const heading of publicationHeadings(state)) tocItems.push({ title: heading.title, chapterTitle: chapter.title,
        pageNumber: chapterOffset + pages.findIndex(page => page.id === heading.pageId) + 1, level: heading.level });
    }

    return tocItems;
  }

  /**
   * Renders chapter artwork into one ordinary PDF with continuous pagination.
   */
  public async exportBookToPdf(
    book: RectoBook,
    loadChapterState: (filePath: string) => ProjectState,
    exportOptions: ExportOptions = {}
  ): Promise<jsPDF> {
    return exportDocumentToPdf(assembleBook(book, loadChapterState), { ...exportOptions, spreadRange: 'all' });
  }
}

export const bookEngine = new BookEngine();
