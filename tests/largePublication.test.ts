import { expect, it } from 'vitest';
import { bookEngine } from '../src/engine/bookEngine';
import { generateFixedEpubPackage } from '../src/export/fixedEpub';
import { StateManager } from '../src/state/stateManager';
import type { ImageElement, ProjectState, TextElement } from '../src/types';

function publication(title: string, count: number): ProjectState {
  const manager = new StateManager();
  manager.createBlankProject('A4', title, false);
  const state = manager.getState();
  state.spreads = Array.from({ length: count }, (_, index) => ({
    id: `spread-${index}`, spreadIndex: index,
    pages: [{ id: `page-${index}`, pageNumber: index + 1, side: 'single' }],
    elements: [],
  }));
  return state;
}

it('assembles and renders a 300-page nonfiction book', async () => {
  const chapters = Array.from({ length: 3 }, (_, index) => publication(`Chapter ${index + 1}`, 100));
  for (const chapter of chapters) chapter.spreads.forEach((spread, index) => {
    const frame: TextElement = {
      id: `frame-${index}`, pageId: spread.pages[0].id, type: 'text', x: 20, y: 30, width: 150, height: 100,
      rotation: 0, opacity: 1, zIndex: 1, locked: false, fontFamily: 'Times', fontSizePt: 12, lineHeight: 1.3,
      letterSpacingPt: 0, alignment: 'left', color: '#111111', columns: 1, columnGutterMm: 4,
      backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paddingMm: 2,
      ...(index === 0 ? { paragraphStyleId: 'style-h1' } : {}),
      text: index === 0 ? chapter.settings.title : `Editorial body copy for page ${index + 1}. `.repeat(4),
    };
    spread.elements.push(frame);
  });
  const book = bookEngine.createBook('Collected nonfiction', chapters.map((chapter, index) =>
    ({ title: chapter.settings.title, filePath: String(index) })));
  const load = (key: string) => chapters[Number(key)];
  expect(bookEngine.generateUnifiedBookToc(book, load).map(item => item.pageNumber)).toEqual([1, 101, 201]);
  const pdf = await bookEngine.exportBookToPdf(book, load, { download: false });
  expect(pdf.getNumberOfPages()).toBe(300);
}, 120000);

it('exports an image-heavy magazine with deduplicated files and preserved descriptions', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const artwork = Array.from({ length: 8 }, (_, index) => {
    const canvas = createCanvas(100, 100), ctx = canvas.getContext('2d');
    ctx.fillStyle = `hsl(${index * 45}, 70%, 50%)`;
    ctx.fillRect(0, 0, 100, 100);
    return canvas.toDataURL('image/png');
  });
  const magazine = publication('Illustrated issue', 32);
  for (const [page, spread] of magazine.spreads.entries()) for (let slot = 0; slot < 6; slot++) {
    const image: ImageElement = { id: `art-${page}-${slot}`, pageId: spread.pages[0].id, type: 'image',
      x: 10 + slot % 3 * 64, y: 10 + Math.floor(slot / 3) * 64, width: 60, height: 60, rotation: 0, opacity: 1, zIndex: slot,
      locked: false, src: artwork[(page + slot) % artwork.length], altText: `Illustration ${slot + 1} on page ${page + 1}`,
      fitMode: 'fit', borderWidthMm: 0, borderColor: 'transparent' };
    spread.elements.push(image);
  }
  const files = generateFixedEpubPackage(magazine);
  expect(Object.keys(files).filter(name => /^OEBPS\/page-\d+\.xhtml$/.test(name))).toHaveLength(32);
  expect(Object.keys(files).filter(name => /^OEBPS\/image-/.test(name))).toHaveLength(8);
  expect(files['OEBPS/page-32.xhtml']).toContain('Illustration 6 on page 32');
});
