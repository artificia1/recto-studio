import { describe, it, expect } from 'vitest';
import { bookEngine, RectoBook } from '../src/engine/bookEngine';
import { ProjectState, Page, Spread, TextElement, ParagraphStyle } from '../src/types';

describe('Multi-Document Book Engine (.rectobook / .indb synchronization)', () => {
  const createMockChapterState = (chapterNum: number, pageCount: number, headingTitle: string): ProjectState => {
    const pages: Page[] = [];
    for (let i = 1; i <= pageCount; i++) {
      pages.push({
        id: `c${chapterNum}-p${i}`,
        pageNumber: i,
        width: 210,
        height: 297,
        margins: { top: 20, bottom: 20, inside: 20, outside: 20 },
        bleed: { top: 3, bottom: 3, inside: 3, outside: 3 },
        slug: { top: 0, bottom: 0, inside: 0, outside: 0 },
        elements: [],
      });
    }

    const headingEl: TextElement = {
      id: `c${chapterNum}-el-h1`,
      type: 'text',
      pageId: `c${chapterNum}-p1`,
      x: 20,
      y: 30,
      width: 150,
      height: 20,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      text: headingTitle,
      fontFamily: 'Inter',
      fontSizePt: 24,
      lineHeight: 1.2,
      letterSpacingPt: 0,
      color: '#000000',
      alignment: 'left',
      columns: 1,
      columnGutterMm: 4,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidthMm: 0,
      paddingMm: 0,
      paragraphStyleId: `style-h1`,
    };

    const spread: Spread = {
      id: `c${chapterNum}-spread-1`,
      pages,
      elements: [headingEl],
    };

    const h1Style: ParagraphStyle = {
      id: `style-h1`,
      name: 'Heading 1',
      fontFamily: 'Inter',
      fontSizePt: 24,
      fontWeight: 'bold',
      fontStyle: 'normal',
      lineHeight: 1.2,
      letterSpacingPt: 0,
      color: '#000000',
      alignment: 'left',
      spaceBeforeMm: 10,
      spaceAfterMm: 5,
      keepWithNext: true,
      hyphenation: false,
      cmykColor: [0, 0, 0, 100],
      pdfTag: 'H1',
    };

    return {
      version: '1.0.0',
      settings: {
        title: `Chapter ${chapterNum}`,
        preset: 'A4',
        widthMm: 210,
        heightMm: 297,
        facingPages: true,
        bleedMm: 3,
        margins: { topMm: 20, bottomMm: 20, insideMm: 20, outsideMm: 20 },
        columnCount: 1,
        columnGutterMm: 4,
        baselineGrid: { enabled: false, incrementPt: 12, startMm: 20 },
        colorMode: 'cmyk',
        iccProfile: 'FOGRA39',
      },
      spreads: [spread],
      paragraphStyles: [h1Style],
      characterStyles: [],
      masterSpreads: [],
      activeSpreadIndex: 0,
      zoom: 1,
      pan: { x: 0, y: 0 },
    };
  };

  it('creates a new Recto Book manifest with default style source', () => {
    const book = bookEngine.createBook('Encyclopedia of Watchmaking', [
      { title: 'Chapter 1: Escapements', filePath: '/docs/ch1.recto', forceRectoOpening: true },
      { title: 'Chapter 2: Mainsprings', filePath: '/docs/ch2.recto', forceRectoOpening: true },
    ]);

    expect(book.title).toBe('Encyclopedia of Watchmaking');
    expect(book.chapters.length).toBe(2);
    expect(book.chapters[0].title).toBe('Chapter 1: Escapements');
    expect(book.styleSourceChapterId).toBe(book.chapters[0].id);
    expect(book.colorMode).toBe('cmyk');
  });

  it('dynamically repaginates chapters with forceRectoOpening odd-page enforcement', () => {
    const book = bookEngine.createBook('Chronometry', [
      { title: 'Chapter 1', filePath: 'ch1.recto', forceRectoOpening: true },
      { title: 'Chapter 2', filePath: 'ch2.recto', forceRectoOpening: true },
      { title: 'Appendix', filePath: 'app.recto', forceRectoOpening: false },
    ]);

    const mockStates: Record<string, ProjectState> = {
      'ch1.recto': createMockChapterState(1, 3, 'Chapter 1: Escapements'), // 3 pages: 1, 2, 3
      'ch2.recto': createMockChapterState(2, 2, 'Chapter 2: Mainsprings'), // 2 pages
      'app.recto': createMockChapterState(3, 1, 'Appendix: Tools'),        // 1 page
    };

    const repaginated = bookEngine.repaginateBook(book, (path) => mockStates[path]);

    // Chapter 1 starts on page 1 and has 3 pages (1, 2, 3)
    expect(repaginated.chapters[0].startPageNumber).toBe(1);
    expect(repaginated.chapters[0].pageCount).toBe(3);

    // Chapter 2 has forceRectoOpening. Page 4 would be Verso (even), so it must bump to page 5 (Recto)
    expect(repaginated.chapters[1].startPageNumber).toBe(5);
    expect(repaginated.chapters[1].pageCount).toBe(2); // covers 5 and 6

    // Appendix does NOT force recto opening, so next page is 7 (odd anyway)
    expect(repaginated.chapters[2].startPageNumber).toBe(7);
    expect(repaginated.chapters[2].pageCount).toBe(1);
  });

  it('synchronizes paragraph styles and master spreads across all book chapters', () => {
    const book = bookEngine.createBook('Typography Masterclass', [
      { title: 'Chapter 1', filePath: 'ch1.recto' },
      { title: 'Chapter 2', filePath: 'ch2.recto' },
    ]);

    const mockStates: Record<string, ProjectState> = {
      'ch1.recto': createMockChapterState(1, 2, 'Title 1'),
      'ch2.recto': createMockChapterState(2, 2, 'Title 2'),
    };

    // Add a custom style to Chapter 1 (Style Source)
    mockStates['ch1.recto'].paragraphStyles.push({
      id: 'body-editorial',
      name: 'Editorial Body',
      fontFamily: 'Minion Pro',
      fontSizePt: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      lineHeight: 1.35,
      letterSpacingPt: 0,
      color: '#000000',
      alignment: 'justify',
      spaceBeforeMm: 0,
      spaceAfterMm: 3,
      hyphenation: true,
      cmykColor: [0, 0, 0, 100],
      pdfTag: 'P',
    });

    const result = bookEngine.syncBookStyles(
      book,
      (path) => mockStates[path],
      (path, newState) => {
        mockStates[path] = newState;
      }
    );

    expect(result.syncedChaptersCount).toBe(1);
    expect(mockStates['ch2.recto'].paragraphStyles.some((s) => s.id === 'body-editorial')).toBe(true);
  });

  it('generates unified cross-document Table of Contents with correct absolute book pagination', () => {
    const book = bookEngine.createBook('Horology', [
      { title: 'Ch 1', filePath: 'ch1.recto', forceRectoOpening: true },
      { title: 'Ch 2', filePath: 'ch2.recto', forceRectoOpening: true },
    ]);

    const mockStates: Record<string, ProjectState> = {
      'ch1.recto': createMockChapterState(1, 3, 'The Balance Wheel'),
      'ch2.recto': createMockChapterState(2, 2, 'The Tourbillon'),
    };

    const toc = bookEngine.generateUnifiedBookToc(book, (path) => mockStates[path]);

    expect(toc.length).toBe(2);
    expect(toc[0].title).toBe('The Balance Wheel');
    expect(toc[0].pageNumber).toBe(1);
    expect(toc[1].title).toBe('The Tourbillon');
    // Because ch1 has 3 pages (1, 2, 3), Ch 2 starts on recto page 5!
    expect(toc[1].pageNumber).toBe(5);
  });

  it('compiles multi-chapter publication into a single stitched master PDF', async () => {
    const book = bookEngine.createBook('Publication', [
      { title: 'Ch 1', filePath: 'ch1.recto', forceRectoOpening: true },
      { title: 'Ch 2', filePath: 'ch2.recto', forceRectoOpening: true },
    ]);

    const mockStates: Record<string, ProjectState> = {
      'ch1.recto': createMockChapterState(1, 2, 'Chapter 1'),
      'ch2.recto': createMockChapterState(2, 2, 'Chapter 2'),
    };

    const pdfDoc = await bookEngine.exportBookToPdf(book, (path) => mockStates[path]);
    expect(pdfDoc).toBeDefined();
    const totalPages = (pdfDoc.internal as any).getNumberOfPages();
    expect(totalPages).toBeGreaterThanOrEqual(3);
  });
});
