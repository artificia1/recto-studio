import { beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { plainStory, storyText } from '../src/engine/storyContent';
import { revisedStory } from '../src/engine/storyRevisions';
import { publicationPreflight } from '../src/engine/publicationPreflight';
import { parseProject } from '../src/state/projectValidation';
import type { StoryContent, TextElement } from '../src/types';
import { assembleBook } from '../src/engine/bookAssembly';
import { bookEngine } from '../src/engine/bookEngine';

describe('manuscript revision review', () => {
  let manager: StateManager;
  beforeEach(() => {
    manager = new StateManager(); manager.createBlankProject('A4', 'Revision tests', false);
    const frame: TextElement = { id: 'story', type: 'text', pageId: manager.getActiveSpread().pages[0].id,
      x: 20, y: 20, width: 170, height: 240, rotation: 0, opacity: 1, zIndex: 1, locked: false,
      text: 'Original manuscript', fontFamily: 'Times', fontSizePt: 12, lineHeight: 1.3,
      letterSpacingPt: 0, color: '#000000', alignment: 'left', columns: 1, columnGutterMm: 4,
      backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paddingMm: 0 };
    manager.addElement(frame);
  });
  const propose = (replacement = 'Revised') => manager.proposeStoryRevision('story', manager.getStoryContent('story'), 0, 8, replacement, 'Editor', 'Tighten opening');

  it('keeps proposals out of the manuscript, persists them and accepts in one undo step', () => {
    const id = propose();
    expect(storyText(manager.getStoryContent('story'))).toBe('Original manuscript');
    expect(publicationPreflight(manager.getState()).some(issue => issue.severity === 'warning' && issue.message.includes('await review'))).toBe(true);
    const restored = parseProject(manager.exportJson(), manager.getState());
    expect(restored.storyRevisions![0]).toMatchObject({ id, status: 'pending', replacement: 'Revised' });
    manager.resolveStoryRevision(id, 'accepted');
    expect(storyText(manager.getStoryContent('story'))).toBe('Revised manuscript');
    expect(manager.getState().storyRevisions![0].status).toBe('accepted');
    manager.undo();
    expect(storyText(manager.getStoryContent('story'))).toBe('Original manuscript');
    expect(manager.getState().storyRevisions![0].status).toBe('pending');
    manager.redo(); expect(storyText(manager.getStoryContent('story'))).toBe('Revised manuscript');
  });
  it('rejects stale proposals without overwriting newer text or formatting', () => {
    const id = propose(); manager.formatStoryRange('story', 9, 19, { bold: true });
    const before = manager.exportJson();
    expect(() => manager.resolveStoryRevision(id, 'accepted')).toThrow('changed');
    expect(manager.exportJson()).toBe(before);
    manager.resolveStoryRevision(id, 'rejected');
    expect(storyText(manager.getStoryContent('story'))).toBe('Original manuscript');
    manager.removeResolvedStoryRevisions(); expect(manager.getState().storyRevisions).toEqual([]);
    manager.undo(); expect(manager.getState().storyRevisions![0].status).toBe('rejected');
  });
  it('checks story locks at acceptance and validates the original snapshot on submission', () => {
    const original = manager.getStoryContent('story'), id = propose();
    manager.updateElement('story', { locked: true });
    expect(() => manager.resolveStoryRevision(id, 'accepted')).toThrow('Unlock');
    manager.updateElement('story', { locked: false }); manager.setStoryText('story', 'Newer manuscript');
    expect(() => manager.proposeStoryRevision('story', original, 0, 8, 'Edit', 'Editor')).toThrow('changed');
    manager.resolveStoryRevision(id, 'rejected');
  });
  it('replaces explicit ranges, even repeated text, and retains surrounding formatting', () => {
    const before: StoryContent = { version: 1, paragraphs: [{ id: 'p', runs: [{ text: 'aa', bold: true }, { text: 'aa', italic: true }] }] };
    const result = revisedStory(before, 1, 2, 'Z');
    expect(result.paragraphs[0]).toEqual({ id: 'p', runs: [{ text: 'aZ', bold: true }, { text: 'aa', italic: true }] });
    expect(before.paragraphs[0].runs[0].text).toBe('aa');
    for (const value of ['', 'abc', 'a\nb\n', '\n\n']) for (let start = 0; start <= value.length; start++) for (let end = start; end <= value.length; end++) {
      for (const insertion of ['', 'X', '\n', 'one\ntwo']) expect(storyText(revisedStory(plainStory(value), start, end, insertion))).toBe(value.slice(0, start) + insertion + value.slice(end));
    }
  });
  it('preserves atomic markers outside edits and rejects partial characters or marker edits', () => {
    const before: StoryContent = { version: 1, paragraphs: [{ runs: [{ text: 'A' }, { text: '12', noteId: 'note' }, { text: 'Z' }] }] };
    expect(() => revisedStory(before, 2, 2, 'x')).toThrow('markers');
    expect(() => revisedStory(before, 0, 2, '')).toThrow('markers');
    expect(revisedStory(before, 0, 1, 'B').paragraphs[0].runs).toContainEqual({ text: '12', noteId: 'note' });
    expect(() => revisedStory(plainStory('😀'), 1, 2, 'x')).toThrow('whole characters');
    const id = propose(); const state = JSON.parse(manager.exportJson());
    state.storyRevisions[0].end = 9999;
    expect(() => parseProject(JSON.stringify(state), manager.getState())).toThrow();
    expect(manager.getState().storyRevisions![0].id).toBe(id);
  });
  it('retains review records with distinct story identities when assembling chapters', () => {
    propose();
    const state = structuredClone(manager.getState());
    const book = bookEngine.createBook('Book', [{ title: 'First', filePath: 'first' }, { title: 'Second', filePath: 'second' }]);
    const assembled = assembleBook(book, () => state);
    expect(assembled.storyRevisions).toHaveLength(2);
    expect(new Set(assembled.storyRevisions!.map(item => item.id)).size).toBe(2);
    expect(assembled.storyRevisions!.every(item => assembled.spreads.some(spread => spread.elements.some(element => element.id === item.storyId)))).toBe(true);
  });
});
