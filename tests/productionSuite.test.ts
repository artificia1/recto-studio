import { beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import type { TextElement } from '../src/types';
import { assembleBook } from '../src/engine/bookAssembly';
import { bookEngine } from '../src/engine/bookEngine';
import { parseProject } from '../src/state/projectValidation';
import { parseCsv, parseMergeData, generateMergedSpreads } from '../src/dataMerge';
import { parseTableData } from '../src/engine/delimitedText';
import { calculateImageFitting } from '../src/canvas';
import { storyText } from '../src/engine/storyContent';
import { exportDocumentToIdml } from '../src/export/idmlExport';
import { parseIdmlPackage } from '../src/idmlImport';
import { createZipArchive } from '../src/zip';
import { mergeTableCellRight, tableCellSpan, tableThread } from '../src/engine/tableCells';
import { tableEngine } from '../src/engine/tableEngine';

describe('publication production workflows', () => {
  let manager: StateManager;
  const text = (id: string, value: string, width = 170, height = 240): TextElement => ({ id, type: 'text', pageId: manager.getActiveSpread().pages[0].id,
    x: 20, y: 20, width, height, rotation: 0, opacity: 1, zIndex: 1, locked: false, text: value,
    fontFamily: 'Times', fontSizePt: 12, lineHeight: 1.3, letterSpacingPt: 0, color: '#000000', alignment: 'left',
    columns: 1, columnGutterMm: 4, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paddingMm: 0 });
  beforeEach(() => { manager = new StateManager(); manager.createBlankProject('A4', 'Production tests', false); });
  it('exports actual later chapter artwork and inserts right-hand opening blanks', async () => {
    manager.addElement(text('same-id', 'FIRST CHAPTER'));
    const first = structuredClone(manager.getState());
    manager.setStoryText('same-id', 'SECOND CHAPTER'); const second = structuredClone(manager.getState());
    const states = { first, second };
    const book = bookEngine.createBook('Collected book', [{ title: 'First', filePath: 'first' }, { title: 'Second', filePath: 'second' }]);
    const load = (name: string) => states[name as keyof typeof states];
    const assembled = assembleBook(book, load);
    expect(assembled.spreads.flatMap(spread => spread.pages).map(page => page.pageNumber)).toEqual([1, 2, 3]);
    expect(assembled.spreads[1].elements).toEqual([]);
    expect(assembled.spreads[2].elements[0].id).not.toBe(assembled.spreads[0].elements[0].id);
    expect(() => parseProject(JSON.stringify(assembled), first)).not.toThrow();
    const pdf = await bookEngine.exportBookToPdf(book, load, { download: false, compress: false });
    expect(pdf.getNumberOfPages()).toBe(3);
    const pages = (pdf.internal as unknown as { pages: string[][] }).pages;
    expect(pages[1].join('\n')).toContain('FIRST CHAPTER');
    expect(pages[3].join('\n')).toContain('SECOND CHAPTER');
    expect(first.spreads[0].elements[0].id).toBe('same-id');
    second.settings.widthMm = 100;
    expect(() => assembleBook(book, load)).toThrow('same page size');
  });
  it('searches overset manuscripts once and preserves formatting through replacement and undo', () => {
    manager.addElement(text('story', '', 40, 10));
    manager.setStoryContent('story', { version: 1, paragraphs: [{ runs: [{ text: 'Opening ', bold: true }, { text: 'word '.repeat(100) + 'needle at end', italic: true }] }] });
    const before = manager.exportJson();
    const query = { findText: 'needle', changeText: 'replacement' };
    expect(manager.collectFindMatches(query)).toHaveLength(1);
    expect(manager.changeAll(query).replacementsCount).toBe(1);
    const content = manager.getStoryContent('story');
    expect(storyText(content)).toContain('replacement at end'); expect(content.paragraphs[0].runs[0].bold).toBe(true);
    manager.undo(); expect(manager.exportJson()).toBe(before);
  });
  it('supports style filters, contextual GREP groups, adjacent results and atomic lock rejection', () => {
    manager.addElement(text('story', ''));
    manager.setStoryContent('story', { version: 1, paragraphs: [{ styleId: 'body', runs: [{ text: '1122', characterStyleId: 'emphasis' }] }] });
    const query = { findText: '(?<=1)(1)', changeText: '[$1]', isGrep: true, paragraphStyleId: 'body', characterStyleId: 'emphasis' };
    expect(manager.changeAll(query).replacementsCount).toBe(1);
    expect(storyText(manager.getStoryContent('story'))).toBe('1[1]22');
    manager.setStoryText('story', 'aaaa');
    const next = manager.findNext({ findText: 'aa', changeText: '' });
    expect(manager.findNext({ findText: 'aa', changeText: '' }, next!.elementId, next!.index + next!.length)?.index).toBe(2);
    manager.getElementById('story')!.locked = true; const before = manager.exportJson();
    expect(() => manager.changeAll({ findText: 'a', changeText: 'b' })).toThrow('Unlock'); expect(manager.exportJson()).toBe(before);
  });
  it('cascades paragraph styles while retaining local overrides and rejecting cycles', () => {
    const base = { ...manager.getState().paragraphStyles[0], id: 'base', name: 'Base', fontSizePt: 12 };
    manager.createParagraphStyle(base);
    manager.createParagraphStyle({ ...base, id: 'child', name: 'Child', basedOnId: 'base', inheritedProperties: ['fontSizePt', 'fontFamily'] });
    manager.updateParagraphStyle('base', { fontSizePt: 15 });
    expect(manager.getState().paragraphStyles.find(style => style.id === 'child')!.fontSizePt).toBe(15);
    manager.updateParagraphStyle('child', { fontSizePt: 18 }); manager.updateParagraphStyle('base', { fontSizePt: 20 });
    expect(manager.getState().paragraphStyles.find(style => style.id === 'child')!.fontSizePt).toBe(18);
    const before = manager.exportJson();
    expect(() => manager.updateParagraphStyle('base', { basedOnId: 'child' })).toThrow('circle'); expect(manager.exportJson()).toBe(before);
    expect(() => parseProject(manager.exportJson(), manager.getState())).not.toThrow();
    expect(() => manager.deleteParagraphStyle('base')).toThrow('Detach');
  });
  it('imports styles in one undo step and rejects invalid style sets before mutation', () => {
    const source = structuredClone(manager.getState().paragraphStyles[0]);
    const before = manager.exportJson(); manager.importStyleSet({ paragraphStyles: [{ ...source, id: 'shared', name: 'Shared' }] });
    expect(manager.getState().paragraphStyles.some(style => style.id === 'shared')).toBe(true);
    manager.undo(); expect(manager.exportJson()).toBe(before);
    expect(() => manager.importStyleSet({ paragraphStyles: [{ id: 'invalid' }] })).toThrow(); expect(manager.exportJson()).toBe(before);
  });
  it('imports quoted tables, CSV and scalar JSON without prototype field confusion', () => {
    expect(parseTableData('Name\tNotes\r\nAlice\t"first\nsecond"')).toEqual([['Name', 'Notes'], ['Alice', 'first\nsecond']]);
    expect(parseCsv('name,price\n"  book  ",12').records[0].name).toBe('  book  ');
    expect(() => parseCsv('name,name\na,b')).toThrow('unique');
    expect(() => parseCsv('name,price\n"broken,3')).toThrow('closing');
    expect(() => parseTableData('a,b\nc')).toThrow('same number');
    expect(parseMergeData('[{"name":"Book","price":12,"available":true}]').records[0].price).toBe('12');
    expect(() => parseMergeData('[{"price":{"unsafe":1}}]')).toThrow('string');
    expect(parseCsv('__proto__,price\nvalue,3').records[0].__proto__).toBe('value');
  });
  it('clones local threads and groups with unique identities for each merge record', () => {
    manager.addElement(text('head', 'Hello {{name}}')); manager.addElement(text('tail', ''));
    manager.linkTextFrames('head', 'tail'); manager.selectElements(['head', 'tail']); manager.groupSelection();
    const clones = generateMergedSpreads(manager.getActiveSpread(), [{ name: 'Alice' }, { name: 'Bob' }]);
    for (const spread of clones) {
      const [head, tail] = spread.elements as TextElement[];
      expect(head.nextFrameId).toBe(tail.id); expect(tail.prevFrameId).toBe(head.id);
      expect(head.groupId).toBe(tail.groupId); expect(head.groupId).not.toBe(manager.getElementById('head')!.groupId);
    }
    expect(clones[0].elements[0].groupId).not.toBe(clones[1].elements[0].groupId);
  });
  it('keeps focal subjects within the crop and clamps at image edges', () => {
    expect(calculateImageFitting(0, 0, 100, 100, 200, 100, 'fill', { x: 0, y: 0.5 }).drawX).toBe(0);
    expect(calculateImageFitting(0, 0, 100, 100, 200, 100, 'fill', { x: 1, y: 0.5 }).drawX).toBe(-100);
    expect(calculateImageFitting(0, 0, 100, 100, 200, 100, 'fit', { x: 1, y: 1 }).drawX).toBe(0);
  });
  it('merges table cells with retained text and renders canonical rows through continuations', () => {
    const cells = mergeTableCellRight([[{ text: 'Product' }, { text: 'Price' }, { text: 'Notes' }]], 0, 0);
    expect(cells[0][0]).toMatchObject({ text: 'Product Price', colSpan: 2 }); expect(tableCellSpan(cells[0], 1)).toBe(0);
    const template = { ...text('table-head', ''), type: 'table' as const, rows: 5, cols: 1, cells: ['Header', 'A', 'B', 'C', 'D'].map(text => [{ text }]), headerRowCount: 1, headerFillColor: '#222', headerTextColor: '#fff', cellPaddingMm: 1 };
    manager.addElement(template); manager.addElement({ ...template, id: 'table-tail', cells: [], rows: 0 });
    expect(manager.linkTableFrames('table-head', 'table-tail')).toBe(true);
    const tail = manager.getElementById('table-tail') as typeof template;
    const thread = tableThread(manager.getState().spreads, tail);
    expect(tableEngine.computeFrameSlice(tail, thread).bodyRows.map(row => row.cells[0].text)).toEqual(['C', 'D']);
    expect(manager.linkTableFrames('table-tail', 'table-head')).toBe(false);
  });
  it('retains local IDML run typography rather than applying color by repeated text', async () => {
    const xml = '<Story Self="Story_test"><ParagraphStyleRange><CharacterStyleRange FontStyle="Bold" PointSize="18"><Content>Same &amp; &#x4E66;</Content></CharacterStyleRange><CharacterStyleRange FontStyle="Italic" PointSize="10"><Content> same</Content></CharacterStyleRange></ParagraphStyleRange></Story>';
    const design = '<Document><idPkg:Spread src="Spreads/Spread_1.xml"/></Document>';
    const spread = '<Spread><Page Self="p1" GeometricBounds="0 0 842 595"/><TextFrame Self="t1" ParentStory="Story_test" GeometricBounds="20 20 300 500"/></Spread>';
    const zip = createZipArchive({ 'designmap.xml': design, 'Spreads/Spread_1.xml': spread, 'Stories/Story_test.xml': xml });
    const imported = await parseIdmlPackage(zip);
    const frame = imported.spreads[0].elements.find(element => element.type === 'text') as TextElement;
    expect(frame.storyContent!.paragraphs[0].runs[0]).toMatchObject({ text: 'Same & 书', bold: true, fontSizePt: 18 });
    expect(frame.storyContent!.paragraphs[0].runs[1]).toMatchObject({ italic: true, fontSizePt: 10 });
  });
});
