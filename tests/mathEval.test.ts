import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateMathExpression } from '../src/utils/mathEval';
import { stateManager } from '../src/state/stateManager';

describe('Math Evaluator & InDesign Muscle-Memory Features', () => {
  describe('evaluateMathExpression', () => {
    it('evaluates basic numeric values', () => {
      expect(evaluateMathExpression('42')).toBe(42);
      expect(evaluateMathExpression('12.5')).toBe(12.5);
      expect(evaluateMathExpression('0')).toBe(0);
    });

    it('evaluates arithmetic expressions with proper operator precedence', () => {
      expect(evaluateMathExpression('180 / 2')).toBe(90);
      expect(evaluateMathExpression('210 - 25')).toBe(185);
      expect(evaluateMathExpression('10 + 5 * 2')).toBe(20);
      expect(evaluateMathExpression('(10 + 5) * 2')).toBe(30);
      expect(evaluateMathExpression('100 / (2 + 3)')).toBe(20);
    });

    it('evaluates relative offset expressions using base value', () => {
      expect(evaluateMathExpression('+10', 50)).toBe(60);
      expect(evaluateMathExpression('-15', 50)).toBe(35);
      expect(evaluateMathExpression('*2', 50)).toBe(100);
      expect(evaluateMathExpression('/2', 50)).toBe(25);
    });

    it('evaluates unit conversions into millimeters', () => {
      expect(evaluateMathExpression('10mm')).toBe(10);
      expect(evaluateMathExpression('2cm')).toBe(20);
      expect(evaluateMathExpression('1in')).toBe(25.4);
      expect(evaluateMathExpression('72pt')).toBeCloseTo(25.4, 1);
    });

    it('returns null on invalid input or division by zero safely', () => {
      expect(evaluateMathExpression('invalid_text')).toBeNull();
      expect(evaluateMathExpression('10 / 0')).toBeNull();
      expect(evaluateMathExpression('')).toBeNull();
    });
  });

  describe('Sequential Page Renumbering & Muscle Memory in StateManager', () => {
    beforeEach(() => {
      stateManager.resetToDefault();
    });

    it('automatically renumbers pages sequentially when spreads are manipulated', () => {
      // Initially, 2 spreads: Cover (p.1) and Spread 2 (p.2 - p.3)
      let state = stateManager.getState();
      expect(state.spreads[0].pages[0].pageNumber).toBe(1);
      expect(state.spreads[1].pages[0].pageNumber).toBe(2);
      expect(state.spreads[1].pages[1].pageNumber).toBe(3);

      // Add 2 more spreads
      stateManager.addSpread();
      stateManager.addSpread();
      state = stateManager.getState();
      expect(state.spreads.length).toBe(4);
      expect(state.spreads[2].pages[0].pageNumber).toBe(4);
      expect(state.spreads[3].pages[1].pageNumber).toBe(7);

      // Delete spread 0 (Cover, p.1)
      stateManager.deleteSpread(0);
      state = stateManager.getState();

      // Pages must automatically renumber from 1 upwards without gaps or stale page numbers!
      expect(state.spreads[0].pages[0].pageNumber).toBe(1);
      expect(state.spreads[0].pages[1].pageNumber).toBe(2);
      expect(state.spreads[1].pages[0].pageNumber).toBe(3);
      expect(state.spreads[1].pages[1].pageNumber).toBe(4);
    });

    it('toggles previewMode state with togglePreviewMode', () => {
      const initial = Boolean(stateManager.getState().previewMode);
      stateManager.togglePreviewMode();
      expect(stateManager.getState().previewMode).toBe(!initial);
      stateManager.togglePreviewMode();
      expect(stateManager.getState().previewMode).toBe(initial);
    });

    it('nudges selected elements by millimeter offsets', () => {
      const spread = stateManager.getActiveSpread();
      const el = spread.elements[0];
      const startX = el.x;
      const startY = el.y;

      stateManager.selectElements([el.id]);
      stateManager.nudgeSelectedElements(1, -1);

      const updated = stateManager.getActiveSpread().elements.find(e => e.id === el.id)!;
      expect(updated.x).toBeCloseTo(startX + 1, 2);
      expect(updated.y).toBeCloseTo(startY - 1, 2);
    });

    it('supports GREP style rules additions, updates, and removal', () => {
      const styles = stateManager.getState().paragraphStyles;
      expect(styles.length).toBeGreaterThan(0);
      const styleId = styles[0].id;

      stateManager.addGrepStyleRule(styleId, {
        pattern: '\\b\\d{4}\\b',
        bold: true,
        color: '#ff0000',
      });

      let updatedStyle = stateManager.getState().paragraphStyles.find(s => s.id === styleId)!;
      expect(updatedStyle.grepStyles).toBeDefined();
      expect(updatedStyle.grepStyles!.length).toBe(1);
      const rule = updatedStyle.grepStyles![0];
      expect(rule.pattern).toBe('\\b\\d{4}\\b');
      expect(rule.bold).toBe(true);
      expect(rule.color).toBe('#ff0000');

      // Update rule
      stateManager.updateGrepStyleRule(styleId, rule.id, { italic: true });
      updatedStyle = stateManager.getState().paragraphStyles.find(s => s.id === styleId)!;
      expect(updatedStyle.grepStyles![0].italic).toBe(true);

      // Remove rule
      stateManager.removeGrepStyleRule(styleId, rule.id);
      updatedStyle = stateManager.getState().paragraphStyles.find(s => s.id === styleId)!;
      expect(updatedStyle.grepStyles!.length).toBe(0);
    });
  });
});
