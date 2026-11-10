import { describe, expect, it } from 'vitest';
import { assembleManuscriptUpdate, compareManuscripts, manuscriptEditRange } from '../src/engine/manuscriptUpdates';
import { StateManager } from '../src/state/stateManager';
import type { StoryContent, TextElement } from '../src/types';

const paragraph = (text: string) => ({ runs: [{ text }] });

describe('manuscript update previews', () => {
  it('preserves heading identity, formatting and note anchors in unchanged paragraphs', () => {
    const original: StoryContent = { version: 1, paragraphs: [
      { id: 'chapter-heading', runs: [{ text: 'Chapter', bold: true }] },
      paragraph('Replace me'),
      { id: 'anchored-paragraph', runs: [{ text: 'Source ' }, { text: '¹', noteId: 'old-note' }] },
    ] };
    const updated: StoryContent = { version: 1, paragraphs: [
      paragraph('Chapter'), paragraph('New paragraph'),
      { runs: [{ text: 'Source ' }, { text: '²', noteId: 'word-note' }] },
    ] };
    const oldNotes = [{ id: 'old-note', kind: 'footnote' as const, text: 'Printed source', number: 1 }];
    const wordNotes = [{ id: 'word-note', kind: 'footnote' as const, text: 'Printed source' }];
    const changes = compareManuscripts(original, updated, oldNotes, wordNotes);
    expect(changes).toEqual([{ start: 1, end: 2, paragraphs: [paragraph('New paragraph')], conflict: false }]);
    const merged = assembleManuscriptUpdate(original, changes, new Set([0]), wordNotes);
    expect(merged.content.paragraphs).toEqual([original.paragraphs[0], updated.paragraphs[1], original.paragraphs[2]]);
    expect(merged.notes).toEqual([]);
    wordNotes[0].text = 'Changed source';
    expect(compareManuscripts(original, updated, oldNotes, wordNotes)).toContainEqual(expect.objectContaining({ conflict: true }));
  });

  it('rejects stale previews and commits the chosen manuscript in one undo step', () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Revised chapter', false);
    const pageId = manager.getActiveSpread().pages[0].id;
    const frame: TextElement = {
      id: 'body', pageId, type: 'text', text: 'Original', x: 20, y: 30, width: 120, height: 80, rotation: 0,
      opacity: 1, zIndex: 1, locked: false, fontFamily: 'Georgia', fontSizePt: 12, lineHeight: 1.3,
      letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4,
      backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paddingMm: 2,
    };
    manager.addElement(frame);
    const draft = { version: 1 as const, paragraphs: [paragraph('Revised')] };
    const oldRevision = manager.getDocumentRevision();
    manager.updateSettings({ title: 'Other edit' });
    expect(() => manager.applyManuscriptUpdate('body', oldRevision, draft, [])).toThrow(/fresh manuscript preview/);
    manager.applyManuscriptUpdate('body', manager.getDocumentRevision(), draft, []);
    expect((manager.getElementById('body') as TextElement).text).toBe('Revised');
    manager.undo();
    expect((manager.getElementById('body') as TextElement).text).toBe('Original');
    expect(manager.getState().settings.title).toBe('Other edit');
  });

  it('keeps the longest unchanged passage when a paragraph moves past it', () => {
    const original = { version: 1 as const, paragraphs: [paragraph('Moved'), paragraph('One'), paragraph('Two'), paragraph('Three')] };
    const updated = { version: 1 as const, paragraphs: [paragraph('One'), paragraph('Two'), paragraph('Three'), paragraph('Moved')] };
    const changes = compareManuscripts(original, updated, [], []);
    expect(changes.map(change => [change.start, change.end])).toEqual([[0, 1], [4, 4]]);
  });

  it('keeps Unicode characters intact in tracked ranges', () => {
    expect(manuscriptEditRange('a😀z', 'a😃z')).toEqual({ start: 1, end: 3, replacement: '😃' });
  });
});
