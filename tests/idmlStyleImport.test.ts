import { describe, expect, it } from 'vitest';
import { parseIdmlPackage } from '../src/idmlImport';
import { inDesignBook } from './fixtures/inDesignBook';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import type { TextElement, VectorPathElement } from '../src/types';

describe('InDesign styles on import', () => {
  it('inherits from the [No paragraph style] root that BasedOn names without its prefix', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const text = project.paragraphStyles.find(style => style.name === 'Text')!;
    expect(text.fontSizePt).toBe(12);
    expect(text.fontFamily).toBe('Arial');
    expect(text.alignment).toBe('justify');
  });

  it('keeps every justified variant justified, whichever side its last line goes to', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const named = (name: string) => project.paragraphStyles.find(style => style.name === name)!;
    // "RightJustified" is justified text with its last line set right, not right-aligned text.
    expect(named('Text Hebrew').alignment).toBe('justify');
    expect(named('Text').alignment).toBe('justify');
    expect(named('Рассказ').alignment).toBe('center');
  });

  it('reads Auto leading as the percentage InDesign uses, 120 unless the style sets another', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const named = (name: string) => project.paragraphStyles.find(style => style.name === name)!;
    expect(named('Рассказ').lineHeight).toBe(1.2);
    expect(named('Text').lineHeight).toBe(1.3);
    expect(named('На сетке').lineHeight).toBe(1.17);
  });

  it('snaps to the baseline grid only the styles set to align to it', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const snapping = project.paragraphStyles.filter(style => style.id.startsWith('idml-')).map(style => [style.name, style.snapToBaseline]);
    expect(Object.fromEntries(snapping)).toEqual({ '[Basic Paragraph]': false, Text: false, 'Рассказ': false, 'Подзаголовок': false,
      'Эпиграф Подпись': false, 'Text Hebrew': false, 'На сетке': true });
  });

  it('carries the font style and tracking of a paragraph style', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const named = (name: string) => project.paragraphStyles.find(style => style.name === name)!;
    expect(named('Рассказ')).toMatchObject({ bold: true, letterSpacingPt: 0.9 });
    expect(named('Рассказ').italic).toBeUndefined();
    expect(named('Подзаголовок')).toMatchObject({ bold: true, italic: true, fontSizePt: 13, alignment: 'center' });
    expect(named('Text').bold).toBeUndefined();
  });

  it('imports [Basic Paragraph] as a style the text using it keeps', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const basic = project.paragraphStyles.find(style => style.name === '[Basic Paragraph]')!;
    expect(basic.fontFamily).toBe('Arial');
    const imprint = project.spreads[0].elements.find(element => element.id === 'idml-imprint') as TextElement;
    expect(imprint.storyContent?.paragraphs[0].styleId).toBe(basic.id);
  });

  it('keeps an alignment set on the paragraph over its style\'s', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const imprint = project.spreads[0].elements.find(element => element.id === 'idml-imprint') as TextElement;
    const [plain, plate] = imprint.storyContent!.paragraphs;
    expect(plain.formatting?.alignment).toBeUndefined();
    expect(plate.formatting?.alignment).toBe('center');
    expect(plate.styleId).toBe(plain.styleId);
  });

  it('finds a style whose name ends in a space', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const source = project.paragraphStyles.find(style => style.name.trim() === 'Эпиграф Подпись')!;
    expect(source).toMatchObject({ fontFamily: 'Arial', fontSizePt: 10, italic: true });
    const chapter = project.spreads[0].elements.find(element => element.id === 'idml-chapter') as TextElement;
    const paragraph = chapter.storyContent!.paragraphs.find(item => item.runs.some(run => run.text.includes('Исход')))!;
    expect(paragraph.styleId).toBe(source.id);
  });

  it('takes the baseline grid from the document', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    expect(project.settings.baselineGrid).toEqual({ enabled: true, incrementPt: 14, startMm: 12.7 });
  });
});

describe('InDesign parents and page items on import', () => {
  it('writes the page number marker as the page token', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const folio = project.masterSpreads.find(master => master.id === 'head')!.elements.find(element => element.type === 'text') as TextElement;
    expect(folio.text.trim()).toBe('Running head {{page}}');
  });

  it('draws lines with the stroke their object style gives them', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const rules = project.masterSpreads.find(master => master.id === 'head')!.elements.filter(element => element.type === 'path') as VectorPathElement[];
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.strokeColor).not.toBe('transparent');
      expect(rule.strokeWidthMm).toBeCloseTo(2 * 25.4 / 72, 3);
    }
  });

  it('keeps a page that uses another parent free of the spread parent\'s items', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const spread = project.spreads[0];
    const master = project.masterSpreads.find(item => item.id === 'head')!;
    // One page uses the empty parent, one the running head: the spread takes the one with artwork…
    expect(spread.masterSpreadId).toBe('head');
    // …and its items for the left page are detached, so only the right page shows the running head.
    const leftItems = master.elements.filter(element => element.pageId === master.pages.find(item => item.side === 'left')!.id).map(element => element.id);
    expect(leftItems.length).toBeGreaterThan(0);
    expect([...(spread.detachedMasterElementIds || [])].sort()).toEqual([...leftItems].sort());
  });
});

/** Text on each page of a PDF exported from an imported project, as PDF.js extracts it. */
async function pdfPageTexts(project: Awaited<ReturnType<typeof parseIdmlPackage>>) {
  const output = await exportDocumentToPdf(project, { download: false });
  const bytes = new Uint8Array(output.output('arraybuffer'));
  const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = engine.getDocument({ data: bytes, useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const texts: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      texts.push(content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' '));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

describe('each page keeps its own parent', () => {
  it('builds a combined parent when both pages\' parents have artwork', async () => {
    const project = await parseIdmlPackage(inDesignBook({ leftParentArtwork: true }), 'book.idml');
    const spread = project.spreads[0];
    const combined = project.masterSpreads.find(master => master.id === spread.masterSpreadId)!;
    expect(combined.name).toBe('A-Parent + B-Running head');
    expect(combined.pages.map(page => page.side)).toEqual(['left', 'right']);
    const onPage = (side: 'left' | 'right') => combined.elements
      .filter(element => element.pageId === combined.pages.find(page => page.side === side)!.id)
      .map(element => element.type === 'text' ? (element as TextElement).text.trim() : element.type);
    expect(onPage('left')).toEqual(['Parent A mark']);
    expect(onPage('right').sort()).toEqual(['Running head {{page}}', 'path'].sort());
    expect(spread.detachedMasterElementIds ?? []).toEqual([]);
    // The parents themselves are unchanged and still available.
    expect(project.masterSpreads.map(master => master.id)).toEqual(expect.arrayContaining(['empty', 'head']));
  });

  it('carries each page\'s parent artwork into the exported PDF', async () => {
    const project = await parseIdmlPackage(inDesignBook({ leftParentArtwork: true }), 'book.idml');
    const [left, right] = await pdfPageTexts(project);
    expect(left).toContain('Parent A mark');
    expect(left).not.toContain('Running head');
    expect(right).toContain('Running head 2');
    expect(right).not.toContain('Parent A mark');
  }, 60000);

  it('leaves a page whose parent is empty without the other parent\'s artwork in the PDF', async () => {
    const project = await parseIdmlPackage(inDesignBook(), 'book.idml');
    const [left, right] = await pdfPageTexts(project);
    expect(left).not.toContain('Running head');
    expect(left).toContain('Imprint');
    expect(right).toContain('Running head 2');
  }, 60000);
});
