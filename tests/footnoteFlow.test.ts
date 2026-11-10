import { describe, expect, it } from 'vitest';
import { layoutFrameNotes, publicationSnapshot } from '../src/engine/publicationReferences';
import { publicationPreflight } from '../src/engine/publicationPreflight';
import { StateManager } from '../src/state/stateManager';
import type { TextElement } from '../src/types';

function manuscript(columns = 1) {
  const manager = new StateManager();
  manager.createBlankProject('A4', 'Notes in production', false);
  const head: TextElement = {
    id: 'head', pageId: manager.getActiveSpread().pages[0].id, type: 'text', text: 'Source.',
    x: 20, y: 25, width: 100, height: 36, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    fontFamily: 'Times', fontSizePt: 12, lineHeight: 1.3, letterSpacingPt: 0, color: '#111111',
    alignment: 'left', columns, columnGutterMm: 4, backgroundColor: 'transparent', borderColor: 'transparent',
    borderWidthMm: 0, paddingMm: 2,
  };
  manager.addElement(head);
  return manager;
}

const citation = 'A detailed source citation with enough text to continue. '.repeat(22) + 'Final citation line.';

describe('footnote continuation', () => {
  it('keeps the anchor with the first line and flows the remaining note to the next frame', () => {
    const manager = manuscript();
    const state = manager.getState();
    const head = manager.getElementById('head') as TextElement;
    head.nextFrameId = 'next';
    const continuation: TextElement = { ...head, id: 'next', pageId: 'next-page', text: '', height: 220, prevFrameId: 'head', nextFrameId: undefined };
    state.spreads.push({ id: 'next-spread', spreadIndex: 1, pages: [{ id: 'next-page', pageNumber: 2, side: 'single' }], elements: [continuation] });
    const note = manager.insertFootnote('head', citation, 'Source.'.length);
    const exportState = publicationSnapshot(state);
    const first = layoutFrameNotes(exportState, exportState.spreads[0].elements[0] as TextElement);
    const second = layoutFrameNotes(exportState, exportState.spreads[1].elements[0] as TextElement);
    expect(first.lines[0]).toMatchObject({ noteId: note.id, text: expect.stringMatching(/^1\. A detailed/) });
    expect(first.remaining).toBeGreaterThan(0);
    expect(second.lines[0]).toMatchObject({ noteId: note.id, text: '1. Continued' });
    expect(second.lines.at(-1)?.text).toContain('Final citation line.');
    expect(second.remaining).toBe(0);
    expect(publicationPreflight(exportState, 'print').filter(issue => issue.code === 'NOTE_OVERFLOW')).toEqual([]);
  });

  it('flags an unfinished note for print and creates a notes-only page when paginating', () => {
    const manager = manuscript();
    manager.insertFootnote('head', citation);
    const before = publicationSnapshot(manager.getState());
    expect(publicationPreflight(before, 'print').some(issue => issue.code === 'NOTE_OVERFLOW')).toBe(true);
    expect(publicationPreflight(before, 'epub').some(issue => issue.code === 'NOTE_OVERFLOW')).toBe(false);
    expect(manager.paginateStory('head')).toBeGreaterThan(0);
    const after = publicationSnapshot(manager.getState());
    const last = after.spreads.at(-1)!.elements[0] as TextElement;
    expect(last.text).toBe('');
    expect(layoutFrameNotes(after, last).lines[0]?.text).toBe('1. Continued');
    expect(publicationPreflight(after, 'print').some(issue => issue.code === 'NOTE_OVERFLOW')).toBe(false);
  });

  it('uses the next column before sending a remainder to the next page', () => {
    const manager = manuscript(2);
    manager.insertFootnote('head', 'Citation with several lines of text. '.repeat(8));
    const state = publicationSnapshot(manager.getState());
    const notes = layoutFrameNotes(state, state.spreads[0].elements[0] as TextElement);
    expect(notes.lines.some(line => line.column === 0 && line.text.startsWith('1. Citation'))).toBe(true);
    expect(notes.lines.some(line => line.column === 1 && line.text === '1. Continued')).toBe(true);
    expect(notes.remaining).toBe(0);
  });
});
