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
  });
});
