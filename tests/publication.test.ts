import { beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { pageLabel, masterTargetPage } from '../src/engine/pageLabels';
import { parseProject } from '../src/state/projectValidation';
import { plainStory } from '../src/engine/storyContent';
import type { Page, TextElement } from '../src/types';

describe('Publication sections and chapter openings', () => {
  let manager: StateManager;
  beforeEach(() => { manager = new StateManager(); manager.createBlankProject('A4', 'Publication test', true); });

  it('keeps physical positions unique while restarting printed numbering', () => {
    manager.appendChapter('First chapter');
    const pages = manager.getState().spreads.flatMap(spread => spread.pages);
    expect(pages.map(page => page.pageNumber)).toEqual([1, 2, 3]);
    manager.setPageSection(pages[0].id, { title: 'Front matter', startNumber: 1, numbering: 'roman-lower', prefix: '' });
    manager.setPageSection(pages[2].id, { title: 'Main text', startNumber: 1, numbering: 'arabic', prefix: '' });
    expect(pages.map(page => pageLabel(pages, page.id).label)).toEqual(['i','ii','1']);
    expect(manager.evaluateTokens('{{page}} / {{physicalPage}} / {{sectionTitle}}', 3)).toBe('1 / 3 / Main text');
    expect(manager.evaluateTokens('{{chapterTitle}}', 3)).toBe('First chapter');
    const restored = parseProject(JSON.stringify(manager.getState()), manager.getState());
    expect(restored.spreads[0].pages[0].section?.numbering).toBe('roman-lower');
    manager.undo();
    expect(pageLabel(manager.getState().spreads.flatMap(spread => spread.pages), pages[2].id).label).toBe('iii');
  });

  it('appends a right-hand chapter and blank page in one undo step', () => {
    const before = JSON.stringify(manager.getState().spreads);
    const id = manager.appendChapter('A chapter', true, 30);
    const state = manager.getState();
    expect(state.spreads[1].elements).toHaveLength(0);
    expect(state.spreads[2].pages[0].side).toBe('right');
    const frame = manager.getElementById(id) as TextElement;
    expect(frame.y).toBe(state.settings.margins.topMm + 30);
    expect(frame.storyContent?.paragraphs.map(paragraph => paragraph.styleId)).toEqual(['style-h1', 'style-body']);
    manager.undo();
    expect(JSON.stringify(manager.getState().spreads)).toBe(before);
  });

  it('leaves the publication untouched when chapter settings are invalid', () => {
    const before = JSON.stringify(manager.getState());
    expect(() => manager.appendChapter('')).toThrow('title');
    expect(() => manager.appendChapter('Chapter', true, 10000)).toThrow('inset');
    expect(JSON.stringify(manager.getState())).toBe(before);
  });

  it('does not use a heading from the next page on the same spread', () => {
    manager.appendChapter('Earlier');
    const state = manager.getState();
    const spread = state.spreads[2];
    const template = spread.elements[0] as TextElement;
    spread.pages.push({ id: 'later-page', pageNumber: 4, side: 'left' });
    spread.elements.push({ ...structuredClone(template), id: 'later-heading', pageId: 'later-page',
      storyContent: undefined, textContent: { version: 1, paragraphs: [{ styleId: 'style-h1', runs: [{ text: 'Later' }] }] } });
    expect(manager.evaluateTokens('{{chapterTitle}}', 3)).toBe('Earlier');
    expect(manager.evaluateTokens('{{chapterTitle}}', 4)).toBe('Later');
  });

  it('formats prefixes and upper Roman labels without changing page IDs', () => {
    const pages: Page[] = [{ id: 'p', pageNumber: 12, side: 'single', section: { title: '', startNumber: 9, numbering: 'roman-upper', prefix: 'A-' } }];
    expect(pageLabel(pages, 'p').label).toBe('A-IX');
  });

  it('extends an opted-in story into paired spreads and keeps editing plus page creation in one undo step', () => {
    const id = manager.appendChapter('Auto flow');
    manager.setStoryAutoExtend(id, true);
    const before = JSON.stringify(manager.getState().spreads);
    const text = 'An automatically flowing manuscript. '.repeat(500);
    manager.setStoryContent(id, plainStory(text, 'style-body'));
    const state = manager.getState();
    expect(state.spreads.length).toBeGreaterThan(JSON.parse(before).length);
    for (const spread of state.spreads.slice(JSON.parse(before).length)) {
      expect(spread.pages.map(page => page.side)).toEqual(['left', 'right']);
      expect(spread.elements).toHaveLength(2);
    }
    expect(manager.getStoryContent(id).paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n')).toBe(text);
    expect((manager.getElementById(id) as TextElement).autoPaginationError).toBeUndefined();
    manager.undo();
    expect(JSON.stringify(manager.getState().spreads)).toBe(before);
    manager.redo();
    const count = manager.getState().spreads.length;
    manager.setStoryText(id, 'Short story');
    expect(manager.getState().spreads.length).toBe(count);
    expect(() => parseProject(JSON.stringify(manager.getState()), manager.getState())).not.toThrow();
  });

  it('does not add pages to stories that have not opted in', () => {
    const id = manager.appendChapter('Manual flow');
    const count = manager.getState().spreads.length;
    manager.setStoryText(id, 'Manuscript text. '.repeat(1000));
    expect(manager.getState().spreads.length).toBe(count);
  });

  it('inserts overflow pages before a later chapter instead of moving its copy to the book’s end', () => {
    const first = manager.appendChapter('First');
    const second = manager.appendChapter('Second');
    manager.setStoryAutoExtend(first, true);
    manager.setStoryContent(first, plainStory('First chapter body text. '.repeat(500), 'style-body'));
    const spreads = manager.getState().spreads;
    const secondIndex = spreads.findIndex(spread => spread.elements.some(element => element.id === second));
    let frame = manager.getElementById(first) as TextElement;
    while (frame.nextFrameId) frame = manager.getElementById(frame.nextFrameId) as TextElement;
    expect(spreads.findIndex(spread => spread.elements.some(element => element.id === frame.id))).toBeLessThan(secondIndex);
    expect(manager.getActiveSpread().elements.some(element => element.id === second)).toBe(true);
    expect(spreads.flatMap(spread => spread.pages).map(page => page.pageNumber)).toEqual(spreads.flatMap(spread => spread.pages).map((_, index) => index + 1));
  });

  it('preserves the edit and reports a problem when automatic extension cannot make usable pages', () => {
    const id = manager.appendChapter('Protected copy');
    manager.setStoryAutoExtend(id, true);
    const count = manager.getState().spreads.length;
    manager.getState().settings.margins.topMm = 200;
    manager.getState().settings.margins.bottomMm = 200;
    const text = 'This edited manuscript must survive. '.repeat(300);
    manager.setStoryContent(id, plainStory(text, 'style-body'));
    expect(manager.getState().spreads.length).toBe(count);
    expect((manager.getElementById(id) as TextElement).autoPaginationError).toContain('margins');
    expect(manager.getStoryContent(id).paragraphs[0].runs[0].text).toBe(text);
  });

  it('preserves the edit and reports a problem when automatic extension cannot make usable pages', () => {
    const id = manager.appendChapter('Protected copy');
    manager.setStoryAutoExtend(id, true);
    const count = manager.getState().spreads.length;
    manager.getState().settings.margins.topMm = 200;
    manager.getState().settings.margins.bottomMm = 200;
    const text = 'This edited manuscript must survive. '.repeat(300);
    manager.setStoryContent(id, plainStory(text, 'style-body'));
    expect(manager.getState().spreads.length).toBe(count);
    expect((manager.getElementById(id) as TextElement).autoPaginationError).toContain('margins');
    expect(manager.getStoryContent(id).paragraphs[0].runs[0].text).toBe(text);
  });

  it('creates running headers without duplicate IDs and maps only one master side onto single pages', () => {
    const spread = manager.getActiveSpread();
    manager.setRunningHeader(spread.id, '{{chapterTitle}}');
    const state = manager.getState();
    const master = state.masterSpreads.find(master => master.id === spread.masterSpreadId)!;
    expect(master.elements.some(element => element.type === 'text' && element.text === '{{page}}')).toBe(true);
    expect(() => parseProject(JSON.stringify(state), state)).not.toThrow();
    manager.setRunningHeader(spread.id, '{{sectionTitle}}');
    expect(() => parseProject(JSON.stringify(manager.getState()), state)).not.toThrow();
    const templates: Page[] = [{ id: 'l', pageNumber: 1, side: 'left' }, { id: 'r', pageNumber: 2, side: 'right' }];
    expect(masterTargetPage(templates, spread.pages, 'l')).toBeUndefined();
    expect(masterTargetPage(templates, spread.pages, 'r')?.id).toBe(spread.pages[0].id);
  });
});
