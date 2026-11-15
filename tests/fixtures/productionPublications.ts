import type { ImageElement, ProjectState, Spread, TextElement } from '../../src/types';
import { INITIAL_STATE } from '../../src/state/defaults';
import { plainStory } from '../../src/engine/storyContent';
import type { BookArchive } from '../../src/engine/bookArchive';

const body = 'The archive records how a publication moves from manuscript to print. Reviewers examine the structure, verify quotations, and check that illustrations still appear beside their captions. A stable edition makes small corrections easier to approve.';

export function textFixture(id: string, pageId: string, text: string, geometry: Partial<Pick<TextElement, 'x' | 'y' | 'width' | 'height'>> = {}): TextElement {
  return {
    id, pageId, type: 'text', text, x: 20, y: 22, width: 165, height: 230, ...geometry,
    fontFamily: 'Helvetica', fontSizePt: 10, lineHeight: 1.3, letterSpacingPt: 0, color: '#1e1d1b',
    alignment: 'left', columns: 1, columnGutterMm: 4, backgroundColor: 'transparent', borderColor: 'transparent',
    borderWidthMm: 0, paddingMm: 1, rotation: 0, opacity: 1, locked: false, layerId: 'layer-1', zIndex: 1,
  };
}

export function emptyProductionProject(title: string): ProjectState {
  return { ...structuredClone(INITIAL_STATE), settings: { ...structuredClone(INITIAL_STATE.settings), title, facingPages: false },
    spreads: [], masterSpreads: [], selectedElementId: null, selectedElementIds: [], activeSpreadIndex: 0 };
}

export function productionSpread(index: number, prefix: string): Spread {
  return { id: prefix + '-spread-' + index, spreadIndex: index,
    pages: [{ id: prefix + '-page-' + index, pageNumber: index + 1, side: 'single' }], elements: [] };
}

export function nonfictionBookFixture(): BookArchive {
  // Ten independent chapters with 25 single-page frames in each story.
  const chapters = Array.from({ length: 10 }, (_, chapter) => {
    const id = 'chapter-' + (chapter + 1);
    const state = emptyProductionProject('Field notes ' + (chapter + 1));
    state.spreads = Array.from({ length: 25 }, (_, index) => {
      const spread = productionSpread(index, id);
      const frame = textFixture(id + '-frame-' + index, spread.pages[0].id, '');
      frame.prevFrameId = index ? id + '-frame-' + (index - 1) : undefined;
      frame.nextFrameId = index < 24 ? id + '-frame-' + (index + 1) : undefined;
      if (!index) {
        frame.storyContent = plainStory(Array.from({ length: 300 }, (_, row) => 'Entry ' + (row + 1) + '. ' + body).join('\n\n'));
        frame.storyContent.paragraphs.forEach((paragraph, row) => { paragraph.id = id + '-paragraph-' + row; });
      }
      spread.elements.push(frame);
      return spread;
    });
    return { id, name: id + '.recto', state, recto: false };
  });
  return { title: 'Field notes', chapters, references: [] };
}

export function editorialMagazineFixture(images: readonly string[]) {
  if (images.length < 3) throw new Error('The magazine fixture needs at least three raster assets.');
  const state = emptyProductionProject('Field journal');
  state.spreads = Array.from({ length: 40 }, (_, index) => {
    const spread = productionSpread(index, 'magazine');
    const pageId = spread.pages[0].id;
    const heading = textFixture('heading-' + index, pageId, 'Field journal · ' + (index + 1), { y: 14, height: 22 });
    heading.fontSizePt = 24;
    spread.elements.push(heading);
    for (let image = 0; image < 3; image++) {
      const portrait: ImageElement = {
        id: 'image-' + index + '-' + image, pageId, type: 'image', src: images[(index * 3 + image) % images.length],
        altText: 'Synthetic photographic test panel ' + (image + 1), x: 18 + image * 60, y: 50, width: 55, height: 110,
        originalWidth: 640, originalHeight: 480, fitMode: 'fill', borderWidthMm: 0, borderColor: 'transparent',
        rotation: 0, opacity: 1, locked: false, layerId: 'layer-1', zIndex: image + 2,
      };
      spread.elements.push(portrait);
    }
    const article = textFixture('article-' + index, pageId, body.repeat(3), { y: 175, height: 95 });
    article.storyContent = plainStory(article.text);
    spread.elements.push(article);
    return spread;
  });
  return state;
}
