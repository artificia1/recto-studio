import { randomUUID } from 'node:crypto';
import type { PreflightIssue, ProjectState, TextElement } from '../../src/types';
import { fontManager } from '../../src/fontManager';
import { contentOf, layoutFrameNotes, publicationSnapshot, reflowStoryState, textFrames } from '../../src/engine/publicationReferences';
import { publicationWrapObjects } from '../../src/engine/publicationWrap';
import { layoutStory } from '../../src/engine/storyLayout';
import { plainStory, storyText } from '../../src/engine/storyContent';
import { revisedStory } from '../../src/engine/storyRevisions';
import { protectedHeadingIds } from '../../src/engine/manuscriptUpdates';
import { publicationPreflight } from '../../src/engine/publicationPreflight';
import { reviewPreflightChange } from '../../src/engine/preflightReview';
import { captureComposedLayout, compareLayouts } from '../../src/engine/layoutChanges';
import { parseProject } from '../../src/state/projectValidation';
import { INITIAL_STATE } from '../../src/state/defaults';
import { limits, sha256, type PublishingWorkspace } from './workspace';

export const projectExtensions = ['.recto', '.json'] as const;
export type LoadedProject = Awaited<ReturnType<typeof loadProject>>;

export async function loadProject(workspace: PublishingWorkspace, file: string, expected?: string) {
  const bytes = await workspace.read(file, projectExtensions, limits.project);
  const revision = sha256(bytes);
  if (expected && revision !== expected) throw new Error('The publication changed. Read it again and repeat the preview.');
  const source = validatePublishingProject(bytes);
  return { file, revision, source };
}

export function validatePublishingProject(bytes: Buffer) {
  if (bytes.byteLength > limits.project) throw new Error('The publication exceeds 32 MiB.');
  const source = parseProject(bytes.toString('utf8'), INITIAL_STATE);
  if (source.spreads.reduce((count, spread) => count + spread.pages.length, 0) > limits.pages) {
    throw new Error('This server supports publications up to 500 pages.');
  }
  return source;
}

export async function confirmProjectRevision(workspace: PublishingWorkspace, file: string, expected: string) {
  const bytes = await workspace.read(file, projectExtensions, limits.project);
  if (sha256(bytes) !== expected) throw new Error('The publication changed. Read it again and repeat the preview.');
}

export function withPublication<T>(project: LoadedProject, run: (source: ProjectState) => Promise<T>) {
  return fontManager.withProjectFonts(project.source.embeddedFonts, () => run(project.source));
}

export const headlessLayoutNotice = 'Layout uses headless font metrics. Review final line breaks in Recto, especially for fonts without embedded data.';

export function resolveStory(state: ProjectState, id: string) {
  const byId = new Map(textFrames(state).map(frame => [frame.id, frame]));
  let frame = byId.get(id);
  if (!frame) throw new Error('Choose a text frame from the publication.');
  const seen = new Set<string>();
  while (frame.prevFrameId) {
    if (seen.has(frame.id)) throw new Error('The linked story is circular.');
    seen.add(frame.id);
    const previous = byId.get(frame.prevFrameId);
    if (!previous) throw new Error('The linked story is incomplete.');
    frame = previous;
  }
  const head = frame;
  const frames: TextElement[] = [head];
  while (frame.nextFrameId) {
    const next = byId.get(frame.nextFrameId);
    if (!next || frames.includes(next)) throw new Error('The linked story is incomplete or circular.');
    frames.push(next);
    frame = next;
  }
  return { head, frames };
}

export function assertEditable(state: ProjectState, frames: TextElement[]) {
  const lockedLayers = new Set(state.layers.filter(layer => layer.locked).map(layer => layer.id));
  if (frames.some(frame => frame.generated || frame.locked || frame.editorialOnly || lockedLayers.has(frame.layerId || 'layer-1'))) {
    throw new Error('Make the generated story static and unlock its frames before editing.');
  }
}

export function composedPreflight(state: ProjectState, target: 'editor' | 'print') {
  const issues = publicationPreflight(state, target);
  const excluded = new Set(state.layers.filter(layer => !layer.visible || layer.printable === false).map(layer => layer.id));
  for (const [spreadIndex, spread] of state.spreads.entries()) {
    const obstacles = publicationWrapObjects(state, spread);
    for (const frame of spread.elements) {
      if (frame.type !== 'text' || frame.nextFrameId || frame.pasteboard || frame.editorialOnly || excluded.has(frame.layerId || 'layer-1')) continue;
      const content = frame.textContent || plainStory(frame.text, frame.paragraphStyleId);
      const layout = layoutStory(content, frame, state.paragraphStyles, state.characterStyles, undefined,
        layoutFrameNotes(state, frame).height, { obstacles, baselineGrid: state.settings.baselineGrid });
      if (!layout.overset) continue;
      issues.push({ id: `headless-overset-${frame.id}`, severity: 'error', code: 'OVERSET_TEXT',
        message: 'Text exceeds the final frame with headless layout metrics.', spreadIndex, elementId: frame.id,
        pageNumber: spread.pages.find(page => page.id === frame.pageId)?.pageNumber || 1 });
    }
  }
  return issues;
}

export function summarizeIssues(issues: PreflightIssue[], offset = 0, limit = 30) {
  return { total: issues.length, errors: issues.filter(issue => issue.severity === 'error').length,
    warnings: issues.filter(issue => issue.severity === 'warning').length, items: issues.slice(offset, offset + limit),
    nextOffset: offset + limit < issues.length ? offset + limit : null };
}

export type StoryChange = { kind: 'replace'; start: number; end: number; expectedText: string; text: string }
  | { kind: 'tracking'; deltaPerThousandEm: number };

export async function proposeStoryChange(source: ProjectState, frameId: string, change: StoryChange) {
  const draft = structuredClone(source);
  const { head, frames } = resolveStory(draft, frameId);
  assertEditable(draft, frames);
  const content = head.storyContent || plainStory(head.rawStoryText ?? frames.map(frame => frame.text).join('\n\n'), head.paragraphStyleId);
  if (change.kind === 'replace') {
    const current = storyText(content);
    if (change.end > current.length || change.start > change.end || current.slice(change.start, change.end) !== change.expectedText) {
      throw new Error('Expected text does not match the selected UTF-16 range. Read the story again.');
    }
    if (change.text === change.expectedText) throw new Error('The replacement leaves the manuscript unchanged.');
    if (!change.text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(change.text)) throw new Error('Replacement text contains unsupported characters.');
    if (/\r/.test(change.text)) throw new Error('Use LF for paragraph breaks.');
    const revised = revisedStory(content, change.start, change.end, change.text);
    const oldIds = new Set(content.paragraphs.map(paragraph => paragraph.id));
    const newIds = new Set(revised.paragraphs.map(paragraph => paragraph.id));
    if ([...protectedHeadingIds(draft)].some(id => oldIds.has(id) && !newIds.has(id))) {
      throw new Error('This edit would remove a referenced heading. Preserve its paragraph or resolve its references in the editor.');
    }
    head.storyContent = revised;
  } else {
    const delta = change.deltaPerThousandEm;
    head.storyContent = { ...content, paragraphs: content.paragraphs.map(paragraph => {
      const style = draft.paragraphStyles.find(item => item.id === (paragraph.styleId || head.paragraphStyleId));
      const spacing = paragraph.formatting?.letterSpacingPt ?? style?.letterSpacingPt ?? head.letterSpacingPt;
      const size = paragraph.formatting?.fontSizePt || style?.fontSizePt || head.fontSizePt;
      return { ...paragraph, formatting: { ...paragraph.formatting, letterSpacingPt: spacing + size * delta / 1000 } };
    }) };
  }
  for (const paragraph of head.storyContent.paragraphs) paragraph.id ??= 'paragraph-' + randomUUID();
  head.rawStoryText = storyText(head.storyContent);
  reflowStoryState(draft, head.id);
  if (head.autoExtendStory) {
    const { StateManager } = await import('../../src/state/stateManager');
    const manager = new StateManager();
    manager.loadFromJson(JSON.stringify(draft));
    const paginated = manager.getState();
    if (paginated.spreads.reduce((pages, spread) => pages + spread.pages.length, 0) > limits.pages) {
      throw new Error('Automatic pagination would exceed the 500 page limit.');
    }
    return paginated;
  }
  return draft;
}

export function previewDraft(source: ProjectState, draft: ProjectState) {
  const before = publicationSnapshot(source);
  const after = publicationSnapshot(draft);
  const layout = compareLayouts(captureComposedLayout(before), captureComposedLayout(after));
  const preflight = reviewPreflightChange(composedPreflight(before, 'print'), composedPreflight(after, 'print'));
  return { pageCount: { before: layout.pagesBefore, after: layout.pagesAfter },
    movedParagraphs: { total: layout.paragraphs.length, items: layout.paragraphs.slice(0, 20).map(({ label, from, to }) => ({ label, from, to })) },
    movedNotes: { total: layout.notes.length, items: layout.notes.slice(0, 20).map(({ label, from, to }) => ({ label, from, to })) },
    newOverset: layout.newOverset.slice(0, 50), clearedOverset: layout.clearedOverset.slice(0, 50),
    preflight: { cleared: summarizeIssues(preflight.cleared), introduced: summarizeIssues(preflight.introduced), remaining: summarizeIssues(preflight.remaining) },
    metrics: headlessLayoutNotice };
}
