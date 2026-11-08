import type { DocumentSettings, Spread, TextElement } from '../types';
import { plainStory } from './storyContent';

export type PublicationStarter = 'fiction' | 'nonfiction' | 'article';
export const PUBLICATION_STARTERS = [
  { id: 'fiction' as const, name: 'Fiction chapter', description: 'A quiet chapter opening, linked reading pages and running folios.' },
  { id: 'nonfiction' as const, name: 'Nonfiction chapter', description: 'A chapter heading, generous reading measure and linked continuation.' },
  { id: 'article' as const, name: 'Editorial article', description: 'A two-column article with linked continuation, running heads and folios.' },
];

/** Uses the current trim and margins; adding a starter never replaces existing pages. */
export function createPublicationStarter(settings: DocumentSettings, kind: PublicationStarter, title: string): Spread {
  if (!PUBLICATION_STARTERS.some(starter => starter.id === kind)) throw new Error('Choose a publication starter.');
  if (!title.trim() || title.length > 200) throw new Error('Enter a chapter or article title of up to 200 characters.');
  const { widthMm: width, heightMm: height, margins } = settings;
  const bodyWidth = width - margins.insideMm - margins.outsideMm;
  const bodyHeight = height - margins.topMm - margins.bottomMm;
  if (bodyWidth < 60 || bodyHeight < 90) throw new Error('This starter needs at least 60 × 90 mm inside the page margins.');
  const pages = [0, 1].map(index => ({ id: `starter-page-${index}`, pageNumber: index + 1, side: (index ? 'right' : 'left') as 'right' | 'left' }));
  const frame = (id: string, index: number, text: string, y: number, h: number, size = 11): TextElement => ({
    id, type: 'text', pageId: pages[index].id, name: id.replace(/starter-/g, '').replace(/-/g, ' '),
    x: index ? margins.insideMm : margins.outsideMm, y, width: bodyWidth, height: h,
    text, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    fontFamily: 'Georgia, serif', fontSizePt: size, lineHeight: 1.45, letterSpacingPt: 0,
    color: '#222222', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0,
    backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0,
  });
  const opening = kind === 'fiction' ? Math.min(35, bodyHeight * 0.18) : 0;
  const headingHeight = Math.min(25, bodyHeight * 0.2);
  const heading = frame('starter-chapter-title', 0, title.trim(), margins.topMm + opening, headingHeight, 24);
  heading.paragraphStyleId = 'style-h1';
  const firstY = heading.y + headingHeight + 8;
  const first = frame('starter-body', 0, 'Begin your manuscript here.', firstY, height - margins.bottomMm - firstY);
  const second = frame('starter-continuation', 1, '', margins.topMm, bodyHeight);
  first.nextFrameId = second.id; second.prevFrameId = first.id;
  first.storyContent = plainStory(first.text); first.rawStoryText = first.text; first.autoExtendStory = true;
  first.columns = second.columns = kind === 'article' ? 2 : 1;
  const elements: TextElement[] = [heading, first, second];
  pages.forEach((page, index) => {
    if (margins.bottomMm >= 10) {
      const footer = frame(`starter-folio-${index}`, index, '{{page}}', height - margins.bottomMm + 3, 6, 9);
      footer.alignment = index ? 'right' : 'left'; elements.push(footer);
    }
    if (index && margins.topMm >= 12) {
      const header = frame('starter-running-head', index, '{{chapterTitle}}', margins.topMm - 9, 6, 9);
      header.alignment = 'right'; elements.push(header);
    }
  });
  return { id: 'starter-spread', spreadIndex: 0, pages, elements };
}
