/**
 * The canvas side of in-place text editing, loaded on demand together with the editor so that none
 * of it counts toward the startup bundle. The canvas keeps only the calls into this module and the
 * hooks that route pointer events and painting to an open editor.
 */
import type { CanvasElement, StoryContent, TextElement } from '../../types';
import { stateManager } from '../../state';
import { publicationWrapObjects } from '../publicationWrap';
import { layoutFrameNotes } from '../publicationReferences';
import { layoutStory } from '../storyLayout';
import { storyText } from '../storyContent';
import { MM_TO_PX } from '../viewport';
import { indexLines, liveStoryContent, spliceStory } from '../liveTextEditing';
import { LiveTextEditor, type LiveTextComposition, type LiveTextOpenOptions } from './liveTextEditor';

export interface LiveTextCanvasHost {
  canvas: HTMLCanvasElement;
  /** Element the hidden textarea and the caret are added to. */
  parent: HTMLElement;
  /** Top-left corner of the active spread on the canvas, in CSS pixels. */
  spreadOrigin(): { x: number; y: number };
  requestRender(): void;
  /** The editor asks to close: on Escape, or when focus leaves it (`toUi`: to a control outside the canvas). */
  close(live: LiveTextEditor, commit: boolean, toUi: boolean): void;
}

function activeFrame(id: string): TextElement | null {
  const current = stateManager.getActiveSpread().elements.find(item => item.id === id);
  return current?.type === 'text' ? current : null;
}

/** Lay out the frame as it will look once the editor's text is committed. */
function composeLiveText(text: TextElement, value: string, draft?: StoryContent | null): LiveTextComposition {
  const state = stateManager.getState();
  const spread = stateManager.getActiveSpread();
  const obstacles = publicationWrapObjects(state, spread).filter(other => other.id !== text.id && other.pageId === text.pageId);
  const content = draft || liveStoryContent(text, value, obstacles.length > 0);
  const layout = layoutStory(content, text, state.paragraphStyles, state.characterStyles,
    undefined, layoutFrameNotes(state, text).height, { obstacles, baselineGrid: state.settings.baselineGrid });
  return {
    content, lines: layout.lines, consumed: layout.consumed, overset: layout.overset,
    live: indexLines(layout.lines, value, content, text, state.paragraphStyles, state.characterStyles),
    topBaseline: !text.textContent && !obstacles.length,
  };
}

export function openLiveTextEditor(host: LiveTextCanvasHost, textEl: TextElement, options: LiveTextOpenOptions): LiveTextEditor {
  const id = textEl.id;
  const live: LiveTextEditor = new LiveTextEditor({
    parent: host.parent,
    frame: () => activeFrame(id),
    compose: composeLiveText,
    box: text => {
      const state = stateManager.getState();
      const origin = host.spreadOrigin();
      const pxPerMm = MM_TO_PX * state.zoom;
      const pageIdx = Math.max(0, stateManager.getActiveSpread().pages.findIndex(page => page.id === text.pageId));
      return { x: origin.x + (pageIdx * state.settings.widthMm + text.x) * pxPerMm, y: origin.y + text.y * pxPerMm, pxPerMm };
    },
    requestRender: () => host.requestRender(),
    close: (commit, toUi) => host.close(live, commit, !!toUi),
  }, textEl, host.canvas, options);
  return live;
}

/**
 * Commit a formatted story edited in place. The draft was built one edit at a time, so it is stored
 * as content: sending only the text would make the document re-derive the formatting from a single
 * before/after comparison and restyle everything between two separate edits.
 */
export function commitLiveStory(frame: TextElement, draft: StoryContent, text: string): boolean {
  try {
    const story = stateManager.getStoryContent(frame.id);
    const start = frame.storyStart ?? 0;
    const end = frame.storyEnd ?? storyText(story).length;
    stateManager.setStoryContent(frame.id, spliceStory(story, start, end, draft));
  } catch {
    // A locked frame elsewhere in the thread, for one: fall back to the frame-level text edit.
    return false;
  }
  stateManager.onMutation?.({ type: 'update', elementId: frame.id, updates: { text } as Partial<CanvasElement> });
  return true;
}
