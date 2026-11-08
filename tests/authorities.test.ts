import { beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { authoritySuggestions } from '../src/engine/authoritySuggestions';
import { plainStory, storyText } from '../src/engine/storyContent';
import { parseProject } from '../src/state/projectValidation';
import { generateEpubPackage } from '../src/epubExport';
import type { TextElement } from '../src/types';

const citation = 'Brown v. Board of Educ., 347 U.S. 483 (1954)';
const makeFrame = (manager: StateManager, id: string, text: string): TextElement => ({
  id, type: 'text', pageId: manager.getActiveSpread().pages[0].id,
  x: 20, y: 20, width: 170, height: 220, text, rotation: 0, opacity: 1,
  zIndex: 1, locked: false, fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.3,
  letterSpacingPt: 0, alignment: 'left', color: '#111111', columns: 1,
  columnGutterMm: 4, paddingMm: 0, borderWidthMm: 0, borderColor: 'transparent', backgroundColor: 'transparent',
});

describe('reviewed, live Table of Authorities', () => {
  let manager: StateManager;
  beforeEach(() => { manager = new StateManager(); manager.createBlankProject('A4', 'Authorities', false); });
  it('groups repeated canonical citations by category with live page references', () => {
    manager.addElement(makeFrame(manager, 'first', citation + ' Next authority.'));
    manager.markStoryIndex('first', 0, citation.length, citation, '', 'cases');
    manager.addSpread();
    manager.addElement(makeFrame(manager, 'second', 'Brown, supra. 42 U.S.C. § 1983'));
    manager.markStoryIndex('second', 0, 12, citation, '', 'cases');
    manager.markStoryIndex('second', 14, 30, '42 U.S.C. § 1983', '', 'statutes');
    const table = manager.createPublicationList('authorities');
    const text = storyText(manager.getStoryContent(table.id));
    expect(text).toContain('Table of Authorities\nCases'); expect(text).toContain('Statutes');
    expect(text.split(citation)).toHaveLength(2);
    const runs = manager.getStoryContent(table.id).paragraphs.flatMap(paragraph => paragraph.runs);
    expect(runs.filter(run => run.reference).map(run => run.text)).toEqual(['1', '2', '2']);
    const index = manager.createPublicationList('index');
    expect(storyText(manager.getStoryContent(index.id))).not.toContain(citation);
    expect(() => parseProject(manager.exportJson(), manager.getState())).not.toThrow();
    const epub = generateEpubPackage(manager.getState());
    expect(Object.values(epub).filter(value => typeof value === 'string').join('')).toContain('Table of Authorities');
  });
  it('unmarks without deleting text, refreshes generated output and restores it in one undo', () => {
    manager.addElement(makeFrame(manager, 'body', citation));
    manager.markStoryIndex('body', 0, citation.length, citation, '', 'cases');
    const id = manager.getState().indexEntries![0].id;
    const table = manager.createPublicationList('authorities');
    manager.removeIndexMark(id);
    expect(storyText(manager.getStoryContent('body'))).toBe(citation);
    expect(storyText(manager.getStoryContent(table.id))).not.toContain(citation);
    manager.undo(); expect(storyText(manager.getStoryContent(table.id))).toContain(citation);
  });
  it('omits deleted anchors and refuses duplicate marking or edits to locked sources', () => {
    manager.addElement(makeFrame(manager, 'body', citation));
    manager.markStoryIndex('body', 0, citation.length, citation, '', 'cases');
    const id = manager.getState().indexEntries![0].id;
    expect(() => manager.markStoryIndex('body', 0, citation.length, citation, '', 'cases')).toThrow('already contains');
    manager.getElementById('body')!.locked = true;
    expect(() => manager.removeIndexMark(id)).toThrow('Unlock');
    manager.getElementById('body')!.locked = false;
    const table = manager.createPublicationList('authorities');
    manager.setStoryText('body', 'Citation removed.');
    expect(storyText(manager.getStoryContent(table.id))).not.toContain(citation);
    expect(manager.runPreflightCheck().some(issue => issue.code === 'MISSING_REFERENCE')).toBe(true);
  });
  it('suggests bounded US patterns with correct paragraph offsets and no automatic marks', () => {
    const content = plainStory(`Preface\n${citation}\n42 U.S.C. § 1983`);
    const matches = authoritySuggestions(content), text = storyText(content);
    expect(matches.map(match => match.category)).toEqual(['cases', 'statutes']);
    for (const match of matches) expect(text.slice(match.start, match.end)).toBe(match.text);
    expect(authoritySuggestions(plainStory((citation + '\n').repeat(300))).length).toBe(200);
    expect(content.paragraphs.flatMap(paragraph => paragraph.runs).some(run => run.indexId)).toBe(false);
  });
});
