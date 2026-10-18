import { describe, it, expect, beforeEach } from 'vitest';
import { stateManager } from '../src/state/stateManager';
import { PAGE_PRESETS, TextElement } from '../src/types/index';

describe('State Snapshot Stack & Mutation Engine', () => {
  beforeEach(() => {
    stateManager.resetToDefault();
  });

  it('initializes document state accurately with presets', () => {
    const initialState = stateManager.getState();
    expect(initialState.settings.preset).toBe('A4');
    expect(initialState.settings.widthMm).toBe(PAGE_PRESETS['A4'].widthMm);
    expect(initialState.settings.heightMm).toBe(PAGE_PRESETS['A4'].heightMm);

    // Switch to US Letter preset
    stateManager.updateSettings({
      preset: 'US-Letter',
      widthMm: PAGE_PRESETS['US-Letter'].widthMm,
      heightMm: PAGE_PRESETS['US-Letter'].heightMm,
    });

    const letterState = stateManager.getState();
    expect(letterState.settings.preset).toBe('US-Letter');
    expect(letterState.settings.widthMm).toBe(215.9);
    expect(letterState.settings.heightMm).toBe(279.4);
  });

  it('manages immutable undo/redo history rollback across mutations', () => {
    const initialTextCount = stateManager.getActiveSpread().elements.length;

    const sampleElem: TextElement = {
      id: 'test-undo-sample',
      type: 'text',
      pageId: stateManager.getActiveSpread().pages[0].id,
      x: 30,
      y: 40,
      width: 80,
      height: 30,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      text: 'Editorial Heading Text',
      fontFamily: 'Playfair Display, serif',
      fontSizePt: 24,
      lineHeight: 1.2,
      letterSpacingPt: 0,
      color: '#111111',
      alignment: 'left',
      columns: 1,
      columnGutterMm: 4,
      borderColor: 'transparent',
      borderWidthMm: 0,
      backgroundColor: 'transparent',
      paddingMm: 2,
    };

    // 1. Add element (pushes to undo stack)
    stateManager.addElement(sampleElem);
    expect(stateManager.getActiveSpread().elements.length).toBe(initialTextCount + 1);

    // 2. Undo rollback
    stateManager.undo();
    expect(stateManager.getActiveSpread().elements.length).toBe(initialTextCount);
    expect(stateManager.getElementById(sampleElem.id)).toBeNull();

    // 3. Redo forward
    stateManager.redo();
    expect(stateManager.getActiveSpread().elements.length).toBe(initialTextCount + 1);
    expect(stateManager.getElementById(sampleElem.id)).not.toBeNull();
  });

  it('handles element selection, reordering (front/back), and deletion', () => {
    const activeSpread = stateManager.getActiveSpread();
    const pageId = activeSpread.pages[0].id;

    const el1: TextElement = {
      id: 'test-stack-1',
      type: 'text',
      pageId,
      x: 10,
      y: 10,
      width: 40,
      height: 20,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      text: 'Bottom Layer',
      fontFamily: 'Inter',
      fontSizePt: 10,
      lineHeight: 1.2,
      letterSpacingPt: 0,
      color: '#000',
      alignment: 'left',
      columns: 1,
      columnGutterMm: 4,
      borderColor: 'transparent',
      borderWidthMm: 0,
      backgroundColor: 'transparent',
      paddingMm: 1,
    };

    const el2: TextElement = {
      id: 'test-stack-2',
      type: 'text',
      pageId,
      x: 20,
      y: 20,
      width: 40,
      height: 20,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
      locked: false,
      text: 'Top Layer',
      fontFamily: 'Inter',
      fontSizePt: 10,
      lineHeight: 1.2,
      letterSpacingPt: 0,
      color: '#000',
      alignment: 'left',
      columns: 1,
      columnGutterMm: 4,
      borderColor: 'transparent',
      borderWidthMm: 0,
      backgroundColor: 'transparent',
      paddingMm: 1,
    };

    stateManager.addElement(el1);
    stateManager.addElement(el2);

    // Selection
    stateManager.selectElements([el1.id, el2.id]);
    expect(stateManager.getState().selectedElementIds).toContain(el1.id);
    expect(stateManager.getState().selectedElementIds).toContain(el2.id);

    // Reorder el1 to front
    stateManager.changeElementOrder(el1.id, 'front');
    const updatedEl1 = stateManager.getElementById(el1.id)!;
    const updatedEl2 = stateManager.getElementById(el2.id)!;
    expect(updatedEl1.zIndex).toBeGreaterThan(updatedEl2.zIndex);

    // Delete elements
    stateManager.deleteElement(el1.id);
    expect(stateManager.getElementById(el1.id)).toBeNull();
    stateManager.deleteElement(el2.id);
    expect(stateManager.getElementById(el2.id)).toBeNull();
  });

  it('manages master spread lifecycle, assignment, and safe deletion', () => {
    const initialMasters = stateManager.getState().masterSpreads.length;
    expect(initialMasters).toBeGreaterThanOrEqual(1);

    // Create a secondary master spread
    const masterB = stateManager.createMasterSpread('Section Master', 'B');
    expect(stateManager.getState().masterSpreads.length).toBe(initialMasters + 1);

    // Assign master to active spread (index 1 is active by default)
    const activeIdx = stateManager.getState().activeSpreadIndex;
    stateManager.assignMasterSpread(activeIdx, masterB.id);
    expect(stateManager.getActiveSpread().masterSpreadId).toBe(masterB.id);

    // Deleting masterB should succeed, remove it from list, and clear references
    const success = stateManager.deleteMasterSpread(masterB.id);
    expect(success).toBe(true);
    expect(stateManager.getState().masterSpreads.find((m) => m.id === masterB.id)).toBeUndefined();
    expect(stateManager.getActiveSpread().masterSpreadId).toBeNull();

    // Guard: deleting when only 1 master remains should be prevented
    const remainingMasterId = stateManager.getState().masterSpreads[0].id;
    const guarded = stateManager.deleteMasterSpread(remainingMasterId);
    expect(guarded).toBe(false);
    expect(stateManager.getState().masterSpreads.length).toBe(1);
  });
});

