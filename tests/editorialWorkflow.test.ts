import { beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { editorialOutline, editorialStories, findPublicationPages } from '../src/engine/editorialNavigation';
import { createPublicationStarter } from '../src/engine/publicationStarters';
import { prepareSpreadTemplate } from '../src/engine/spreadTemplate';
import { insertRun } from '../src/engine/publicationReferences';
import { plainStory, storyText } from '../src/engine/storyContent';
import { parseProject } from '../src/state/projectValidation';
import { TEMPLATES } from '../src/templates';
import type { TextElement } from '../src/types';

describe('editorial navigation, review and reusable layouts', () => {
  let manager: StateManager;
  beforeEach(() => { manager = new StateManager(); manager.createBlankProject('Book-Trade-6x9', 'Editorial workflows', false); });
  const starter = (kind: 'fiction' | 'nonfiction' | 'article' = 'fiction', title = 'Chapter One') => {
    const settings = manager.getState().settings;
    const source = createPublicationStarter(settings, kind, title);
    manager.applySpreadTemplate(source, 'append', { width: settings.widthMm, height: settings.heightMm });
    return manager.getActiveSpread();
  };

  it('adds dimension-aware linked starters with one undo and repeatable unique identities', () => {
    const original = manager.exportJson();
    const spread = starter();
    const body = spread.elements.find(element => element.type === 'text' && element.nextFrameId) as TextElement;
    const tail = spread.elements.find(element => element.id === body.nextFrameId) as TextElement;
    expect(tail.prevFrameId).toBe(body.id);
    expect(body.autoExtendStory).toBe(true);
    expect(storyText(manager.getStoryContent(body.id))).toBe('Begin your manuscript here.');
    expect(spread.elements.every(element => element.x + element.width <= manager.getState().settings.widthMm + 0.01)).toBe(true);
    manager.undo(); expect(manager.exportJson()).toBe(original);
    manager.redo(); starter('article');
    const ids = manager.getState().spreads.flatMap(spread => [spread.id, ...spread.pages.map(page => page.id), ...spread.elements.map(element => element.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    const article = manager.getActiveSpread().elements.find(element => element.type === 'text' && element.nextFrameId) as TextElement;
    expect(article.columns).toBe(2);
    expect(() => parseProject(manager.exportJson(), manager.getState())).not.toThrow();
  });

  it('searches complete threaded copy and returns one story entry with frame counts', () => {
    const spread = starter('nonfiction', 'Finding the Hidden Chapter');
    const body = spread.elements.find(element => element.type === 'text' && element.nextFrameId) as TextElement;
    manager.setStoryText(body.id, 'Long reading passage. '.repeat(500) + 'hidden needle');
    const stories = editorialStories(manager.getState(), 'hidden needle');
    expect(stories).toHaveLength(1); expect(stories[0].frames).toBeGreaterThan(1);
    expect(stories[0].words).toBeGreaterThan(500);
    expect(editorialOutline(manager.getState(), 'hidden chapter')[0].title).toBe('Finding the Hidden Chapter');
    expect(editorialStories(manager.getState(), 'no such phrase')).toEqual([]);
  });

  it('finds physical numbers and repeated printed section labels without guessing', () => {
    starter();
    const pages = manager.getState().spreads.flatMap(spread => spread.pages);
    pages[0].section = { startNumber: 1, numbering: 'roman-lower', prefix: 'P-', title: 'Front' };
    pages[1].section = { startNumber: 1, numbering: 'roman-lower', prefix: 'P-', title: 'Chapter' };
    expect(findPublicationPages(manager.getState(), ' P-i ')).toHaveLength(2);
    expect(findPublicationPages(manager.getState(), String(pages[2].pageNumber)).some(page => page.id === pages[2].id)).toBe(true);
    expect(findPublicationPages(manager.getState(), '')).toEqual([]);
  });

  it('keeps review pins attached to their spread through moves, deletion, undo and reopen', () => {
    const firstId = manager.getActiveSpread().id;
    const note = manager.addComment(0, 12, 24, '  Review this opening.  ', 'Editor');
    starter();
    manager.moveSpread(0, 1);
    expect(manager.getState().comments![0]).toMatchObject({ spreadId: firstId, spreadIndex: 1, text: 'Review this opening.' });
    manager.undo(); expect(manager.getState().comments![0].spreadIndex).toBe(0);
    manager.redo(); manager.updateComment(note.id, 'Revised feedback');
    manager.resolveComment(note.id); expect(manager.getState().comments![0].resolved).toBe(true);
    manager.resolveComment(note.id); expect(manager.getState().comments![0].resolved).toBe(false);
    const reopened = parseProject(manager.exportJson(), manager.getState());
    expect(reopened.comments![0].spreadId).toBe(firstId);
    manager.deleteSpread(1); expect(manager.getState().comments).toEqual([]);
    manager.undo(); expect(manager.getState().comments![0].text).toBe('Revised feedback');
  });

  it('migrates legacy review pins using their original spread positions', () => {
    starter();
    const note = manager.addComment(0, 12, 24, 'Legacy review'); delete note.spreadId;
    const id = manager.getState().spreads[0].id;
    manager.moveSpread(0, 1);
    expect(manager.getState().comments![0]).toMatchObject({ spreadId: id, spreadIndex: 1 });
  });

  it('rejects malformed review notes without changing history or content', () => {
    const before = manager.exportJson();
    expect(() => manager.addComment(99, 1, 2, 'bad')).toThrow('existing spread');
    expect(() => manager.addComment(0, NaN, 2, 'bad')).toThrow();
    expect(() => manager.addComment(0, 1, 2, '  ')).toThrow('review note');
    expect(manager.exportJson()).toBe(before);
  });

  it('centers navigated frames on either page instead of leaving them outside the viewport', () => {
    const spread = starter();
    const frame = spread.elements.find(element => element.type === 'text' && element.prevFrameId)!;
    expect(manager.zoomToElement(frame.id)).toBe(true);
    const state = manager.getState(), pixelsPerMm = 96 / 25.4 * state.zoom;
    const pageIndex = spread.pages.findIndex(page => page.id === frame.pageId);
    expect((pageIndex * state.settings.widthMm + frame.x + frame.width / 2 - spread.pages.length * state.settings.widthMm / 2) * pixelsPerMm + state.panX).toBeCloseTo(0);
    expect((frame.y + frame.height / 2 - state.settings.heightMm / 2) * pixelsPerMm + state.panY).toBeCloseTo(0);
    expect(state.selectedElementId).toBe(frame.id);
  });

  it('allows ordinary spread moves but protects cross-spread threaded reading order', () => {
    const first = starter(); const second = starter('nonfiction');
    const tail = first.elements.find(element => element.type === 'text' && element.prevFrameId) as TextElement;
    const head = second.elements.find(element => element.type === 'text' && element.nextFrameId) as TextElement;
    manager.linkTextFrames(tail.id, head.id);
    const before = manager.exportJson();
    expect(() => manager.moveSpread(1, 2)).toThrow('threaded story');
    expect(manager.exportJson()).toBe(before);
    manager.moveSpread(0, 2);
    expect(manager.getState().spreads[0].id).toBe(first.id);
  });

  it('scales bundled A4 layouts to the active trim and fixes legacy timestamp page references', () => {
    const template = TEMPLATES[0].createSpread(0, 1);
    const element = template.elements[0], original = { x: element.x, width: element.width };
    element.pageId = 'page-stale-timestamp-1';
    const spread = prepareSpreadTemplate(template, manager.getState().settings);
    expect(spread.elements[0].pageId).toBe(spread.pages[0].id);
    expect(spread.elements[0].x).toBeCloseTo(original.x * 152.4 / 210);
    expect(spread.elements[0].width).toBeCloseTo(original.width * 152.4 / 210);
    expect(template.elements[0].width).toBe(original.width);
  });

  it('records template replacement as one undo and refuses to flatten structured manuscripts', () => {
    manager.addSpread();
    const source = TEMPLATES[0].createSpread(0, 1);
    manager.applySpreadTemplate(source, 'replace');
    expect(manager.getActiveSpread().elements.length).toBeGreaterThan(0);
    manager.undo(); expect(manager.getActiveSpread().elements).toEqual([]);
    starter(); const before = manager.exportJson();
    expect(() => manager.applySpreadTemplate(source, 'replace')).toThrow('structured or threaded');
    expect(manager.exportJson()).toBe(before);
  });

  it('rejects locked layers and mismatched page counts before modifying the document', () => {
    const source = TEMPLATES[0].createSpread(0, 1), before = manager.exportJson();
    expect(() => manager.applySpreadTemplate(source, 'replace')).toThrow('page count');
    expect(manager.exportJson()).toBe(before);
    manager.getState().layers.find(layer => layer.id === manager.getState().activeLayerId)!.locked = true;
    const locked = manager.exportJson();
    expect(() => manager.applySpreadTemplate(source, 'append')).toThrow('Unlock');
    expect(manager.exportJson()).toBe(locked);
  });

  it('rejects reference insertion inside Unicode characters and atomic note labels', () => {
    expect(() => insertRun(plainStory('😀'), 1, 1, { text: 'x' })).toThrow('Unicode');
    const content = { version: 1 as const, paragraphs: [{ runs: [{ text: '¹⁰', noteId: 'note-ten' }] }] };
    expect(() => insertRun(content, 1, 1, { text: 'x' })).toThrow('marker');
    expect(storyText(insertRun(content, 2, 2, { text: 'x' }))).toBe('¹⁰x');
  });
});
