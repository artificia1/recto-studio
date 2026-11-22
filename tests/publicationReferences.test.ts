import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { storyText } from '../src/engine/storyContent';
import { layoutFrameNotes, publicationHeadings, reflowStoryState } from '../src/engine/publicationReferences';
import { parseProject } from '../src/state/projectValidation';
import { composeStoryInBackground, compositionFontSamples, prepareStoryComposition } from '../src/engine/storyComposition';
import type { TextElement } from '../src/types';

function addFrame(manager: StateManager, id: string, text = '', height = 220): TextElement {
  const frame: TextElement = { id, type: 'text', pageId: manager.getActiveSpread().pages[0].id,
    x: 25, y: 25, width: 160, height, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    text, fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.4, letterSpacingPt: 0,
    color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0,
    backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
  manager.addElement(frame); return frame;
}

describe('live publication references', () => {
  let manager: StateManager;
  beforeEach(() => { manager = new StateManager(); manager.createBlankProject('A4', 'Reference test', false); });

  it('scopes dimension and type changes to their story and matches a complete reflow', () => {
    const copy = Array.from({ length: 15 }, (_, index) => ({
      runs: [{ text: `Section ${index}. ` + 'Copy can flow across frames with different measures. '.repeat(12) }],
      formatting: { keepWithNext: index % 2 === 0 },
    }));
    const ids = ['head', 'second', 'third', 'fourth', 'tail'];
    for (const id of ids) addFrame(manager, id, '', 55);
    for (let index = 1; index < ids.length; index++) manager.linkTextFrames(ids[index - 1], ids[index]);
    manager.setStoryContent('head', { version: 1, paragraphs: copy });
    addFrame(manager, 'unrelated', 'Independent story');
    manager.setStoryContent('unrelated', { version: 1, paragraphs: [{ runs: [{ text: 'Independent story' }] }] });
    const frame = (id: string) => manager.getElementById(id) as TextElement;
    const first = frame('head').textContent;
    const reflow = vi.spyOn(manager, 'reflowStory');

    for (const updates of [{ width: 135, columns: 2 }, { columnGutterMm: 7 }, { height: 65 }, { fontSizePt: 14 }]) {
      reflow.mockClear();
      manager.updateElement('fourth', updates);
      expect(reflow).toHaveBeenCalledTimes(1);
      expect(frame('head').textContent).toBe(first);
      const full = structuredClone(manager.getState());
      const recomposed = reflowStoryState(full, 'head')!;
      expect(recomposed.map(item => [item.storyStart, item.storyEnd, item.textContent]))
        .toEqual(ids.map(id => [frame(id).storyStart, frame(id).storyEnd, frame(id).textContent]));
    }
    manager.undo();
    expect(frame('fourth').fontSizePt).toBe(11);
  });

  it.each([{ fontSizePt: 14 }, { height: 5 }, { width: 95, columns: 2, columnGutterMm: 7 }])(
    'returns the same story slices as the editor for a background frame edit %j', async updates => {
      const ids = ['first', 'middle', 'edited', 'last'];
      ids.forEach(id => addFrame(manager, id, '', 55));
      for (let index = 1; index < ids.length; index++) manager.linkTextFrames(ids[index - 1], ids[index]);
      manager.setStoryContent('first', { version: 1, paragraphs: Array.from({ length: 80 }, () => ({
        runs: [{ text: 'A linked story can keep its formatting when the type size changes. '.repeat(3) }],
      })) });
      const head = manager.getElementById('first') as TextElement;
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(prepareStoryComposition(manager.getState(), head, { frameId: 'edited', updates }, cancelled.signal)).resolves.toBeNull();
      const request = await prepareStoryComposition(manager.getState(), head, { frameId: 'edited', updates });
      expect(request).not.toBeNull();
      const before = new Map(ids.map(id => [id, structuredClone(manager.getElementById(id)) as TextElement]));
      for (const frame of before.values()) expect(storyText(frame.textContent!)).toBe(frame.text);
      const composed = await composeStoryInBackground(structuredClone(request!));
      expect(composed).not.toBeNull();
      expect(composed?.frames.some(frame => frame.id === 'edited')).toBe(true);
      if (updates.height) expect(composed?.frames.find(frame => frame.id === 'edited')?.text).toBe('');
      for (const frame of composed!.frames) expect(storyText(frame.textContent!)).toBe(frame.text);
      manager.updateElement('edited', updates);
      expect(composed?.content).toEqual(manager.getStoryContent('first'));
      for (const id of ids) {
        const expected = manager.getElementById(id) as TextElement;
        const actual = composed?.frames.find(frame => frame.id === id) || before.get(id)!;
        expect([actual.text, actual.storyStart, actual.storyEnd, actual.textContent])
          .toEqual([expected.text, expected.storyStart, expected.storyEnd, expected.textContent]);
      }
      const mismatched = structuredClone(request!);
      mismatched.probes[0].widths[0] += 1;
      await expect(composeStoryInBackground(mismatched)).resolves.toBeNull();
    });

  it('samples additional scripts only when they occur in existing or incoming text', () => {
    const latin = compositionFontSamples('English “quotes” and café.');
    expect(latin.slice(1).join('')).toContain('é');
    expect(latin.slice(1).join('')).not.toMatch(/[漢😀Я]/u);
    expect(compositionFontSamples('English text', '漢字とひらがな 😀 Пример').slice(1).join('')).toMatch(/漢.*😀.*П/u);
  });

  it('renumbers identified notes without rewriting scientific superscripts', () => {
    addFrame(manager, 'body', 'Energy x². A citation.');
    const first = manager.insertFootnote('body', 'First citation');
    const second = manager.insertFootnote('body', 'Second citation');
    manager.deleteFootnote(first.id);
    expect(manager.getFootnotes()).toHaveLength(1);
    expect(manager.getFootnotes()[0].id).toBe(second.id);
    expect(manager.getFootnotes()[0].number).toBe(1);
    expect(storyText(manager.getStoryContent('body'))).toBe('Energy x². A citation.¹');
    manager.undo();
    expect(manager.getFootnotes()).toHaveLength(2);
  });

  it('preserves note identity when inserting copy before its marker and after save/reopen', () => {
    addFrame(manager, 'body', 'A body paragraph.');
    const note = manager.insertFootnote('body', 'Persistent citation', 2);
    manager.setStoryText('body', `New introduction. ${storyText(manager.getStoryContent('body'))}`);
    const state = parseProject(manager.exportJson(), manager.getState());
    const frame = state.spreads.flatMap(spread => spread.elements).find(item => item.id === 'body') as TextElement;
    expect(frame.storyContent!.paragraphs.flatMap(paragraph => paragraph.runs).find(run => run.noteId === note.id)?.text).toBe('¹');
    expect(state.settings.footnotes?.[0].text).toBe('Persistent citation');
  });

  it('reports a deleted note anchor instead of attaching its body to an exponent', () => {
    addFrame(manager, 'body', 'Energy x².');
    const note = manager.insertFootnote('body', 'Citation');
    manager.setStoryText('body', 'Energy x².');
    expect(manager.runPreflightCheck().some(issue => issue.code === 'ORPHAN_NOTE')).toBe(true);
    expect(manager.getFootnotes()[0].id).toBe(note.id);
    expect(manager.getFootnotesForElement('body')).toEqual([]);
  });

  it('moves a note to the frame containing its anchor and measures wrapped lines', () => {
    addFrame(manager, 'body', 'A citation.');
    const note = manager.insertFootnote('body', 'A long note with several explanatory words. '.repeat(8));
    addFrame(manager, 'continued', '', 230);
    manager.linkTextFrames('body', 'continued');
    manager.updateElement('body', { height: 8 });
    expect(manager.getFootnotesForElement('body')).toHaveLength(0);
    expect(manager.getFootnotesForElement('continued').map(note => note.id)).toEqual([note.id]);
    const layout = layoutFrameNotes(manager.getState(), manager.getElementById('continued') as TextElement);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.height).toBeGreaterThan(layout.lineHeight + 3);
  });

  it('keeps contents and cross-references current with section labels and heading edits', () => {
    addFrame(manager, 'chapter');
    manager.setStoryContent('chapter', { version: 1, paragraphs: [{ styleId: 'style-h1', runs: [{ text: 'Original chapter' }] }, { runs: [{ text: 'Body copy.' }] }] });
    const heading = publicationHeadings(manager.getState())[0];
    addFrame(manager, 'reference', 'See page ');
    manager.insertStoryReference('reference', 9, 9, heading.elementId, heading.paragraphId);
    const toc = manager.createPublicationList('toc');
    manager.setPageSection(manager.getState().spreads[0].pages[0].id, { title: 'Front', startNumber: 1, numbering: 'roman-lower', prefix: 'P-' });
    expect(storyText(manager.getStoryContent('reference'))).toBe('See page P-i');
    manager.setStoryText('chapter', 'Revised chapter\nBody copy.');
    expect(storyText(manager.getStoryContent(toc.id))).toContain('Revised chapter');
    expect(storyText(manager.getStoryContent(toc.id))).toContain('P-i');
    expect(manager.getState().publicationError).toBeUndefined();
    expect(manager.getElementById(toc.id)?.type).toBe('text');
  });

  it('flags a removed reference target and restores it with undo', () => {
    addFrame(manager, 'target', 'Target'); addFrame(manager, 'reference', 'Page ');
    manager.insertStoryReference('reference', 5, 5, 'target');
    manager.deleteElement('target');
    expect(manager.runPreflightCheck().some(issue => issue.code === 'MISSING_REFERENCE')).toBe(true);
    manager.undo();
    expect(manager.runPreflightCheck().some(issue => issue.code === 'MISSING_REFERENCE')).toBe(false);
  });

  it('updates an anchored index and a generated endnotes story', () => {
    addFrame(manager, 'body', 'Typography improves reading.');
    manager.markStoryIndex('body', 0, 10, 'Typography');
    const index = manager.createPublicationList('index');
    expect(storyText(manager.getStoryContent(index.id))).toContain('Typography');
    const note = manager.insertFootnote('body', 'First endnote', 0, 'endnote');
    const endnotes = manager.createPublicationList('endnotes');
    expect(storyText(manager.getStoryContent(endnotes.id))).toContain('First endnote');
    manager.updateFootnote(note.id, { text: 'Revised endnote' });
    expect(storyText(manager.getStoryContent(endnotes.id))).toContain('Revised endnote');
    expect(manager.getFootnotesForElement('body')).toHaveLength(0);
    expect(manager.getState().publicationError).toBeUndefined();
  });

  it('does not mutate locked stories when inserting references', () => {
    addFrame(manager, 'body', 'Protected copy'); manager.updateElement('body', { locked: true });
    const saved = manager.exportJson();
    expect(() => manager.insertFootnote('body', 'Citation')).toThrow('Unlock');
    expect(() => manager.markStoryIndex('body', 0, 3, 'Term')).toThrow('Unlock');
    expect(manager.exportJson()).toBe(saved);
  });
});
