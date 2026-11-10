import { describe, expect, it } from 'vitest';
import { bookCoverDimensions, buildBookDelivery, defaultBookDelivery } from '../src/engine/bookDelivery';
import { StateManager } from '../src/state/stateManager';
import { readZip } from '../src/zip';
import type { ProjectState, TextElement } from '../src/types';

function document(title: string): ProjectState {
  const manager = new StateManager();
  manager.createBlankProject('A4', title, false);
  const spread = manager.getActiveSpread();
  const frame: TextElement = {
    id: 'text', pageId: spread.pages[0].id, type: 'text', text: title,
    x: 25, y: 25, width: 125, height: 35, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    fontFamily: 'Times', fontSizePt: 14, lineHeight: 1.3, letterSpacingPt: 0, color: '#111111',
    alignment: 'left', columns: 1, columnGutterMm: 4, backgroundColor: 'transparent',
    borderColor: 'transparent', borderWidthMm: 0, paddingMm: 2,
  };
  manager.addElement(frame);
  return manager.getState();
}

describe('book delivery package', () => {
  it('requires a new cover review when the assembled pagination changes the spine', async () => {
    const book = document('Long book');
    const original = bookCoverDimensions(book.settings, 64, defaultBookDelivery);
    const changed = bookCoverDimensions(book.settings, 128, defaultBookDelivery);
    expect(changed.spine).toBeGreaterThan(original.spine);
    expect(changed.signature).not.toBe(original.signature);
    const cover = document('Old cover');
    Object.assign(cover.settings, { widthMm: original.width, heightMm: original.height, bleedMm: original.bleed });
    expect(bookCoverDimensions(book.settings, 128, { ...defaultBookDelivery, cover }).matches).toBe(false);
  });

  it('builds and validates separate interior, cover, EPUB and report files', async () => {
    const book = document('Collected stories');
    const cover = document('Cover');
    const dimensions = bookCoverDimensions(book.settings, 1, defaultBookDelivery);
    Object.assign(cover.settings, { widthMm: dimensions.width, heightMm: dimensions.height, bleedMm: dimensions.bleed });
    const recipe = { ...defaultBookDelivery, cover };
    await expect(buildBookDelivery(book, recipe)).rejects.toThrow(/approve the cover/i);
    const files = await readZip(await buildBookDelivery(book, { ...recipe, approvedDimensions: dimensions.signature }));
    expect([...files.keys()]).toEqual(['interior.pdf', 'cover.pdf', 'ebook.epub', 'delivery-report.json']);
    expect(JSON.parse(new TextDecoder().decode(files.get('delivery-report.json')))).toMatchObject({
      title: 'Collected stories', dimensions: { pageCount: 1 }, preset: 'press',
    });
  });
});
