import { describe, expect, it } from 'vitest';
import { generateFixedEpubPackage } from '../src/export/fixedEpub';
import { StateManager } from '../src/state/stateManager';
import type { TextElement } from '../src/types';

describe('fixed-layout EPUB', () => {
  it('writes one XHTML page per physical page with live text and explicit reading order', () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Fixed edition', false);
    const first = manager.getActiveSpread(), pageId = first.pages[0].id;
    const text: TextElement = {
      type: 'text', id: 'first', pageId, text: 'Read second', x: 20, y: 20, width: 80, height: 30,
      rotation: 0, opacity: 1, zIndex: 1, locked: false, fontFamily: 'Georgia', fontSizePt: 12,
      lineHeight: 1.3, letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4,
      backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paddingMm: 2, readingOrder: 2,
    };
    first.elements.push(text, { ...text, id: 'second', text: 'Read first', y: 55, readingOrder: 1 });
    manager.getState().spreads.push({ id: 'blank-spread', spreadIndex: 1,
      pages: [{ id: 'blank', pageNumber: 2, side: 'single' }], elements: [] });
    const files = generateFixedEpubPackage(manager.getState());
    expect(files['OEBPS/package.opf']).toContain('rendition:layout">pre-paginated');
    expect(files['OEBPS/page-2.xhtml']).toContain('<title>Page 2</title>');
    const page = String(files['OEBPS/page-1.xhtml']);
    expect(page).toContain('name="viewport"');
    const liveText = page.replace(/<[^>]*>/g, '');
    expect(liveText).toContain('Read first');
    expect(liveText.indexOf('Read first')).toBeLessThan(liveText.indexOf('Read second'));
    text.blendMode = 'multiply';
    expect(() => generateFixedEpubPackage(manager.getState())).toThrow(/Page 1: spot inks, blend modes or shadows/);
  });
});
