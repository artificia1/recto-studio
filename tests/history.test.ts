import { describe, expect, it } from 'vitest';
import { StateHistory } from '../src/state/history';
import { INITIAL_STATE } from '../src/state/stateManager';
import { INITIAL_STATE as defaults } from '../src/state/defaults';

describe('Document history', () => {
  it('preserves the existing public defaults export', () => {
    expect(INITIAL_STATE).toBe(defaults);
  });
  it('respects the configured capacity and both navigation boundaries', () => {
    const history = new StateHistory<{ value: number }>(3);
    for (let value = 0; value < 5; value++) history.push({ value });
    expect(history.undo()).toEqual({ value: 3 });
    expect(history.undo()).toEqual({ value: 2 });
    expect(history.undo()).toBeNull();
    expect(history.redo()).toEqual({ value: 3 });
    expect(history.redo()).toEqual({ value: 4 });
    expect(history.redo()).toBeNull();
  });
  it('discards the old redo branch when editing after undo', () => {
    const history = new StateHistory<string>();
    history.push('A'); history.push('B'); history.push('C');
    expect(history.undo()).toBe('B');
    history.push('D');
    expect(history.redo()).toBeNull();
    expect(history.undo()).toBe('B');
    expect(history.redo()).toBe('D');
  });
  it('isolates stored snapshots from input and restored-state mutations', () => {
    const history = new StateHistory<{ nested: { value: number } }>();
    const first = { nested: { value: 1 } };
    history.push(first);
    first.nested.value = 99;
    history.push({ nested: { value: 2 } });
    const restored = history.undo()!;
    expect(restored.nested.value).toBe(1);
    restored.nested.value = 88;
    history.redo();
    expect(history.undo()?.nested.value).toBe(1);
  });
  it('resets completely when starting a new document', () => {
    const history = new StateHistory<number>();
    history.push(1); history.push(2); history.clear();
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    history.push(3);
    expect(history.undo()).toBeNull();
  });
  it('restores partitioned snapshots with reordered spreads and isolated nested data', () => {
    const history = new StateHistory<{ title: string; spreads: { id: string; copy: string }[] }>(3, 'spreads');
    const document = { title: 'Book', spreads: [{ id: 'a', copy: 'Original' }, { id: 'b', copy: 'Second' }] };
    const first = JSON.stringify(document);
    history.push(document);
    document.spreads[0].copy = 'Revised';
    history.push(document);
    document.spreads.reverse();
    history.push(document);
    expect(history.undo()?.spreads.map(spread => spread.id)).toEqual(['a', 'b']);
    const restored = history.undo()!;
    expect(JSON.stringify(restored)).toBe(first);
    restored.spreads[0].copy = 'Discard this temporary edit';
    expect(history.redo()?.spreads[0].copy).toBe('Revised');
    expect(history.redo()?.spreads.map(spread => spread.id)).toEqual(['b', 'a']);
  });

  it('restores large manuscripts and image sources alongside independent geometry edits', () => {
    const copy = 'Quoted manuscript “text” with a newline.\n'.repeat(1_400);
    const src = 'data:image/png;base64,' + 'abcd'.repeat(12_000);
    const text = { type: 'text', x: 10, text: copy, rawStoryText: copy,
      storyContent: { version: 1, paragraphs: [{ runs: [{ text: copy }] }] } };
    const image = { type: 'image', x: 20, src };
    const document = { title: 'Large document', spreads: [{ id: 'spread', elements: [text, image] }] };
    const history = new StateHistory<typeof document>(30, 'spreads');
    const before = JSON.stringify(document);
    history.push(document);
    text.x = 23;
    history.push(document);
    text.storyContent.paragraphs[0].runs[0].text = 'Changed content';
    history.push(document);
    expect(history.undo()?.spreads[0].elements[0]).toMatchObject({ x: 23, storyContent: {
      paragraphs: [{ runs: [{ text: copy }] }],
    } });
    expect(JSON.stringify(history.undo())).toBe(before);
    expect(history.redo()?.spreads[0].elements[1]).toEqual(image);
  });
});
