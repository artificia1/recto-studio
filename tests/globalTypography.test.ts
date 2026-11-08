import { describe, expect, it } from 'vitest';
import { cjkGroups, graphemes } from '../src/engine/globalTypography';
import { layoutStory } from '../src/engine/storyLayout';
import { StateManager } from '../src/state/stateManager';
import { printReadiness } from '../src/engine/printReadiness';
import { generateEpubPackage } from '../src/epubExport';
import { parseProject } from '../src/state/projectValidation';
import type { TextElement } from '../src/types';

const frame: TextElement = {
  id: 'cjk', pageId: 'page', type: 'text', x: 0, y: 0, width: 4, height: 100,
  text: '', rotation: 0, opacity: 1, zIndex: 1, locked: false,
  fontFamily: 'Times', fontSizePt: 10, lineHeight: 1, letterSpacingPt: 0,
  color: '#111', alignment: 'left', columns: 1, columnGutterMm: 0, paddingMm: 0,
  backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0,
};
const measure = (text: string) => graphemes(text).length;

describe('global horizontal composition', () => {
  it('keeps combining marks, emoji families, variation selectors and flags intact', () => {
    expect(graphemes('a\u0301👨‍👩‍👧‍👦🇯🇵✈️')).toHaveLength(4);
  });
  it('groups Japanese punctuation and Western words without rewriting the source', () => {
    const text = '日本語「東京」、2026年。';
    const groups = cjkGroups(text);
    expect(groups.join('')).toBe(text);
    expect(groups).toContain('「東'); expect(groups).toContain('京」、');
    expect(groups).toContain('2026');
    expect(cjkGroups('東 、京')).toContain('東 、');
    expect(cjkGroups('（ 東）')).toEqual(['（ 東）']);
  });
  it('respects punctuation across styled run boundaries and preserves source offsets', () => {
    const content = { version: 1 as const, paragraphs: [{ formatting: { cjkLineBreak: true }, runs: [{ text: '日本語東京' }, { text: '」、次。', bold: true }] }] };
    const result = layoutStory(content, frame, [], [], measure);
    expect(result.overset).toBe(false);
    expect(result.lines.map(line => line.segments.map(segment => segment.text).join('')).join('')).toBe('日本語東京」、次。');
    for (const line of result.lines) {
      const text = line.segments.map(segment => segment.text).join('');
      expect(text).not.toMatch(/^[」、。]/); expect(text).not.toMatch(/[「（]$/);
    }
    expect(result.consumed).toBe(9);
  });
  it('reports impossible groups as overset instead of clipping or splitting them', () => {
    const content = { version: 1 as const, paragraphs: [{ formatting: { cjkLineBreak: true }, runs: [{ text: '「東」' }] }] };
    const result = layoutStory(content, { ...frame, width: 2 }, [], [], measure);
    expect(result.overset).toBe(true); expect(result.consumed).toBe(0);
  });
  it('never splits a grapheme to squeeze an oversized emoji onto a line', () => {
    const result = layoutStory({ version: 1, paragraphs: [{ runs: [{ text: '👨‍👩‍👧‍👦X' }] }] }, { ...frame, width: 0.5 }, [], [], measure);
    expect(result.overset).toBe(true); expect(result.consumed).toBe(0);
  });
  it('reports production limitations and unsupported shadows without certifying the PDF', () => {
    const manager = new StateManager(); manager.createBlankProject();
    manager.addElement({ ...frame, pageId: manager.getActiveSpread().pages[0].id, opacity: 0.5, spotColor: 'Foil', shadow: { color: '#000', blurMm: 1, offsetX: 1, offsetY: 1 } });
    const report = printReadiness(manager.getState());
    expect(report.certifiedPdfX).toBe(false); expect(report.automaticTrapping).toBe(false);
    expect(report.items.map(item => item.code)).toEqual(expect.arrayContaining(['transparency', 'shadow', 'spot', 'font']));
  });
  it('activates the formatted engine for legacy frames when CJK rules are enabled', () => {
    const manager = new StateManager(); manager.createBlankProject();
    manager.addElement({ ...frame, pageId: manager.getActiveSpread().pages[0].id, text: '日本語。', paragraphStyleId: 'style-body' });
    manager.updateParagraphStyle('style-body', { cjkLineBreak: true, language: 'ja' });
    expect((manager.getElementById(frame.id) as TextElement).storyContent).toBeDefined();
    expect(() => parseProject(manager.exportJson(), manager.getState())).not.toThrow();
  });
  it('rejects hostile paragraph languages at import and EPUB export boundaries', () => {
    const manager = new StateManager(); manager.createBlankProject();
    manager.addElement({ ...frame, pageId: manager.getActiveSpread().pages[0].id });
    const text = manager.getElementById(frame.id) as TextElement;
    text.storyContent = { version: 1, paragraphs: [{ formatting: { language: 'ja" onload="alert(1)' as 'ja' }, runs: [{ text: 'Body' }] }] };
    expect(() => parseProject(manager.exportJson(), manager.getState())).toThrow();
    expect(() => generateEpubPackage(manager.getState())).toThrow('paragraph language');
  });
});
