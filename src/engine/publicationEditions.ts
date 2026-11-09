import type { ProjectState } from '../types';
import { storyText } from './storyContent';

export const hiddenEditionIds = (state: ProjectState) => new Set(state.conditions?.filter(condition => !condition.visible).map(condition => condition.id));

/** Apply edition visibility to a detached export snapshot before composing stories. */
export function applyEditionVisibility(state: ProjectState) {
  const hidden = hiddenEditionIds(state);
  if (!hidden.size) return;
  const removedNotes = new Set<string>();
  const excluded = new Set<string>();
  for (const spread of [...state.spreads, ...state.masterSpreads]) {
    spread.elements = spread.elements.filter(element => {
      if (!element.conditionId || !hidden.has(element.conditionId)) return true;
      excluded.add(element.id);
      if ((element.type === 'text' || element.type === 'table') && (element.prevFrameId || element.nextFrameId)) {
        throw new Error('A hidden edition frame is linked. Apply the condition to its paragraphs or unlink the frame before export.');
      }
      if (element.type === 'text') for (const paragraph of element.storyContent?.paragraphs || []) {
        for (const run of paragraph.runs) if (run.noteId) removedNotes.add(run.noteId);
      }
      return false;
    });
    for (const element of spread.elements) {
      if (element.type !== 'text' || !element.storyContent || element.prevFrameId) continue;
      const paragraphs = element.storyContent.paragraphs.filter(paragraph => {
        if (!paragraph.conditionId || !hidden.has(paragraph.conditionId)) return true;
        for (const run of paragraph.runs) if (run.noteId) removedNotes.add(run.noteId);
        return false;
      });
      if (paragraphs.length === element.storyContent.paragraphs.length) continue;
      const content = { version: 1 as const, paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }] };
      element.storyContent = content;
      element.textContent = content;
      element.rawStoryText = element.text = storyText(content);
    }
  }
  if (excluded.size) for (const spread of state.spreads) spread.elements = spread.elements.filter(element =>
    element.type !== 'text' || element.generated?.kind !== 'caption' || !excluded.has(element.captionForId || ''));
  if (removedNotes.size) state.settings.footnotes = state.settings.footnotes?.filter(note => !removedNotes.has(note.id));
}
