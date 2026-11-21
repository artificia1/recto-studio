import { describe, expect, it, vi } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import type { TextElement } from '../src/types';

function linkedStory() {
  const manager = new StateManager();
  manager.createBlankProject('A4', 'Geometry commits', false);
  manager.updateSettings({ baselineGrid: { enabled: false, incrementPt: 12, startMm: 25 } });
  const frame = (id: string, y: number): TextElement => ({
    id, type: 'text', pageId: manager.getActiveSpread().pages[0].id, x: 25, y, width: 80, height: 35,
    text: '', fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.4, letterSpacingPt: 0, alignment: 'left',
    color: '#000000', backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0,
    columns: 1, columnGutterMm: 4, paddingMm: 0, rotation: 0, opacity: 1, zIndex: 1, locked: false,
  });
  manager.addElement(frame('body', 25));
  manager.addElement(frame('tail', 100));
  manager.linkTextFrames('body', 'tail');
  manager.setStoryContent('body', { version: 1, paragraphs: [{ runs: [{ text: 'The story remains complete while its frame is moved. '.repeat(30) }] }] });
  return manager;
}

function flow(manager: StateManager) {
  return ['body', 'tail'].map(id => {
    const frame = manager.getElementById(id) as TextElement;
    return { text: frame.text, start: frame.storyStart, end: frame.storyEnd };
  });
}

describe('committed geometry changes', () => {
  it('keeps plain translated text composed, with one undo and redo', () => {
    const manager = linkedStory();
    const before = flow(manager);
    const reflow = vi.spyOn(manager, 'reflowStory');
    manager.updateElements([{ id: 'body', partial: { x: 40, y: 40 } }]);
    expect(reflow).not.toHaveBeenCalled();
    expect(flow(manager)).toEqual(before);
    expect(manager.getElementById('body')?.x).toBe(40);
    manager.undo();
    expect(manager.getElementById('body')?.x).toBe(25);
    expect(flow(manager)).toEqual(before);
    manager.redo();
    expect(manager.getElementById('body')?.x).toBe(40);
    expect(flow(manager)).toEqual(before);
  });

  it.each(['grid', 'wrap', 'width'] as const)('recomposes once when %s can change the line positions', dependency => {
    const manager = linkedStory();
    if (dependency === 'grid') manager.updateSettings({ baselineGrid: { enabled: true, incrementPt: 12, startMm: 25 } });
    if (dependency === 'wrap') manager.addElement({
      id: 'wrap', pageId: manager.getActiveSpread().pages[0].id, type: 'shape', shapeKind: 'rect',
      x: 50, y: 40, width: 20, height: 20, rotation: 0, opacity: 1, zIndex: 2, locked: false,
      fillColor: '#ffffff', strokeColor: '#000000', strokeWidthMm: 0,
      textWrap: { mode: 'boundingBox', standoffMm: 2 },
    });
    const story = (manager.getElementById('body') as TextElement).rawStoryText;
    const reflow = vi.spyOn(manager, 'reflowStory');
    manager.updateElements([{ id: 'body', partial: dependency === 'width' ? { width: 50 } : { x: 40, y: 40 } }]);
    expect(reflow).toHaveBeenCalledTimes(1);
    expect((manager.getElementById('body') as TextElement).rawStoryText).toBe(story);
  });
});
