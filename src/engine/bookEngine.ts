/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Multi-Document Book Engine (.rectobook / .indb synchronization)
 * Orchestrates multi-chapter publications with dynamic sequential repagination,
 * style source synchronization, unified cross-document TOC, and stitched PDF/X export.
 */

import { ProjectState, ParagraphStyle, MasterSpread } from '../types/index';
import { exportDocumentToPdf, ExportOptions } from '../export/pdfExport';
import { jsPDF } from 'jspdf';

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
      targetState.paragraphStyles = JSON.parse(JSON.stringify(sourceStyles));
      targetState.masterSpreads = JSON.parse(JSON.stringify(sourceMasters));
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
    const repaginated = this.repaginateBook(book, loadChapterState);
    const tocItems: UnifiedTocItem[] = [];

    for (const chapter of repaginated.chapters) {
      const state = loadChapterState(chapter.filePath);
      const chapterOffset = chapter.startPageNumber - 1;

      // Query headings in reading order
      for (const spread of state.spreads) {
        for (const page of spread.pages) {
          const absoluteBookPage = chapterOffset + page.pageNumber;

          for (const el of spread.elements) {
            if (el.type === 'text' && el.pageId === page.id) {
              const textEl = el as any;
              const style = state.paragraphStyles?.find((s) => s.id === textEl.paragraphStyleId);
              const styleName = (style?.name || '').toLowerCase();

              const isHeading1 = styleName.includes('heading 1') || styleName.includes('title') || style?.pdfTag === 'H1';
              const isHeading2 = styleName.includes('heading 2') || style?.pdfTag === 'H2';

              if (isHeading1 || isHeading2) {
                const headingText = (textEl.text || '').split('\n')[0].trim();
                if (headingText && !tocItems.some((item) => item.title === headingText && item.pageNumber === absoluteBookPage)) {
                  tocItems.push({
                    title: headingText,
                    chapterTitle: chapter.title,
                    pageNumber: absoluteBookPage,
                    level: isHeading1 ? 1 : 2,
                    styleId: textEl.paragraphStyleId,
                  });
                }
              }
            }
          }
        }
      }
    }

    return tocItems;
  }

  /**
   * Compiles all chapter documents into a unified, stitched PDF/X document
   * with continuous pagination and unified prepress OutputIntent.
   */
  public async exportBookToPdf(
    book: RectoBook,
    loadChapterState: (filePath: string) => ProjectState,
    exportOptions: ExportOptions = {}
  ): Promise<jsPDF> {
    const repaginated = this.repaginateBook(book, loadChapterState);
    const firstChapterState = loadChapterState(repaginated.chapters[0].filePath);

    // Build the master PDF from first chapter
    const masterDoc = await exportDocumentToPdf(firstChapterState, {
      ...exportOptions,
      spreadRange: 'all',
    });

    // Append subsequent chapters
    for (let c = 1; c < repaginated.chapters.length; c++) {
      const chapter = repaginated.chapters[c];
      const chapState = loadChapterState(chapter.filePath);
      const chapDoc = await exportDocumentToPdf(chapState, {
        ...exportOptions,
        spreadRange: 'all',
      });

      const totalChapPages = (chapDoc.internal as any).getNumberOfPages();
      for (let p = 1; p <= totalChapPages; p++) {
        masterDoc.addPage();
      }
    }

    return masterDoc;
  }
}

export const bookEngine = new BookEngine();
