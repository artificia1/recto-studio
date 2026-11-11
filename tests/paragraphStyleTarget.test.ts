import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stateManager } from '../src/state/stateManager';
import { TextElement } from '../src/types/index';
import { paragraphIndicesForRange, planParagraphStyleTarget } from '../src/utils/paragraphStyleTarget';
import { applyParagraphStyleToSelection } from '../src/utils/paragraphStyleApply';

describe('paragraphIndicesForRange (caret / selection -> paragraphs)', () => {
  const text = 'First\nSecond\n\nFourth'; // paragraphs at 0-5, 6-12, 13, 14-20
  const at = (start: number, end: number = start) => paragraphIndicesForRange(text, start, end);

  it('maps a caret to exactly one paragraph, including both ends of a line', () => {
    expect(at(0)).toEqual([0]);
    expect(at(5)).toEqual([0]); // end of "First", before its newline
    expect(at(6)).toEqual([1]); // start of "Second"
    expect(at(9)).toEqual([1]);
    expect(at(13)).toEqual([2]); // the empty paragraph
    expect(at(text.length)).toEqual([3]); // end of text
  });

  it('covers every paragraph a selection contains a character of', () => {
    expect(at(2, 9)).toEqual([0, 1]);
    expect(at(0, text.length)).toEqual([0, 1, 2, 3]);
    expect(at(8, 9)).toEqual([1]);
  });

  it('does not reach into the next paragraph when a selection ends where it begins', () => {
    expect(at(0, 6)).toEqual([0]); // "First" plus its newline
    expect(at(6, 13)).toEqual([1]); // "Second" plus its newline
  });

  it('counts a selected paragraph mark as part of its paragraph', () => {
    expect(at(5, 7)).toEqual([0, 1]);
  });

  it('accepts a reversed (backwards) selection', () => {
    expect(at(9, 2)).toEqual([0, 1]);
  });

  it('returns null when the positions are unavailable', () => {
    expect(paragraphIndicesForRange(text, null, null)).toBeNull();
  });
});

describe('planParagraphStyleTarget', () => {
  const text = 'Heading\nBody one\nBody two';

  it('targets a range for a caret inside one paragraph', () => {
    expect(planParagraphStyleTarget(text, 10, 10)).toEqual({ kind: 'range', start: 10, end: 10 });
  });

  it('targets a range spanning the touched paragraphs', () => {
    expect(planParagraphStyleTarget(text, 3, 12)).toEqual({ kind: 'range', start: 3, end: 12 });
  });

  it('shifts the range by where the frame starts inside a threaded story', () => {
    expect(planParagraphStyleTarget(text, 10, 10, 500)).toEqual({ kind: 'range', start: 510, end: 510 });
    expect(planParagraphStyleTarget(text, 12, 3, 500)).toEqual({ kind: 'range', start: 503, end: 512 });
  });

  it('applies to the whole frame when the selection reaches every paragraph', () => {
    expect(planParagraphStyleTarget(text, 0, text.length)).toEqual({ kind: 'frame' });
    expect(planParagraphStyleTarget(text, 2, text.length - 2)).toEqual({ kind: 'frame' });
  });

  it('applies to the whole frame when it has a single paragraph', () => {
    expect(planParagraphStyleTarget('Just one paragraph', 4, 4)).toEqual({ kind: 'frame' });
  });
});

function frame(text: string): TextElement {
  return {
    id: 'sel-sample',
    type: 'text',
    pageId: stateManager.getActiveSpread().pages[0].id,
    x: 20,
    y: 20,
    width: 100,
    height: 80,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    text,
    fontFamily: 'Inter, sans-serif',
    fontSizePt: 10,
    lineHeight: 1.4,
    letterSpacingPt: 0,
    color: '#111111',
    alignment: 'left',
    columns: 1,
    columnGutterMm: 4,
    borderColor: 'transparent',
    borderWidthMm: 0,
    backgroundColor: 'transparent',
    paddingMm: 2,
  };
}

describe('applyParagraphStyleToSelection (UI bridge)', () => {
  const text = 'Heading\nFirst body paragraph\nSecond body paragraph';

  beforeEach(() => {
    stateManager.resetToDefault();
    stateManager.addElement(frame(text));
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  const withEditorSelection = (start: number, end: number = start) => {
    (globalThis as any).window = {
      recto: { spreadCanvas: { getActiveTextSelection: () => ({ text, start, end }) } },
    };
  };

  const get = () => stateManager.getActiveSpread().elements.find(e => e.id === 'sel-sample') as TextElement;
  const styles = () => (get().storyContent?.paragraphs ?? []).map(p => p.styleId ?? null);

  it('styles only the paragraph under the caret', () => {
    withEditorSelection(text.indexOf('First') + 2);
    applyParagraphStyleToSelection('sel-sample', 'style-h1');

    expect(styles()).toEqual([null, 'style-h1', null]);
    // The frame itself is untouched.
    expect(get().paragraphStyleId).toBeUndefined();
    expect(get().fontSizePt).toBe(10);
  });

  it('styles every paragraph a selection touches', () => {
    withEditorSelection(2, text.indexOf('First') + 3);
    applyParagraphStyleToSelection('sel-sample', 'style-h2');
    expect(styles()).toEqual(['style-h2', 'style-h2', null]);
  });

  it('applies to the whole frame when the frame is not being edited', () => {
    // no editor open -> the canvas reports no selection
    (globalThis as any).window = { recto: { spreadCanvas: { getActiveTextSelection: () => null } } };
    applyParagraphStyleToSelection('sel-sample', 'style-h1');

    const h1 = stateManager.getState().paragraphStyles.find(s => s.id === 'style-h1')!;
    expect(get().paragraphStyleId).toBe('style-h1');
    expect(get().fontSizePt).toBe(h1.fontSizePt);
  });

  it('applies to the whole frame when there is no canvas at all', () => {
    (globalThis as any).window = {};
    applyParagraphStyleToSelection('sel-sample', 'style-h1');
    expect(get().paragraphStyleId).toBe('style-h1');
  });

  it('applies to the whole frame when the selection reaches every paragraph', () => {
    withEditorSelection(0, text.length);
    applyParagraphStyleToSelection('sel-sample', 'style-h1');
    expect(get().paragraphStyleId).toBe('style-h1');
  });
});
