import { describe, expect, it, vi } from 'vitest';
import { CollaborativeDocument, sharedProject } from '../src/engine/collaborativeDocument';
import { INITIAL_STATE } from '../src/state/stateManager';
import type { TextElement } from '../src/types';

function setup() {
  const baseline = sharedProject(structuredClone(INITIAL_STATE));
  const text = baseline.spreads[0].elements.find(element => element.type === 'text') as TextElement;
  text.text = text.rawStoryText = 'Hello world'; delete text.storyContent; delete text.prevFrameId;
  const a = new CollaborativeDocument(baseline), b = new CollaborativeDocument(baseline);
  const frame = (doc: CollaborativeDocument) => doc.snapshot().spreads[0].elements.find(element => element.id === text.id) as TextElement;
  const edit = (doc: CollaborativeDocument, change: Partial<TextElement>) => {
    const state = doc.snapshot(), element = state.spreads[0].elements.find(element => element.id === text.id)!;
    Object.assign(element, change); doc.update(state);
  };
  return { a, b, frame, edit, baseline };
}

describe('publication CRDT', () => {
  it('seeds the same replica identities across different system collations', () => {
    const baseline = sharedProject(structuredClone(INITIAL_STATE));
    const a = new CollaborativeDocument(baseline);
    const collation = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (other) { return String(this) < String(other) ? 1 : -1; });
    let b: CollaborativeDocument;
    try { b = new CollaborativeDocument(baseline); } finally { collation.mockRestore(); }
    try {
      const snapshot = a.snapshot(); snapshot.settings.title = 'Shared across locales'; a.update(snapshot);
      b.apply(a.encode()); expect(b.snapshot()).toEqual(a.snapshot());
    } finally { a.destroy(); b!.destroy(); }
  });
  it('merges simultaneous character edits without duplicating baseline text', () => {
    const { a, b, edit, frame } = setup();
    edit(a, { text: 'Hello brave world', rawStoryText: 'Hello brave world' });
    edit(b, { text: 'Hello world!', rawStoryText: 'Hello world!' });
    const left = a.encode(), right = b.encode(); a.apply(right); b.apply(left);
    expect(frame(a).text).toBe('Hello brave world!'); expect(a.snapshot()).toEqual(b.snapshot());
    a.apply(right); expect(frame(a).text).toBe('Hello brave world!');
    a.destroy(); b.destroy();
  });
  it('retains copy edits alongside independent geometry and typography edits', () => {
    const { a, b, edit, frame } = setup();
    edit(a, { text: 'Revised world', rawStoryText: 'Revised world' });
    edit(b, { x: 57, fontSizePt: 22 });
    const left = a.encode(), right = b.encode(); a.apply(right); b.apply(left);
    expect(frame(a)).toMatchObject({ text: 'Revised world', x: 57, fontSizePt: 22 });
    expect(a.snapshot()).toEqual(b.snapshot()); a.destroy(); b.destroy();
  });
  it('undoes only local changes after receiving a remote edit', () => {
    const { a, b, edit, frame } = setup();
    edit(a, { x: 57 }); edit(b, { text: 'Other copy', rawStoryText: 'Other copy' });
    a.apply(b.encode()); a.undo();
    expect(frame(a).text).toBe('Other copy'); expect(frame(a).x).not.toBe(57);
    a.redo(); expect(frame(a).x).toBe(57); a.destroy(); b.destroy();
  });
  it('converges after deletion races and preserves deterministic collection order', () => {
    const { a, b, edit, baseline } = setup();
    const id = baseline.spreads[0].elements.find(element => element.type === 'text')!.id;
    const state = a.snapshot(); state.spreads[0].elements = state.spreads[0].elements.filter(element => element.id !== id); a.update(state);
    edit(b, { x: 42 }); const left = a.encode(), right = b.encode(); a.apply(right); b.apply(left);
    expect(a.snapshot()).toEqual(b.snapshot()); expect(a.snapshot().spreads[0].elements.some(element => element.id === id)).toBe(false);
    a.destroy(); b.destroy();
  });
  it('loads a late peer using the original baseline plus accumulated updates', () => {
    const { a, b, edit, baseline } = setup(); edit(a, { text: 'New manuscript', rawStoryText: 'New manuscript' });
    const late = new CollaborativeDocument(baseline); late.apply(a.encode());
    expect(late.snapshot()).toEqual(a.snapshot()); a.destroy(); b.destroy(); late.destroy();
  });
});
