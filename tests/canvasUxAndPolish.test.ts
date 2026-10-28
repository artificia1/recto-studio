/**
 * Recto Studio — Canvas UX & Layout Polish Verification Tests
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stateManager, FindChangeQuery } from '../src/state/stateManager';
import { TextElement } from '../src/types';

describe('Canvas UX & Layout Polish', () => {
  beforeEach(() => {
    stateManager.resetToDefault();
  });

  describe('Global Find / Change with GREP Engine', () => {
    it('finds and replaces plain text across text frames', () => {
      const activeSpread = stateManager.getActiveSpread();
      const pageId = activeSpread.pages[0].id;

      const t1: TextElement = {
        id: 'tf-find-1',
        type: 'text',
        pageId,
        x: 10,
        y: 10,
        width: 80,
        height: 40,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        text: 'The quick brown fox jumps over the lazy dog.',
        fontFamily: 'Inter',
        fontSizePt: 11,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000',
        alignment: 'left',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      };

      stateManager.addElement(t1);

      const query: FindChangeQuery = {
        findText: 'brown fox',
        changeText: 'silver wolf',
        isGrep: false,
        caseSensitive: true,
        scope: 'document',
      };

      const match = stateManager.findNext(query);
      expect(match).not.toBeNull();
      expect(match?.matchText).toBe('brown fox');
      expect(match?.elementId).toBe('tf-find-1');

      const changed = stateManager.change(query, match!);
      expect(changed).toBe(true);

      const updated = stateManager.getElementById('tf-find-1') as TextElement;
      expect(updated.text).toBe('The quick silver wolf jumps over the lazy dog.');
    });

    it('supports GREP pattern matching and regex backreference replacements ($1)', () => {
      const activeSpread = stateManager.getActiveSpread();
      const pageId = activeSpread.pages[0].id;

      const t2: TextElement = {
        id: 'tf-grep-1',
        type: 'text',
        pageId,
        x: 10,
        y: 10,
        width: 80,
        height: 40,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        text: 'Order #4820 and Order #9914 are shipped.',
        fontFamily: 'Inter',
        fontSizePt: 11,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000',
        alignment: 'left',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      };

      stateManager.addElement(t2);

      const grepQuery: FindChangeQuery = {
        findText: '#(\\d+)',
        changeText: 'ID-$1',
        isGrep: true,
        caseSensitive: false,
        scope: 'spread',
      };

      const result = stateManager.changeAll(grepQuery);
      expect(result.replacementsCount).toBe(2);
      expect(result.elementsAffected).toBe(1);

      const updated = stateManager.getElementById('tf-grep-1') as TextElement;
      expect(updated.text).toBe('Order ID-4820 and Order ID-9914 are shipped.');
    });

    it('respects search scope constraints between spread and document', () => {
      // Add a second spread
      stateManager.addSpread();
      const spread1 = stateManager.getState().spreads[0];
      const spread2 = stateManager.getState().spreads[1];

      const tSpread1: TextElement = {
        id: 'tf-scope-1',
        type: 'text',
        pageId: spread1.pages[0].id,
        x: 10,
        y: 10,
        width: 50,
        height: 30,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        text: 'Apple in Spread 1',
        fontFamily: 'Inter',
        fontSizePt: 10,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000',
        alignment: 'left',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      };

      const tSpread2: TextElement = {
        id: 'tf-scope-2',
        type: 'text',
        pageId: spread2.pages[0].id,
        x: 10,
        y: 10,
        width: 50,
        height: 30,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        text: 'Apple in Spread 2',
        fontFamily: 'Inter',
        fontSizePt: 10,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000',
        alignment: 'left',
        columns: 1,
        columnGutterMm: 4,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 0,
      };

      spread1.elements.push(tSpread1);
      spread2.elements.push(tSpread2);

      // Search only active spread (which is spread 1)
      stateManager.setActiveSpread(1);
      const querySpreadOnly: FindChangeQuery = {
        findText: 'Apple',
        changeText: 'Orange',
        isGrep: false,
        scope: 'spread',
      };

      const matchesSpread = stateManager.collectFindMatches(querySpreadOnly);
      expect(matchesSpread.length).toBe(1);
      expect(matchesSpread[0].elementId).toBe('tf-scope-2');

      // Search entire document
      const queryDoc: FindChangeQuery = {
        findText: 'Apple',
        changeText: 'Orange',
        isGrep: false,
        scope: 'document',
      };
      const matchesDoc = stateManager.collectFindMatches(queryDoc);
      expect(matchesDoc.length).toBe(2);
    });
  });

  describe('Canvas State & Layout Polish Operations', () => {
    it('duplicates spreads with fresh element IDs and maintains pagination', () => {
      const initialCount = stateManager.getState().spreads.length;
      stateManager.duplicateSpread(0);
      expect(stateManager.getState().spreads.length).toBe(initialCount + 1);
    });

    it('toggles PostScript Overprint Black and Facing Pages', () => {
      const origOverprint = stateManager.getState().settings.overprintBlack !== false;
      stateManager.toggleOverprintBlack();
      expect(stateManager.getState().settings.overprintBlack).toBe(!origOverprint);

      const origFacing = Boolean(stateManager.getState().settings.facingPages);
      stateManager.toggleFacingPages();
      expect(Boolean(stateManager.getState().settings.facingPages)).toBe(!origFacing);
    });

    it('creates a pristine blank document with zero elements and custom presets', () => {
      // 1. Create blank A4 project
      stateManager.createBlankProject('A4', 'Blank Portfolio Book', true);
      const state = stateManager.getState();
      expect(state.settings.title).toBe('Blank Portfolio Book');
      expect(state.settings.preset).toBe('A4');
      expect(state.spreads.length).toBe(1);
      expect(state.spreads[0].elements.length).toBe(0);
      expect(state.selectedElementId).toBeNull();
      expect(state.selectedElementIds.length).toBe(0);

      // 2. Create blank 6x9 Novel project
      stateManager.createBlankProject('Book-Trade-6x9', 'My Debut Novel', true);
      const novelState = stateManager.getState();
      expect(novelState.settings.preset).toBe('Book-Trade-6x9');
      expect(novelState.settings.widthMm).toBeCloseTo(152.4, 1);
      expect(novelState.settings.heightMm).toBeCloseTo(228.6, 1);
      expect(novelState.spreads[0].elements.length).toBe(0);
      expect(novelState.spreads[0].pages[0].pageNumber).toBe(1);
    });
  });

  describe('Mobile, Tablet & Stylus Architecture', () => {
    it('supports selecting the pencil tool', () => {
      stateManager.setTool('pencil');
      expect(stateManager.getState().activeTool).toBe('pencil');
    });

    it('performs atomic zoom and pan updates with a single notification broadcast', () => {
      let notifyCount = 0;
      const unsubscribe = stateManager.subscribe(() => {
        notifyCount++;
      });

      stateManager.setZoomAndPan(1.4, 250, -120);

      const state = stateManager.getState();
      expect(state.zoom).toBe(1.4);
      expect(state.panX).toBe(250);
      expect(state.panY).toBe(-120);
      // Ensures no double-render cascade during pinch-to-zoom
      expect(notifyCount).toBe(1);

      unsubscribe();
    });

    it('duplicates elements with offset via duplicateElement', () => {
      const activeSpread = stateManager.getActiveSpread();
      const pageId = activeSpread.pages[0].id;
      const origCount = activeSpread.elements.length;

      const t1: TextElement = {
        id: 'dup-test-elem',
        type: 'text',
        pageId,
        x: 20,
        y: 30,
        width: 60,
        height: 40,
        rotation: 0,
        opacity: 1,
        zIndex: 5,
        locked: false,
        text: 'Duplicate Me',
        fontFamily: 'serif',
        fontSizePt: 12,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#111111',
        columns: 1,
        columnGutterMm: 4,
        alignment: 'left',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 2,
      };
      stateManager.addElement(t1);

      const dupId = stateManager.duplicateElement('dup-test-elem');
      expect(dupId).toBeTruthy();

      const updatedSpread = stateManager.getActiveSpread();
      expect(updatedSpread.elements.length).toBe(origCount + 2);

      const duplicated = updatedSpread.elements.find(e => e.id === dupId);
      expect(duplicated).toBeDefined();
      expect(duplicated?.x).toBe(28); // 20 + 8mm offset
      expect(duplicated?.y).toBe(38); // 30 + 8mm offset
      expect(stateManager.getState().selectedElementId).toBe(dupId);
    });
  });

  describe('Engine Hardening: TAC Heatmap, Typographic Linter, Thread Restitching & Spread Cloning', () => {
    it('toggles visual TAC ink density heatmap on canvas state', () => {
      expect(stateManager.getState().tacHeatmap).toBeFalsy();
      stateManager.toggleTacHeatmap();
      expect(stateManager.getState().tacHeatmap).toBe(true);
      stateManager.toggleTacHeatmap();
      expect(stateManager.getState().tacHeatmap).toBe(false);
    });

    it('detects straight quotes and double spaces via typographic linter and auto-fixes them', () => {
      const activeSpread = stateManager.getActiveSpread();
      const pageId = activeSpread.pages[0].id;

      const typoEl: TextElement = {
        id: 'typo-test-frame',
        type: 'text',
        pageId,
        x: 10,
        y: 10,
        width: 80,
        height: 40,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        text: 'He said "Hello world"  and it\'s ready.',
        fontFamily: 'serif',
        fontSizePt: 12,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000000',
        columns: 1,
        columnGutterMm: 4,
        alignment: 'left',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 2,
      };
      stateManager.addElement(typoEl);

      const issues = stateManager.runPreflightCheck();
      const quoteIssue = issues.find(i => i.code === 'TYPO_STRAIGHT_QUOTES' && i.elementId === 'typo-test-frame');
      const spaceIssue = issues.find(i => i.code === 'TYPO_DOUBLE_SPACES' && i.elementId === 'typo-test-frame');

      expect(quoteIssue).toBeDefined();
      expect(spaceIssue).toBeDefined();

      // Quick fix quotes
      const fixedQuotes = stateManager.autoFixPreflightIssue(quoteIssue!);
      expect(fixedQuotes).toBe(true);

      // Quick fix spaces
      const fixedSpaces = stateManager.autoFixPreflightIssue(spaceIssue!);
      expect(fixedSpaces).toBe(true);

      const updated = stateManager.getElementById('typo-test-frame') as TextElement;
      expect(updated.text).toContain('“Hello world”');
      expect(updated.text).toContain('it’s');
      expect(updated.text).not.toContain('  ');
    });

    it('re-stitches thread chain seamlessly when an intermediate frame is deleted', () => {
      const activeSpread = stateManager.getActiveSpread();
      const pageId = activeSpread.pages[0].id;

      const frameA: TextElement = {
        id: 'frame-stitch-a',
        type: 'text',
        pageId,
        x: 10,
        y: 10,
        width: 50,
        height: 30,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        text: 'Chapter One: In the beginning of the great expedition...',
        nextFrameId: 'frame-stitch-b',
        fontFamily: 'serif',
        fontSizePt: 10,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000000',
        columns: 1,
        columnGutterMm: 4,
        alignment: 'left',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 2,
      };

      const frameB: TextElement = {
        id: 'frame-stitch-b',
        type: 'text',
        pageId,
        x: 70,
        y: 10,
        width: 50,
        height: 30,
        rotation: 0,
        opacity: 1,
        zIndex: 2,
        locked: false,
        text: '',
        prevFrameId: 'frame-stitch-a',
        nextFrameId: 'frame-stitch-c',
        fontFamily: 'serif',
        fontSizePt: 10,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000000',
        columns: 1,
        columnGutterMm: 4,
        alignment: 'left',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 2,
      };

      const frameC: TextElement = {
        id: 'frame-stitch-c',
        type: 'text',
        pageId,
        x: 130,
        y: 10,
        width: 50,
        height: 30,
        rotation: 0,
        opacity: 1,
        zIndex: 3,
        locked: false,
        text: '',
        prevFrameId: 'frame-stitch-b',
        fontFamily: 'serif',
        fontSizePt: 10,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000000',
        columns: 1,
        columnGutterMm: 4,
        alignment: 'left',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 2,
      };

      stateManager.addElement(frameA);
      stateManager.addElement(frameB);
      stateManager.addElement(frameC);

      // Delete intermediate frame B
      stateManager.deleteElement('frame-stitch-b');

      const elA = stateManager.getElementById('frame-stitch-a') as TextElement;
      const elC = stateManager.getElementById('frame-stitch-c') as TextElement;

      // Frame A must now point directly to Frame C, and Frame C back to Frame A
      expect(elA.nextFrameId).toBe('frame-stitch-c');
      expect(elC.prevFrameId).toBe('frame-stitch-a');
    });

    it('remaps pageId and clears thread pointers during duplicateSpread', () => {
      const activeSpread = stateManager.getActiveSpread();
      const pageId = activeSpread.pages[0].id;

      const linkEl: TextElement = {
        id: 'dup-spread-text',
        type: 'text',
        pageId,
        x: 10,
        y: 10,
        width: 60,
        height: 40,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        text: 'Cross thread text',
        prevFrameId: 'some-other-frame',
        nextFrameId: 'some-next-frame',
        fontFamily: 'serif',
        fontSizePt: 10,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#000000',
        columns: 1,
        columnGutterMm: 4,
        alignment: 'left',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 2,
      };
      stateManager.addElement(linkEl);

      const activeIdx = stateManager.getState().activeSpreadIndex;
      const origSpreadCount = stateManager.getState().spreads.length;
      stateManager.duplicateSpread(activeIdx);

      const spreads = stateManager.getState().spreads;
      expect(spreads.length).toBe(origSpreadCount + 1);

      const duplicatedSpread = spreads[activeIdx + 1];
      const clonedEl = duplicatedSpread.elements.find(e => e.type === 'text' && (e as TextElement).text === 'Cross thread text') as TextElement;

      expect(clonedEl).toBeDefined();
      // pageId must be remapped to the duplicated spread's page
      expect(clonedEl.pageId).toBe(duplicatedSpread.pages[0].id);
      expect(clonedEl.pageId).not.toBe(pageId);
      // Thread IDs must be cleared to prevent cross-spread corruption
      expect(clonedEl.prevFrameId).toBeUndefined();
      expect(clonedEl.nextFrameId).toBeUndefined();
    });
  });
});
