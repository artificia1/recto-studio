import { describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { plainStory, storyText } from '../src/engine/storyContent';
import { parseConcordance, concordanceMatches } from '../src/engine/indexConcordance';
import { hierarchicalIndex } from '../src/engine/indexLayout';
import { layoutFrameNotes } from '../src/engine/publicationReferences';
import type { TextElement } from '../src/types';

function publication() {
  const manager = new StateManager(); manager.createBlankProject('A4', 'Academic book', false);
  const frame: TextElement = { id: 'manuscript', type: 'text', pageId: manager.getActiveSpread().pages[0].id, x: 20, y: 20, width: 160, height: 180,
    rotation: 0, opacity: 1, locked: false, zIndex: 1, fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.4, letterSpacingPt: 0, color: '#111',
    text: '', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
  manager.addElement(frame); return { manager, frame };
}
describe('academic indexing and column notes', () => {
  it('marks a concordance once, preserves mixed formatting, and undoes the entire batch', async () => {
    const { manager, frame } = publication();
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ runs: [{ text: 'Clay ', bold: true }, { text: 'soil and soil.' }] }, { runs: [{ text: 'Topsoil is not soil.', italic: true }] }] });
    const before = manager.getStoryContent(frame.id), original = storyText(before);
    const source = 'soil\tEcology > Ground > Soil\tSee also: Erosion';
    expect(concordanceMatches(manager.getState(), parseConcordance(source))).toHaveLength(3);
    expect(await manager.applyIndexConcordance(source)).toBe(3);
    const marked = manager.getStoryContent(frame.id);
    expect(storyText(marked)).toBe(original); expect(marked.paragraphs[0].runs[0].bold).toBe(true);
    expect(marked.paragraphs[1].runs.every(run => run.italic)).toBe(true);
    expect(await manager.applyIndexConcordance(source)).toBe(0);
    const index = manager.createPublicationList('index');
    const text = storyText(manager.getStoryContent(index.id));
    expect(text).toContain('Ecology'); expect(text).toContain('    Ground'); expect(text).toContain('        Soil'); expect(text).toContain('See also Erosion');
    manager.undo(); manager.undo();
    expect(storyText(manager.getStoryContent(frame.id))).toBe(original);
    expect(manager.getState().indexEntries).toHaveLength(0);
  });
  it('uses physical page order, compresses runs, and supports cross-reference-only topics', () => {
    const pages = [1, 2, 3, 4].map(pageNumber => ({ id: `p${pageNumber}`, pageNumber, side: 'right' as const }));
    const entries = [1, 2, 3].map(pageNumber => ({ id: `e${pageNumber}`, topic: 'Ground', subtopics: ['Soil'], pageNumber }));
    const paragraphs = hierarchicalIndex([...entries, { id: 'see', topic: 'Earth', pageNumber: 1, see: 'Ground' }], pages);
    const text = storyText({ version: 1, paragraphs });
    expect(text).toContain('Soil  1–3'); expect(text).toContain('Earth  See Ground');
  });
  it('reserves the maximum column note stack and positions notes at their anchors', () => {
    const { manager, frame } = publication();
    const body = { ...frame, columns: 2, width: 100, height: 60, storyContent: plainStory('Body copy '.repeat(100)) };
    body.storyContent.paragraphs[0].runs = [{ text: 'First¹', noteId: 'first' }, { text: ' Body copy'.repeat(100) }];
    const notes = [{ id: 'first', text: 'An explanatory citation that wraps within the column. '.repeat(3), number: 1, elementId: frame.id, anchorVersion: 1 as const }];
    const result = layoutFrameNotes(manager.getState(), body, notes);
    expect(result.columnWidth).toBe(48); expect(result.lines.length).toBeGreaterThan(3);
    expect(result.lines.every(line => line.x === 0 && line.column === 0)).toBe(true);
    expect(result.height).toBeCloseTo(result.lines.length * result.lineHeight + 3);
  });
});
