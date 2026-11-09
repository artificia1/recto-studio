import { describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { compareProofPages, uniqueProofMatches } from '../src/engine/proofComparison';
import { reviewPinPosition } from '../src/engine/reviewPins';
import { checkPrinterProfile, parsePrinterProfile } from '../src/engine/printerProfiles';
import { publicationCaptions } from '../src/engine/publicationCaptions';
import { publicationSnapshot } from '../src/engine/publicationReferences';
import { assembleBook } from '../src/engine/bookAssembly';
import { bookEngine } from '../src/engine/bookEngine';
import type { CommentPin, ImageElement, ShapeElement, TextElement } from '../src/types';

const page = (signature: string, textSignature = 'text', width = 210) => ({ signature, textSignature, width, height: 297 });
const image = (pageId: string, id: string, y: number): ImageElement => ({ id, pageId, type: 'image', x: 20, y, width: 100, height: 60,
  src: '', opacity: 1, rotation: 0, locked: false, zIndex: 1, fitMode: 'stretch', borderColor: 'transparent', borderWidthMm: 0,
  originalWidth: 400, originalHeight: 400 });

describe('production review workflows', () => {
  it('distinguishes proof changes and declines ambiguous page matches', () => {
    expect(compareProofPages([page('a'), page('b'), page('c'), page('d')], [page('a'), page('art'), page('e', 'new'), page('d', 'text', 200), page('f')]))
      .toEqual(['unchanged', 'artwork', 'text', 'size', 'added']);
    expect(compareProofPages([page('a')], [])).toEqual(['removed']);
    expect(uniqueProofMatches([page('a'), page('a'), page('b')]).get('a')).toBeNull();
  });

  it('imports notes once, keeps unplaced notes off canvas and follows stable page IDs', () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Proof', false);
    const state = manager.getState(), spread = state.spreads[0], pageId = spread.pages[0].id;
    const note: CommentPin = { id: 'review-1', pageId, proofPage: 1, spreadIndex: 0, x: 11, y: 22,
      text: 'Check the caption', author: 'Editor', timestamp: 1, resolved: false };
    expect(manager.importProofNotes([note, { ...note, id: 'review-2', unplaced: true }], manager.getDocumentRevision())).toBe(2);
    expect(manager.importProofNotes([note], manager.getDocumentRevision())).toBe(0);
    const copy = structuredClone(manager.getState());
    copy.spreads.unshift({ id: 'blank', spreadIndex: 0, pages: [{ id: 'blank-page', pageNumber: 1, side: 'single' }], elements: [] });
    expect(reviewPinPosition(copy, note)).toEqual({ spreadIndex: 1, x: 11, y: 22 });
    expect(reviewPinPosition(copy, copy.comments![1])).toBeUndefined();
    manager.undo(); expect(manager.getState().comments || []).toHaveLength(0);
  });

  it('checks printer thresholds at export and identifies the relevant pages', () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Printer', false);
    const pageId = manager.getActiveSpread().pages[0].id;
    manager.addElement(image(pageId, 'photo', 15));
    const shape: ShapeElement = { id: 'ink', pageId, type: 'shape', shapeKind: 'rectangle', x: 20, y: 110,
      width: 30, height: 10, opacity: 1, rotation: 0, locked: false, zIndex: 1, fillColor: 'cmyk(95,95,95,95)', strokeColor: 'transparent', strokeWidthMm: 0, strokeDash: 'solid' };
    manager.addElement(shape);
    const profile = parsePrinterProfile({ name: 'Press', bleedMm: 3, minDpi: 300, maxInk: 320 });
    const issues = checkPrinterProfile(profile, manager.getState(), false);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', message: expect.stringContaining('0 mm') }),
      expect.objectContaining({ page: 1, spread: 0, message: expect.stringContaining('102 dpi') }), expect.objectContaining({ page: 1, message: expect.stringContaining('380%') })]));
    expect(() => parsePrinterProfile({ ...profile, maxInk: 900 })).toThrow();
  });

  it('updates caption references after insertion and renumbers assembled chapters', () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Chapter one', false);
    const pageId = manager.getActiveSpread().pages[0].id;
    manager.addElement(image(pageId, 'late', 130));
    const late = manager.saveObjectCaption('late', 'The later figure');
    const list = manager.createPublicationList('figures');
    manager.addElement({ ...list, id: 'body', generated: undefined, autoExtendStory: false, nextFrameId: undefined, prevFrameId: undefined,
      text: 'See ', storyContent: { version: 1, paragraphs: [{ runs: [{ text: 'See ' }] }] }, y: 100, height: 20 });
    manager.insertStoryReference('body', 4, 4, late.id, undefined, 'caption');
    manager.addElement(image(pageId, 'early', 12));
    manager.saveObjectCaption('early', 'The earlier figure');
    const chapter = publicationSnapshot(manager.getState());
    expect(publicationCaptions(chapter).map(caption => caption.label)).toEqual(['Figure 1.1', 'Figure 1.2']);
    expect(chapter.spreads.flatMap(spread => spread.elements).find(element => element.id === 'body')).toMatchObject({ text: 'See Figure 1.2' });
    const book = bookEngine.createBook('Collected chapters', [{ title: 'One', filePath: 'one', forceRectoOpening: false }, { title: 'Two', filePath: 'two', forceRectoOpening: false }]);
    const combined = publicationSnapshot(assembleBook(book, () => chapter));
    expect(publicationCaptions(combined).map(caption => caption.label)).toEqual(['Figure 1.1', 'Figure 1.2', 'Figure 2.1', 'Figure 2.2']);
    expect((combined.spreads.flatMap(spread => spread.elements).find(element => element.id === 'book-1-body') as TextElement).text).toBe('See Figure 2.2');
  });
});
