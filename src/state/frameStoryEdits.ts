import type { ProjectState, StoryContent, TextElement } from '../types';
import { editStory, storyText } from '../engine/storyContent';

/** Reconcile older frame-level commands with the authoritative manuscript. */
export function reconcileFrameStoryEdits(state: ProjectState, getHead: (id: string) => TextElement | null,
  getContent: (id: string) => StoryContent, reflow: (id: string) => void) {
  const edits = new Map<TextElement, { text: string; start: number; end: number }[]>();
  for (const spread of state.spreads) for (const frame of spread.elements) {
    if (frame.type !== 'text' || !frame.textContent || frame.text === storyText(frame.textContent)) continue;
    const head = getHead(frame.id);
    if (!head) continue;
    const group = edits.get(head) || [];
    group.push({ text: frame.text, start: frame.storyStart ?? 0, end: frame.storyEnd ?? frame.text.length });
    edits.set(head, group);
  }
  for (const [head, group] of edits) {
    const content = getContent(head.id);
    let text = storyText(content);
    for (const edit of group.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    }
    head.storyContent = editStory(content, text);
    head.rawStoryText = storyText(head.storyContent);
    reflow(head.id);
  }
}
