import { describe, expect, it, vi } from 'vitest';
import { indexFrameNotes, layoutFrameNotes, notesForFrame, publicationSnapshot, reflowStoryState } from '../src/engine/publicationReferences';
import { publicationPreflight } from '../src/engine/publicationPreflight';
import { StateManager } from '../src/state/stateManager';
import { layoutKernels, warmLayout } from '../src/engine/layoutRuntime';
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
  it('matches snapshot note order and legacy anchors without including endnotes', () => {
    const manager = manuscript();
    const state = manager.getState();
    const frame = state.spreads[0].elements[0] as TextElement;
    frame.text = 'Citation¹²';
    frame.textContent = { version: 1, paragraphs: [{ runs: [{ text: '²', noteId: 'modern' }, { text: '¹', noteId: 'legacy' }] }] };
    state.settings.footnotes = [
      { id: 'elsewhere', text: 'Other frame', number: 1, elementId: 'other' },
      { id: 'legacy', text: 'Legacy copy', number: 1, elementId: frame.id },
      { id: 'modern', text: 'Modern copy', number: 2, anchorVersion: 1 },
      { id: 'modern', text: 'Endnote', number: 2, kind: 'endnote' },
    ];
    const indexed = indexFrameNotes(state).forFrame(frame);
    expect(indexed).toEqual(notesForFrame(state, frame));
    expect(indexed.map(note => note.id)).toEqual(['legacy', 'modern']);
  });

  it('skips measuring a terminal story when the only footnote belongs to another story', () => {
    const manager = manuscript();
    const state = manager.getState();
    const head = state.spreads[0].elements[0] as TextElement;
    const unrelated = { ...head, id: 'other', text: 'Unrelated manuscript. '.repeat(100) };
    state.spreads[0].elements.push(unrelated);
    state.settings.footnotes = [{ id: 'note', text: 'Body', number: 1, elementId: head.id, anchorVersion: 1 }];
    head.storyContent = { version: 1, paragraphs: [{ runs: [{ text: 'Citation' }, { text: '¹', noteId: 'note' }] }] };
    const measure = vi.fn((text: string) => text.length * 2);
    reflowStoryState(state, unrelated.id, undefined, measure);
    expect(measure).not.toHaveBeenCalled();
    expect(unrelated.text).toContain('Unrelated manuscript');
    expect(layoutFrameNotes(state, unrelated).lines).toHaveLength(0);
    reflowStoryState(state, head.id, undefined, measure);
    expect(measure).toHaveBeenCalled();
    expect(layoutFrameNotes(state, head).lines.some(line => line.noteId === 'note')).toBe(true);
  });

  it('matches the host column and overflow output when Rust takes over footnote allocation', async () => {
    const manager = manuscript(2);
    const note = manager.insertFootnote('head', citation, 2);
    manager.insertFootnote('head', 'Second note.');
    const source = manager.getState();
    const snapshot = () => {
      const state = publicationSnapshot(source);
      return layoutFrameNotes(state, state.spreads[0].elements[0] as TextElement);
    };
    const expected = snapshot();
    expect(expected.remaining).toBeGreaterThan(0);
    await warmLayout();
    const notePlan = layoutKernels?.footnotes([[], []], [{ note, rows: ['a', 'b', 'c'], started: true }],
      2, 10, 3, () => ['Continued']);
    expect(notePlan?.lines.map(line => [line.column, line.text])).toEqual([[0, 'Continued'], [0, 'a'], [1, 'Continued'], [1, 'b']]);
    expect(snapshot()).toEqual(expected);
  });
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
