import { describe, expect, it } from 'vitest';
import { createLayoutLink, previewLayoutLink, readLayoutBundle, type LayoutBundle } from '../src/engine/layoutBundle';
import { StateManager } from '../src/state/stateManager';
import type { TextElement } from '../src/types';

function layout(id: string, text: string, width: number) {
  const manager = new StateManager();
  manager.createBlankProject('A4', id, false);
  manager.updateSettings({ widthMm: width });
  const pageId = manager.getActiveSpread().pages[0].id;
  const frame: TextElement = {
    type: 'text', id: 'story', pageId, text, x: 20, y: 30, width: width - 40, height: 80,
    rotation: 0, opacity: 1, zIndex: 1, locked: false, fontFamily: 'Georgia', fontSizePt: 12,
    lineHeight: 1.3, letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4,
    backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paddingMm: 2,
  };
  manager.addElement(frame);
  return { id, name: id, state: manager.getState() };
}

describe('portable shared layouts', () => {
  it('updates two layout sizes independently and preserves their geometry', async () => {
    let bundle: LayoutBundle = { version: 1, layouts: [layout('source', 'Shared story', 210),
      layout('compact', 'Draft one', 140), layout('wide', 'Draft two', 240)], links: [] };
    const linkTo = (id: string) => createLayoutLink(bundle, {
      sourceLayoutId: 'source', sourceElementId: 'story', targetLayoutId: id, targetElementId: 'story',
    });
    bundle.links = [await linkTo('compact'), await linkTo('wide')];
    for (const link of bundle.links) {
      const preview = await previewLayoutLink(bundle, link);
      expect(preview.conflict).toBe(false);
      expect(preview.after).toBe('Shared story');
      bundle = preview.next;
    }
    expect(bundle.layouts.slice(1).map(item => item.state.spreads[0].elements[0])).toMatchObject([
      { text: 'Shared story', x: 20, width: 100 }, { text: 'Shared story', x: 20, width: 200 },
    ]);
    const reopened = readLayoutBundle(JSON.stringify(bundle), JSON.parse);
    expect((await previewLayoutLink(reopened, reopened.links[0])).changed).toBe(false);
    const edited = reopened.layouts[1].state.spreads[0].elements[0] as TextElement;
    edited.storyContent = { version: 1, paragraphs: [{ runs: [{ text: 'Local correction' }] }] };
    const preview = await previewLayoutLink(reopened, reopened.links[0]);
    expect(preview.conflict).toBe(true);
    expect(preview.before).toBe('Local correction');
  });
});
