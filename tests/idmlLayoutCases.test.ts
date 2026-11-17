import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIdmlPackage } from '../src/idmlImport';
import type { TextElement } from '../src/types';
import { FRAME_LEFT_PT, LAYOUT_CASES, REFERENCE, inDesignLayoutCases } from './fixtures/inDesignLayoutCases';

const textFrames = (project: Awaited<ReturnType<typeof parseIdmlPackage>>) =>
  project.spreads.flatMap(spread => spread.elements).filter((element): element is TextElement => element.type === 'text');

describe('InDesign layout cases: the code-built package', () => {
  it('imports as one page and one text frame per case', async () => {
    const project = await parseIdmlPackage(inDesignLayoutCases(), 'layout-cases.idml');
    const frames = textFrames(project);
    for (const layoutCase of Object.values(LAYOUT_CASES)) {
      expect(frames.map(frame => frame.id), layoutCase.title).toContain(layoutCase.frameId);
    }
    const byId = (id: string) => frames.find(frame => frame.id === id)!;
    expect(byId('idml-tabs').text).toContain('Редакторская группа:\tИмя Фамилия\n\tИмя Фамилия');
    expect(byId('idml-contents').text).toContain('Название рассказа\t5');
    // Caps are a style property: the story keeps the text as typed.
    expect(byId('idml-caps').text).toBe('Название рассказа\nНазвание книги');
    expect(byId('idml-first-line')).toMatchObject({ x: 20, y: 27, width: 120, height: 166, paddingMm: 0 });
  });
});

describe('InDesign layout cases: the reference document', () => {
  it('imports with a text frame on every case page', async () => {
    const project = await parseIdmlPackage(new Uint8Array(readFileSync(REFERENCE.idml)), 'layout-cases.idml');
    const pages = project.spreads.flatMap(spread => spread.pages);
    expect(pages.map(page => page.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const frames = textFrames(project);
    for (const layoutCase of Object.values(LAYOUT_CASES)) {
      const page = pages.find(item => item.pageNumber === layoutCase.page)!;
      expect(frames.some(frame => frame.pageId === page.id), layoutCase.title).toBe(true);
    }
    // All Caps never rewrites the text: the story keeps what was typed.
    const caps = frames.find(frame => frame.pageId === pages[LAYOUT_CASES.allCaps.page - 1].id)!;
    expect(caps.text.trim()).toBe(LAYOUT_CASES.allCaps.expect.storyKeeps);
  });

  it('records what the PDF InDesign exported from it shows', async () => {
    const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = engine.getDocument({ data: new Uint8Array(readFileSync(REFERENCE.pdf)), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      expect(pdf.numPages).toBe(9);
      /** Body lines of a page, top first: baseline, left edge from the frame, text, right edge from the frame. */
      const lines = async (pageNumber: number) => {
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        const rows = new Map<number, { x: number; right: number; text: string }>();
        for (const item of content.items) {
          if (!('str' in item) || !item.str) continue;
          const [, , , , x, y] = item.transform as number[];
          // Leave out the running head and the folio, which sit above and below the frames.
          if (y > 560 || y < 60) continue;
          const key = Math.round(y * 100) / 100;
          const row = rows.get(key) || { x: Infinity, right: -Infinity, text: '' };
          row.x = Math.min(row.x, x - FRAME_LEFT_PT);
          row.right = Math.max(row.right, x + item.width - FRAME_LEFT_PT);
          row.text += item.str;
          rows.set(key, row);
        }
        return [...rows].sort((a, b) => b[0] - a[0]).map(([baseline, row]) => ({ baseline, ...row }));
      };
      const close = (actual: number, expected: number, what: string) => expect(Math.abs(actual - expected), `${what}: ${actual}`).toBeLessThan(0.06);

      const first = LAYOUT_CASES.firstLineIndent;
      const body = await lines(first.page);
      close(body[0].x, first.expect.firstLineIndentPt, 'first line indent');
      close(body[1].x, first.expect.otherLinesIndentPt, 'second line');
      close(body[0].baseline - body[1].baseline, first.expect.lineAdvancePt, 'line advance');

      const note = (await lines(LAYOUT_CASES.hangingIndent.page)).find(line => line.text.includes('примечание'))!;
      close(note.x, LAYOUT_CASES.hangingIndent.expect.firstLineIndentPt, 'footnote first line');

      const indents = LAYOUT_CASES.leftIndent;
      const [epigraph, ...verse] = await lines(indents.page);
      close(epigraph.x, indents.expect.epigraphIndentPt, 'epigraph');
      for (const line of verse) close(line.x, indents.expect.verseIndentPt, 'verse line');
      close(verse[0].baseline - verse[1].baseline, indents.expect.verseLineAdvancePt, 'verse advance');

      const author = await lines(LAYOUT_CASES.leftAndRightIndent.page);
      close((author[0].x + author[0].right) / 2, (author[1].x + author[1].right) / 2, 'both author lines share a centre');

      const spacing = await lines(LAYOUT_CASES.spaceBeforeAndAfter.page);
      const separator = spacing.findIndex(line => line.text.trim() === '***');
      expect(Math.abs(spacing[separator - 1].baseline - spacing[separator + 1].baseline - LAYOUT_CASES.spaceBeforeAndAfter.expect.baselineToBaselinePt))
        .toBeLessThan(0.1);

      const tabs = LAYOUT_CASES.tabStops;
      const imprint = await lines(tabs.page);
      const names = imprint.filter(line => line.text === 'Имя Фамилия');
      close(names[0].x, tabs.expect.firstColumnPt, 'first block column');
      close(names[names.length - 1].x, tabs.expect.secondColumnPt, 'second block column');
      close(imprint[0].baseline - imprint[1].baseline, tabs.expect.lineAdvancePt, '9 pt advance');
      close(imprint[0].baseline - imprint[1].baseline, LAYOUT_CASES.autoLeadingPerLine.expect.lineAdvancePt, 'auto leading per line');

      const contents = (await lines(LAYOUT_CASES.rightTabWithLeader.page)).filter(line => line.text.includes('....'));
      expect(contents).toHaveLength(2);
      for (const line of contents) close(line.right, LAYOUT_CASES.rightTabWithLeader.expect.pageNumberRightEdgePt, 'page number right edge');

      const capsPage = await (await pdf.getPage(LAYOUT_CASES.allCaps.page)).getTextContent();
      expect(capsPage.items.map(item => 'str' in item ? item.str : '').join('')).toContain(LAYOUT_CASES.allCaps.expect.paragraphStyleShows);
      const oddPage = await (await pdf.getPage(1)).getTextContent();
      expect(oddPage.items.map(item => 'str' in item ? item.str : '')).toContain(LAYOUT_CASES.allCaps.expect.runningHeadShows);
    } finally {
      await task.destroy();
    }
  }, 60000);

  // Recto's own layout of each case, to be checked against the numbers above once the composer supports it.
  for (const layoutCase of Object.values(LAYOUT_CASES)) it.todo(`lays out ${layoutCase.title}`);
});
