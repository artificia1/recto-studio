import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { StateManager } from '../src/state/stateManager';
import { instantiateMasterItem, resolveMaster } from '../src/engine/masterInheritance';
import { prepareExportAssets } from '../src/export/publicationAssets';
import { spreadGrid, visibleSpreadCells, workspaceDrop } from '../src/engine/spatialWorkspace';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { generateEpubPackage } from '../src/epubExport';
import { fontManager } from '../src/fontManager';
import { documentFontUsage } from '../src/engine/documentFonts';
import { parseProject } from '../src/state/projectValidation';
import { bezierNodesToSvgPath } from '../src/engine/vectorPath';
import type { ShapeElement, TextElement } from '../src/types';

describe('spatial, master and arrangement systems', () => {
  let manager: StateManager;
  const shape = (id: string, x: number): ShapeElement => ({ id, type: 'shape', pageId: manager.getActiveSpread().pages[0].id,
    x, y: 20, width: 10, height: 10, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    shapeKind: 'rectangle', fillColor: '#ff8800', strokeColor: '#111', strokeWidthMm: 0.2, strokeDash: 'solid' });
  beforeEach(() => { manager = new StateManager(); manager.createBlankProject('A4', 'Workspace systems', false); manager.getState(); });
  it('distributes exact gaps, preserves group geometry and undoes changes', () => {
    for (const [id, x] of [['a', 10], ['b', 45], ['c', 80]] as const) manager.addElement(shape(id, x));
    manager.selectElements(['a', 'b', 'c']); manager.distributeElements('horizontal', 4.5);
    expect(manager.getElementById('b')!.x).toBeCloseTo(24.5); expect(manager.getElementById('c')!.x).toBeCloseTo(39);
    manager.undo(); expect(manager.getElementById('b')!.x).toBe(45);
    manager.selectElements(['a', 'b']); manager.groupSelection(); manager.selectElement('a');
    expect(manager.getState().selectedElementIds).toEqual(['a', 'b']);
    manager.selectElements(['a', 'c']); manager.alignElements('top');
    expect(manager.getElementById('b')!.x - manager.getElementById('a')!.x).toBe(35);
    manager.selectElement('a'); manager.ungroupSelection(); expect(manager.getElementById('b')!.groupId).toBeUndefined();
  });
  it('honours layer locks atomically and rejects invalid spacing', () => {
    manager.addElement(shape('a', 10)); manager.addElement(shape('b', 40)); manager.selectElements(['a', 'b']);
    expect(() => manager.distributeElements('horizontal', NaN)).toThrow('Spacing');
    manager.getState().layers[0].locked = true; const before = manager.exportJson();
    expect(() => manager.alignElements('left')).toThrow('Unlock'); expect(manager.exportJson()).toBe(before);
  });
  it('protects locked group members during nudging and deletion', () => {
    manager.addElement(shape('a', 10)); manager.addElement(shape('b', 40)); manager.selectElements(['a', 'b']); manager.groupSelection();
    manager.getElementById('b')!.locked = true;
    manager.nudgeSelectedElements(5, 3); manager.deleteSelectedElements();
    expect(manager.getElementById('a')!.x).toBe(10); expect(manager.getElementById('b')!.x).toBe(40);
  });
  it('inherits parent objects by page side, propagates edits and rejects cycles/deletion', () => {
    const a = manager.createMasterSpread('A', 'A'), b = manager.createMasterSpread('B', 'B'), c = manager.createMasterSpread('C', 'C');
    manager.setMasterParent(b.id, a.id); manager.setMasterParent(c.id, b.id);
    expect(resolveMaster(manager.getState().masterSpreads, c.id)!.elements).toHaveLength(a.elements.length + b.elements.length + c.elements.length);
    const first = a.elements[0]; first.y = 12;
    expect(resolveMaster(manager.getState().masterSpreads, c.id)!.elements.find(element => element.id === first.id)!.y).toBe(12);
    const before = manager.exportJson(); expect(() => manager.setMasterParent(a.id, c.id)).toThrow('cycle'); expect(manager.exportJson()).toBe(before);
    expect(() => manager.deleteMasterSpread(a.id)).toThrow('Reparent');
    expect(() => parseProject(manager.exportJson(), manager.getState())).not.toThrow();
    const broken = JSON.parse(manager.exportJson()); broken.spreads[0].masterSpreadId = 'missing';
    expect(parseProject(JSON.stringify(broken), manager.getState()).spreads[0].masterSpreadId).toBeNull();
    expect(() => manager.assignMasterSpread(0, 'missing')).toThrow('master is missing');
  });
  it('moves grouped independent artwork across pages and excludes persistent pasteboard text from exports', async () => {
    manager.addElement(shape('a', 10)); manager.addElement(shape('b', 30)); manager.selectElements(['a', 'b']); manager.groupSelection();
    const original = manager.exportJson(); manager.addSpread();
    const target = manager.getActiveSpread().pages[1].id;
    manager.moveArtwork(['a'], target, 22, 32);
    expect(manager.getElementById('a')!.pageId).toBe(target); expect(manager.getElementById('b')!.x).toBe(42);
    manager.undo(); expect(manager.getState().spreads[0].elements).toHaveLength(2);
    const source = JSON.parse(original); expect(source.spreads[0].elements[0].x).toBe(10);
    const text: TextElement = { ...shape('private', 20), type: 'text', text: 'SCRATCHPAD_PRIVATE', fontFamily: 'Times', fontSizePt: 11,
      lineHeight: 1.3, letterSpacingPt: 0, alignment: 'left', columns: 1, columnGutterMm: 0, paddingMm: 0, color: '#111', backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
    manager.addElement(text); manager.moveArtwork(['private'], text.pageId, -30, 10, true);
    const pdf = await exportDocumentToPdf(manager.getState(), { download: false, compress: false });
    expect(pdf.output()).not.toContain('SCRATCHPAD_PRIVATE');
    expect(Object.values(generateEpubPackage(manager.getState())).filter(value => typeof value === 'string').join('')).not.toContain('SCRATCHPAD_PRIVATE');
    expect(parseProject(manager.exportJson(), manager.getState()).spreads.flatMap(spread => spread.elements).find(element => element.id === 'private')!.pasteboard).toBe(true);
  });
  it('preserves PDF blend operators and uses a transparency-capable PDF version', async () => {
    manager.addElement({ ...shape('blend', 20), blendMode: 'multiply', opacity: 0 });
    const pdf = await exportDocumentToPdf(manager.getState(), { download: false, compress: false });
    expect(pdf.output()).toContain('%PDF-1.7'); expect(pdf.output()).toContain('/BM /Multiply'); expect(pdf.output()).toContain('/GSBlendMultiply gs');
    expect(pdf.output()).toContain('/CA 0'); expect(pdf.output()).toContain('/ca 0');
  });
  it('copies independent artwork into an empty child and propagates owned geometry edits', () => {
    const parent = manager.createMasterSpread('Parent', 'A'), child = manager.createMasterSpread('Child', 'B', parent.id);
    expect(child.elements).toHaveLength(0);
    manager.addElement(shape('decoration', 25)); manager.selectElement('decoration'); manager.copySelectionToMaster(parent.id);
    const copied = parent.elements.at(-1)!;
    expect(copied.id).not.toBe('decoration');
    manager.updateMasterItem(parent.id, copied.id, { y: 42 });
    expect(resolveMaster(manager.getState().masterSpreads, child.id)!.elements.find(element => element.id === copied.id)!.y).toBe(42);
    expect(manager.getElementById('decoration')!.y).toBe(20);
    manager.assignMasterSpread(0, child.id);
    const override = manager.overrideMasterElement(manager.getActiveSpread().id, copied.id)!;
    expect(override.masterSourceId).toBe(copied.id);
    expect(manager.isMasterElementOverridden(manager.getActiveSpread().id, copied.id)).toBe(true);
    manager.restoreMasterElement(manager.getActiveSpread().id, copied.id);
    expect(manager.getElementById(override.id)).toBeNull();
  });
  it('resolves rich master tokens on a copy and prepares ancestor image assets', async () => {
    const parent = manager.createMasterSpread('Parent', 'A'), child = manager.createMasterSpread('Child', 'B', parent.id);
    const text = parent.elements.find(element => element.type === 'text') as TextElement;
    text.storyContent = { version: 1, paragraphs: [{ runs: [{ text: '{{page}}', bold: true }] }] };
    const instance = instantiateMasterItem(text, 'target', value => value.replace('{{page}}', '48')) as TextElement;
    expect(instance.textContent!.paragraphs[0].runs[0]).toMatchObject({ text: '48', bold: true });
    expect(text.storyContent.paragraphs[0].runs[0].text).toBe('{{page}}');
    parent.elements.push({ ...shape('logo', 20), type: 'image', pageId: parent.pages[0].id, fitMode: 'fit',
      src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>') });
    manager.assignMasterSpread(0, child.id);
    const prepared = await prepareExportAssets(manager.getState());
    const logo = prepared.masterSpreads.find(master => master.id === parent.id)!.elements.find(element => element.id === 'logo');
    expect(logo?.type === 'image' && logo.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
  it('keeps copied groups independent and assigns aligned objects to the correct facing page', () => {
    manager.addSpread(); const spread = manager.getActiveSpread();
    manager.addElement(shape('a', 15)); manager.addElement({ ...shape('b', 20), pageId: spread.pages[1].id });
    manager.selectElements(['a', 'b']); manager.alignElements('left');
    expect(manager.getElementById('b')!.pageId).toBe(spread.pages[0].id);
    expect(manager.getElementById('b')!.x).toBe(15);
    manager.groupSelection(); const groupId = manager.getElementById('a')!.groupId;
    const duplicate = manager.duplicateElement('a')!;
    expect(manager.getElementById(duplicate)!.groupId).toBeUndefined();
    manager.duplicateSpread(manager.getState().activeSpreadIndex);
    const copies = manager.getActiveSpread().elements.filter(element => element.groupId);
    expect(copies).toHaveLength(2); expect(copies[0].groupId).not.toBe(groupId); expect(copies[0].groupId).toBe(copies[1].groupId);
  });
  it('identifies missing references and replaces style/run fonts in one undo step', async () => {
    const family = await fontManager.registerFontBuffer('OpenSans-Regular.ttf', readFileSync('tests/fixtures/fonts/OpenSans-Regular.ttf'));
    const text: TextElement = { ...shape('body', 10), type: 'text', text: 'Original manuscript', fontFamily: 'Unavailable Corporate Font', fontSizePt: 11, lineHeight: 1.3,
      letterSpacingPt: 0, alignment: 'left', columns: 1, columnGutterMm: 0, paddingMm: 0, color: '#111', backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
    manager.addElement(text); expect(documentFontUsage(manager.getState()).some(item => item.family === text.fontFamily)).toBe(true);
    const unrelated = { ...text, id: 'unrelated', fontFamily: 'Times', locked: true };
    manager.addElement(unrelated);
    manager.replaceDocumentFont(text.fontFamily, family); expect((manager.getElementById('body') as TextElement).fontFamily).toBe(family);
    manager.undo(); expect((manager.getElementById('body') as TextElement).fontFamily).toBe('Unavailable Corporate Font');
    manager.getElementById('body')!.locked = true;
    expect(() => manager.replaceDocumentFont('Unavailable Corporate Font', family)).toThrow('Unlock affected');
  });
  it('restores output when scratch artwork is positioned back onto a page', () => {
    manager.addElement(shape('draft', 20)); const page = manager.getActiveSpread().pages[0].id;
    manager.moveArtwork(['draft'], page, -25, 20, true);
    manager.updateElements([{ id: 'draft', partial: { x: 25, y: 30 } }]);
    expect(manager.getElementById('draft')!.pasteboard).toBeUndefined();
    manager.undo(); expect(manager.getElementById('draft')!.pasteboard).toBe(true);
  });
  it('rejects moving a text parent away from attached objects without mutating the project', () => {
    manager.addElement(shape('anchored', 20));
    manager.getElementById('anchored')!.anchor = { parentTextId: 'parent' };
    manager.addElement(shape('parent', 40));
    const before = manager.exportJson();
    expect(() => manager.moveArtwork(['parent'], manager.getActiveSpread().pages[0].id, 50, 50)).toThrow('Unanchor');
    expect(manager.exportJson()).toBe(before);
  });
  it('maps grid drop coordinates without assuming single-page spreads', () => {
    manager.addSpread(); const state = manager.getState(), grid = spreadGrid(state, 4), cell = grid.cells[1];
    expect(workspaceDrop(state, 4, cell.x + state.settings.widthMm + 12, cell.y + 20)).toMatchObject({ pageId: cell.spread.pages[1].id, x: 12, y: 20, pasteboard: false });
    expect(workspaceDrop(state, 4, cell.x - 10, cell.y + 20)?.pasteboard).toBe(true);
  });
  it('culls spread rows near the end of a long document without dropping visible columns', () => {
    const state = manager.getState();
    const spread = state.spreads[0];
    const grid = spreadGrid({ ...state, spreads: Array.from({ length: 201 }, () => spread) }, 4);
    const target = grid.cells[196];
    const viewport = { x: -10, y: target.y - 1, width: target.width + 70, height: grid.rowHeight + 2 };

    expect(visibleSpreadCells(grid, viewport).map(cell => cell.index)).toEqual([196, 200]);
    expect(visibleSpreadCells(grid, { ...viewport, y: grid.height + 50 })).toEqual([]);
    expect(visibleSpreadCells(grid, { ...viewport, y: -viewport.height - 1 })).toEqual([]);
  });
  it('assigns each member of a transferred group to its physical facing page', () => {
    manager.addElement(shape('a', 10)); manager.addElement(shape('b', 30)); manager.selectElements(['a', 'b']); manager.groupSelection();
    manager.addSpread(); const target = manager.getActiveSpread();
    manager.moveArtwork(['a'], target.pages[0].id, 200, 20);
    expect(manager.getElementById('a')!.pageId).toBe(target.pages[0].id);
    expect(manager.getElementById('b')!.pageId).toBe(target.pages[1].id);
    expect(manager.getElementById('b')!.x).toBe(10);
  });
  it('preserves relative curve handles and the curved closing edge in workspace and export paths', () => {
    const path = bezierNodesToSvgPath([{ x: 10, y: 20, handleIn: { x: -2, y: 0 }, handleOut: { x: 5, y: 0 } },
      { x: 30, y: 40, handleIn: { x: -3, y: 0 } }, { x: 50, y: 10, handleOut: { x: 0, y: 4 } }], true);
    expect(path).toContain('C 15.00 20.00, 27.00 40.00, 30.00 40.00');
    expect(path).toContain('C 50.00 14.00, 8.00 20.00, 10.00 20.00 Z');
  });
});
