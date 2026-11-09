import { describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { exportDocumentToIdml } from '../src/export/idmlExport';
import { parseIdmlPackage } from '../src/idmlImport';
import { publicationSnapshot } from '../src/engine/publicationReferences';
import { storyText } from '../src/engine/storyContent';
import type { ShapeElement, TextElement } from '../src/types';
import { readZip } from '../src/zip';

const frame = (id: string, pageId: string, text = ''): TextElement => ({ id, pageId, type: 'text', text, x: 20, y: 20, width: 130, height: 35,
  rotation: 0, opacity: 1, locked: false, zIndex: 1, fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.3, letterSpacingPt: 0,
  color: '#263b77', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 });

describe('publication editions and IDML handoff', () => {
  it('filters conditional paragraphs and artwork on an export snapshot, keeping source copy', () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Editions', false);
    const hidden = manager.addCondition('Teacher copy'); manager.toggleCondition(hidden.id);
    const page = manager.getActiveSpread().pages[0].id;
    manager.addElement(frame('story', page));
    manager.addElement({ ...frame('private', page, 'Hidden object'), conditionId: hidden.id });
    manager.setStoryContent('story', { version: 1, paragraphs: [{ runs: [{ text: 'Public copy' }] }, { conditionId: hidden.id, runs: [{ text: 'Hidden paragraph', italic: true }] }] });
    const state = manager.getState(), result = publicationSnapshot(state);
    expect(result.spreads[0].elements.map(element => element.id)).toEqual(['story']);
    expect((result.spreads[0].elements[0] as TextElement).text).toBe('Public copy');
    expect(storyText(manager.getStoryContent('story'))).toContain('Hidden paragraph');
    expect(state.spreads[0].elements).toHaveLength(2);
  });

  it('round trips rich copy, cross-spread threading, parent inheritance and process artwork', async () => {
    const manager = new StateManager(); manager.createBlankProject('A4', 'Round trip', false);
    const state = manager.getState();
    const page = state.spreads[0].pages[0];
    const style = { ...state.paragraphStyles[0], id: 'round-trip-style', name: 'Body & editorial', color: '#263b77' };
    state.paragraphStyles.push(style);
    const head = { ...frame('head', page.id), nextFrameId: 'tail', storyContent: { version: 1 as const, paragraphs: [
      { styleId: style.id, runs: [{ text: 'Lead & copy ', bold: true }, { text: 'italic', italic: true }] }, { runs: [{ text: 'Second paragraph' }] },
    ] } };
    state.spreads[0].elements = [head];
    state.spreads.push({ id: 'second', spreadIndex: 1, pages: [{ ...page, id: 'next-page', pageNumber: 2 }], elements: [{ ...frame('tail', 'next-page'), prevFrameId: 'head' }] });
    const parentPage = { ...page, id: 'parent-page' }, childPage = { ...page, id: 'child-page' };
    const art: ShapeElement = { id: 'art', type: 'shape', pageId: parentPage.id, shapeKind: 'rectangle', x: 15, y: 15, width: 20, height: 20,
      rotation: 0, opacity: 1, locked: false, zIndex: 1, fillColor: '#263b77', strokeColor: 'transparent', strokeWidthMm: 0, strokeDash: 'solid' };
    state.masterSpreads = [{ id: 'base', name: 'Base', prefix: 'A', pages: [parentPage], elements: [art] },
      { id: 'child', parentMasterId: 'base', name: 'Editorial', prefix: 'B', pages: [childPage], elements: [] }];
    state.spreads[0].masterSpreadId = 'child';
    const bytes = exportDocumentToIdml(state);
    expect([... (await readZip(bytes)).keys()].filter(name => name.startsWith('Stories/'))).toHaveLength(1);
    const imported = await parseIdmlPackage(bytes);
    const [first, second] = imported.spreads.map(spread => spread.elements[0] as TextElement);
    expect(first.nextFrameId).toBe(second.id); expect(second.prevFrameId).toBe(first.id);
    expect(storyText(first.storyContent!)).toBe('Lead & copy italic\nSecond paragraph');
    expect(first.storyContent?.paragraphs[0].runs[1].italic).toBe(true);
    expect(imported.paragraphStyles.find(item => item.id === first.storyContent?.paragraphs[0].styleId)?.name).toBe(style.name);
    const child = imported.masterSpreads.find(master => master.id === imported.spreads[0].masterSpreadId)!;
    expect(child.name).toBe('Editorial');
    expect(imported.masterSpreads.find(master => master.id === child.parentMasterId)?.elements[0]).toMatchObject({ fillColor: art.fillColor, strokeWidthMm: 0 });
  }, 60000);
});
