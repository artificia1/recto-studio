import { describe, expect, it } from 'vitest';
import { buildHouseStyleEdits, checkHouseStyle, defaultHouseStyleRules } from '../src/engine/houseStyle';
import { captureLayout, compareLayouts } from '../src/engine/layoutChanges';
import { StateManager } from '../src/state/stateManager';
import type { StoryContent, TextElement } from '../src/types';

function publication(content: StoryContent) {
  const manager = new StateManager();
  manager.createBlankProject('A4', 'Editorial review', false);
  const head: TextElement = {
    id: 'head', pageId: manager.getActiveSpread().pages[0].id, type: 'text', text: '',
    x: 20, y: 25, width: 110, height: 75, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    fontFamily: 'Times', fontSizePt: 12, lineHeight: 1.3, letterSpacingPt: 0, color: '#111111',
    alignment: 'left', columns: 1, columnGutterMm: 4, backgroundColor: 'transparent',
    borderColor: 'transparent', borderWidthMm: 0, paddingMm: 2,
  };
  manager.addElement(head);
  manager.setStoryContent(head.id, content);
  return { manager, head: manager.getElementById(head.id) as TextElement };
}

describe('editorial review', () => {
  it('reports paragraph and note movement and overset without modifying the project', () => {
    const { manager } = publication({ version: 1, paragraphs: [
      { id: 'opening', runs: [{ text: 'Opening paragraph.' }] },
      { id: 'body', runs: [{ text: 'A paragraph with a citation.' }] },
    ] });
    manager.insertFootnote('head', 'Source details.', manager.getStoryContent('head').paragraphs[0].runs[0].text.length + 8);
    const original = manager.getState();
    const before = captureLayout(original);
    const draft = structuredClone(original);
    const frame = draft.spreads[0].elements[0] as TextElement;
    const oldPage = draft.spreads[0].pages[0];
    draft.spreads[0].pages.push({ ...oldPage, id: 'new-page', pageNumber: 2 });
    frame.pageId = 'new-page';
    const moved = compareLayouts(before, captureLayout(draft));
    expect(moved.pagesAfter).toBe(2);
    expect(moved.paragraphs).toHaveLength(2);
    expect(moved.notes[0].to[0].page).toBe(2);
    frame.height = 1;
    expect(compareLayouts(before, captureLayout(draft)).newOverset[0].frameId).toBe('head');
    expect(original.spreads[0].pages).toHaveLength(1);
  });

  it('applies only selected fixes in one undo step and preserves formatting and anchors', () => {
    const { manager } = publication({ version: 1, paragraphs: [{ id: 'body', runs: [
      { text: 'e-mail  12 mm. ', bold: true },
      { text: 'e-mail', italic: true, indexId: 'index' },
      { text: ' x-e-mailer' },
    ] }] });
    const state = manager.getState();
    const rules = { ...defaultHouseStyleRules, terms: 'e-mail → email', spacing: true, units: true };
    const result = checkHouseStyle(state, rules);
    expect(result.findings.map(finding => finding.reason)).toEqual([
      'Preferred wording', 'Repeated spaces', 'Nonbreaking space before unit',
    ]);
    const edits = buildHouseStyleEdits(state, result.findings.filter(finding => finding.reason !== 'Repeated spaces'));
    const revision = manager.getDocumentRevision();
    manager.applyReviewedStoryEdits(revision, edits);
    const runs = manager.getStoryContent('head').paragraphs[0].runs;
    expect(runs[0]).toMatchObject({ text: 'email  12\u00a0mm. ', bold: true });
    expect(runs[1]).toMatchObject({ text: 'e-mail', italic: true, indexId: 'index' });
    expect(() => manager.applyReviewedStoryEdits(revision, edits)).toThrow('document changed');
    manager.undo();
    expect(manager.getStoryContent('head').paragraphs[0].runs[0].text).toBe('e-mail  12 mm. ');
  });
});
