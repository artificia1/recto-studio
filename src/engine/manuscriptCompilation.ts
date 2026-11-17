import type { IngestedStory } from '../contentImport';
import { DEFAULT_PARAGRAPH_STYLES, INITIAL_STATE } from '../state/defaults';
import { PAGE_PRESETS, type ImageElement, type ParagraphStyle, type ProjectState, type Spread, type TextElement } from '../types';
import { layoutFrameNotes, publicationHeadings, reflowStoryState } from './publicationReferences';
import { layoutStory, type StoryMeasure } from './storyLayout';
import { storyText } from './storyContent';

export const manuscriptTrims = { 'trade-paperback-6x9': 'Book-Trade-6x9', 'digest-5.5x8.5': 'Digest-5.5x8.5' } as const;
export const signatureSizes = [4, 8, 16, 32] as const;
export const compiledPageLimit = 500;

export function signatureBudget(pages: number, signatureSize?: typeof signatureSizes[number], exactSignatures?: number) {
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > compiledPageLimit) throw new Error('The manuscript exceeds the supported page budget.');
  if (signatureSize !== undefined && !signatureSizes.includes(signatureSize)) throw new Error('Choose a 4, 8, 16 or 32-page signature.');
  if (exactSignatures !== undefined && !signatureSize) throw new Error('Set pages per signature before specifying a signature count.');
  const unit = signatureSize ?? 2;
  const units = Math.ceil(pages / unit);
  if (exactSignatures !== undefined && units !== exactSignatures) {
    throw new Error(`The layout needs ${units} signatures (${pages} manuscript pages). Review the trim or choose a different signature budget.`);
  }
  const deliveredPages = units * unit;
  if (deliveredPages > compiledPageLimit) throw new Error('Signature padding exceeds the 500-page delivery limit.');
  return { manuscriptPages: pages, deliveredPages, blankPages: deliveredPages - pages,
    signatureSize: signatureSize ?? null, signatures: signatureSize ? units : null };
}

interface Edition {
  trim: keyof typeof manuscriptTrims;
  title: string;
  author?: string;
  language: string;
  fontFamily: string;
  sourceRevision: string;
  pagesPerSignature?: typeof signatureSizes[number];
  exactSignatures?: number;
  padForDelivery?: boolean;
  paragraphStyles?: ParagraphStyle[];
  cover?: Pick<ImageElement, 'src' | 'proxySrc' | 'name' | 'altText' | 'fileSize' | 'format' | 'originalWidth' | 'originalHeight'>;
  resources?: Pick<ProjectState, 'embeddedFonts'> & { colorManagement?: ProjectState['settings']['colorManagement'] };
}

function newPage(number: number): Spread {
  return {
    id: `compiled-spread-${number}`, spreadIndex: number - 1,
    pages: [{ id: `compiled-page-${number}`, pageNumber: number, side: number % 2 ? 'right' : 'left' }],
    elements: [],
  };
}

/** Use the same story composer and metrics as the final PDF, with one editable thread. */
export function composeManuscript(input: IngestedStory, edition: Edition, measure: StoryMeasure) {
  if (!input.content || !input.formattedText.trim()) throw new Error('The manuscript has no readable text.');
  if (input.notes?.some(note => note.kind === 'endnote')) throw new Error('Convert DOCX endnotes to footnotes or place an endnote list in Recto before compiling.');
  const preset = manuscriptTrims[edition.trim];
  const size = PAGE_PRESETS[preset];
  const margins = { topMm: 19, bottomMm: 19, insideMm: 21, outsideMm: 17 };
  const width = size.widthMm - margins.insideMm - margins.outsideMm;
  const height = size.heightMm - margins.topMm - margins.bottomMm;
  const firstBodyPage = edition.cover ? 3 : 1;
  const styles = [...DEFAULT_PARAGRAPH_STYLES.map(style => ({
    ...style, fontFamily: edition.fontFamily, snapToBaseline: false, dropCapLines: 0,
    letterSpacingPt: 0, grepStyles: undefined, openTypeFeatures: undefined,
    fontSizePt: ({ 'style-title': 22, 'style-h1': 17, 'style-h2': 13, 'style-pullquote': 11, 'style-caption': 9 } as Record<string, number>)[style.id] ?? 11,
    lineHeight: 1.4, keepWithNext: ['style-title', 'style-h1', 'style-h2'].includes(style.id),
    orphanLines: 2, widowLines: 2,
  })), ...(edition.paragraphStyles ?? [])];
  const state: ProjectState = {
    ...structuredClone(INITIAL_STATE), spreads: [], masterSpreads: [], paragraphStyles: styles,
    embeddedFonts: edition.resources?.embeddedFonts, selectedElementId: null, selectedElementIds: [], activeSpreadIndex: 0,
    settings: {
      ...structuredClone(INITIAL_STATE.settings), ...size, preset, title: edition.title, author: edition.author,
      identifier: `urn:sha256:${edition.sourceRevision}`, language: edition.language, margins, columnCount: 1, facingPages: true,
      baselineGrid: { enabled: false, incrementPt: 12, startMm: margins.topMm },
      colorManagement: edition.resources?.colorManagement,
      footnotes: input.notes?.map((note, index) => ({ ...note, number: index + 1, anchorVersion: 1,
        elementId: `compiled-body-${firstBodyPage}`, pageId: `compiled-page-${firstBodyPage}` })) ?? [],
    },
  };
  const frame = (number: number, id: string): TextElement => ({
    id, pageId: `compiled-page-${number}`, type: 'text', text: '',
    x: number % 2 ? margins.insideMm : margins.outsideMm, y: margins.topMm, width, height,
    locked: false, opacity: 1, rotation: 0, zIndex: 1, fontFamily: edition.fontFamily, fontSizePt: 11,
    lineHeight: 1.4, letterSpacingPt: 0, color: '#000000', alignment: 'left', columns: 1, columnGutterMm: 0,
    paddingMm: 0, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0,
  });
  if (edition.cover) {
    const cover = newPage(1);
    cover.elements.push({ ...edition.cover, id: 'compiled-cover', type: 'image', pageId: cover.pages[0].id,
      x: 0, y: 0, width: size.widthMm, height: size.heightMm, fitMode: 'fit',
      rotation: 0, opacity: 1, zIndex: 1, locked: false, borderColor: 'transparent', borderWidthMm: 0 });
    state.spreads.push(cover, newPage(2));
  }
  const head = frame(firstBodyPage, `compiled-body-${firstBodyPage}`);
  head.paragraphStyleId = 'style-body';
  head.storyContent = structuredClone(input.content);
  const textLength = storyText(head.storyContent).length;
  let tail = head;
  function fillThrough(wanted: number) {
    for (let number = state.spreads.length + 1; number <= wanted; number++) {
      const spread = newPage(number);
      const body = number === firstBodyPage ? head : { ...frame(number, `compiled-body-${number}`), paragraphStyleId: 'style-body', prevFrameId: tail.id };
      if (number > firstBodyPage) tail.nextFrameId = body.id;
      spread.elements.push(body);
      state.spreads.push(spread);
      tail = body;
    }
  }
  fillThrough(Math.min(compiledPageLimit, firstBodyPage - 1 + Math.max(2, Math.ceil(input.wordCount / 300))));
  for (;;) {
    reflowStoryState(state, head.id, undefined, measure);
    const notes = layoutFrameNotes(state, tail);
    const layout = layoutStory(tail.textContent!, tail, styles, undefined, measure, notes.height);
    if (!layout.overset && !notes.remaining && !notes.unplacedAnchors) break;
    if (state.spreads.length === compiledPageLimit) throw new Error('The manuscript cannot fit in 500 pages with the selected trim and type. Split the manuscript or choose a larger trim.');
    fillThrough(Math.min(compiledPageLimit, state.spreads.length * 2));
  }
  const lastWithContent = state.spreads.findLastIndex(spread => {
    if (spread.pages[0].pageNumber < firstBodyPage) return false;
    const body = spread.elements[0] as TextElement;
    return (body.storyStart ?? 0) < textLength || layoutFrameNotes(state, body).lines.length > 0;
  });
  state.spreads.splice(lastWithContent + 1);
  delete (state.spreads.at(-1)!.elements[0] as TextElement).nextFrameId;
  const pageCount = state.spreads.length;
  const budget = edition.padForDelivery === false
    ? { manuscriptPages: pageCount, deliveredPages: pageCount, blankPages: 0, signatureSize: null, signatures: null }
    : signatureBudget(pageCount, edition.pagesPerSignature, edition.exactSignatures);
  const headings = publicationHeadings(state);
  let runningHead = edition.title;
  const chapterHeadings = new Map(headings.filter(heading => heading.level === 1).map(heading => [heading.pageNumber, heading.title]));
  function runningText(text: string, style: TextElement) {
    if (measure(text, style) <= style.width) return text;
    const glyphs = Array.from(text);
    let count = Math.min(120, glyphs.length);
    while (count > 0 && measure(glyphs.slice(0, count).join('') + '…', style) > style.width) count--;
    return glyphs.slice(0, count).join('') + '…';
  }
  for (let number = firstBodyPage; number <= budget.manuscriptPages; number++) {
    const heading = chapterHeadings.get(number);
    if (heading) runningHead = heading;
    const folio = { ...frame(number, `compiled-folio-${number}`), y: size.heightMm - 12, height: 6,
      fontSizePt: 9, alignment: 'center' as const, text: String(number), decorative: true };
    state.spreads[number - 1].elements.push(folio);
    if (number > firstBodyPage && !heading) {
      const header = { ...folio, id: `compiled-header-${number}`, y: 8 };
      header.text = runningText(number % 2 ? runningHead : edition.title, header);
      state.spreads[number - 1].elements.push(header);
    }
  }
  for (let number = budget.manuscriptPages + 1; number <= budget.deliveredPages; number++) state.spreads.push(newPage(number));
  const pages = state.spreads;
  state.spreads = [pages[0]];
  for (let index = 1; index < pages.length; index += 2) {
    const left = pages[index], right = pages[index + 1];
    state.spreads.push({
      ...left, spreadIndex: state.spreads.length,
      pages: [...left.pages, ...(right?.pages ?? [])],
      elements: [...left.elements, ...(right?.elements ?? [])],
    });
  }
  return { state, budget, headings };
}
