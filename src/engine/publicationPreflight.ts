import type { CanvasElement, PreflightIssue, ProjectState, StoryRun } from '../types';
import { layoutFrameNotes, publicationHeadings, textFrames } from './publicationReferences';
import { printReadiness } from './printReadiness';
import { createTableThreadLookup } from './tableCells';
import { layoutContentTables } from './tableLayout';
import { publicationCaptions } from './publicationCaptions';

export function publicationPreflight(state: ProjectState, target: 'editor' | 'epub' | 'print' = 'editor'): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const hiddenLayers = new Set(state.layers?.filter(layer => !layer.visible || layer.printable === false).map(layer => layer.id));
  const excluded = (element: CanvasElement) => element.pasteboard || element.editorialOnly || element.nonprinting || hiddenLayers.has(element.layerId || 'layer-1');
  const frames = textFrames(state).filter(frame => !frame.pasteboard);
  let headingIds: Set<string | undefined> | undefined;
  let captionIds: Set<string> | undefined;
  const hasCaption = (id: string) => (captionIds ??= new Set(publicationCaptions(state).map(caption => caption.id))).has(id);
  const frameIds = new Set(frames.map(frame => frame.id));
  const notes = state.settings.footnotes || [];
  const noteIds = new Set(notes.map(note => note.id));
  const anchorCounts = new Map<string, number>();
  const indexAnchors = new Set<string>();
  const referenceRuns: { headId: string; noteId?: string; reference?: StoryRun['reference'] }[] = [];
  for (const head of frames) {
    if (head.prevFrameId || !head.storyContent) continue;
    for (const paragraph of head.storyContent.paragraphs) for (const run of paragraph.runs) {
      if (run.noteId) anchorCounts.set(run.noteId, (anchorCounts.get(run.noteId) || 0) + 1);
      if (run.indexId) indexAnchors.add(run.indexId);
      if (run.reference || (run.noteId && !noteIds.has(run.noteId))) {
        referenceRuns.push({ headId: head.id, noteId: run.noteId, reference: run.reference });
      }
    }
  }
  let locations: Map<string, { spreadIndex: number; pageNumber: number }> | undefined;
  function issue(code: PreflightIssue['code'], message: string, elementId?: string, severity: PreflightIssue['severity'] = 'error') {
    if (elementId && !locations) {
      const index = new Map<string, { spreadIndex: number; pageNumber: number }>();
      for (const [spreadIndex, spread] of state.spreads.entries()) {
        const pages = new Map(spread.pages.map(page => [page.id, page.pageNumber]));
        for (const element of spread.elements) {
          const pageNumber = (pages.get(element.pageId) ?? spread.pages[0]?.pageNumber) || 1;
          if (!index.has(element.id)) index.set(element.id, { spreadIndex, pageNumber });
        }
      }
      locations = index;
    }
    const location = elementId ? locations?.get(elementId) : undefined;
    const { spreadIndex, pageNumber } = location ?? { spreadIndex: 0, pageNumber: state.spreads[0]?.pages[0]?.pageNumber || 1 };
    issues.push({ id: `publication-${code}-${elementId || issues.length}`, code, message, severity, elementId, spreadIndex, pageNumber });
  }
  for (const note of notes) {
    if (!note.text.trim()) issue('ORPHAN_NOTE', `Note ${note.number} has no body. Fill it in or delete the note before exporting.`, note.elementId);
    const anchors = anchorCounts.get(note.id);
    if (anchors !== 1) issue('ORPHAN_NOTE', `Note ${note.number} has ${anchors ? 'duplicated' : 'no surviving'} manuscript anchors. Reinsert or delete this note.`, note.elementId);
  }
  for (const { headId, noteId, reference: ref } of referenceRuns) {
    if (noteId && !noteIds.has(noteId)) issue('ORPHAN_NOTE', 'A note marker has no note body. Remove or replace the marker.', headId);
    if (ref) {
      const exists = ref.format === 'caption' ? hasCaption(ref.targetElementId) : ref.targetParagraphId
        ? (headingIds ??= new Set(publicationHeadings(state).map(heading => heading.paragraphId))).has(ref.targetParagraphId)
        : frameIds.has(ref.targetElementId);
      if (!exists) issue('MISSING_REFERENCE', 'A reference target was removed or is no longer a heading. Choose a new target in the Story Editor.', headId);
    }
  }
  for (const entry of state.indexEntries || []) if (!entry.elementId || !frameIds.has(entry.elementId) || !indexAnchors.has(entry.id)) {
    issue('MISSING_REFERENCE', `Index topic “${entry.topic}” has no live text anchor. Mark the text again or remove the entry.`, entry.elementId, 'warning');
  }
  for (const frame of frames) {
    if (frame.generated?.kind === 'caption' && !hasCaption(frame.id)) issue('MISSING_REFERENCE', 'This caption no longer has visible artwork. Move or remove the caption before export.', frame.id);
    if (target === 'epub') continue;
    const available = frame.height - 2 * (frame.paddingMm ?? 2) - frame.fontSizePt * 25.4 / 72;
    const layout = notes.length ? layoutFrameNotes(state, frame) : undefined;
    if (layout?.unplacedAnchors || (!frame.nextFrameId && layout?.remaining) || (layout?.height ?? 0) > available) {
      issue('NOTE_OVERFLOW', 'Footnote text does not fit beside its anchor or at the end of its story. Add a continuation frame, enlarge the frame, or convert the note to an endnote.', frame.id);
    }
  }
  for (const spread of state.spreads) for (const element of spread.elements) if (element.type === 'image') {
    if (excluded(element)) continue;
    if (!element.src) issue('MISSING_ASSET', 'This image frame has no source. Place an image or remove the placeholder before production export.', element.id);
    else if (!element.src.startsWith('data:')) issue('EXTERNAL_ASSET', 'This image is not embedded. Relink it from a local file, or let export download it; unavailable links will block export.', element.id, 'warning');
    if (!element.decorative && !element.altText?.trim()) issue('MISSING_ALT_TEXT', 'Add an image description or mark this artwork as decorative before production EPUB export.', element.id, target === 'epub' ? 'error' : 'warning');
    if (element.adjustments && !/^data:image\/(?:png|jpeg|webp);/i.test(element.src)) {
      issue('PUBLICATION_FLOW', 'Image adjustments require an embedded PNG, JPEG or WebP image.', element.id);
    }
  }
  for (const spread of [...state.spreads, ...state.masterSpreads]) for (const artwork of spread.elements) {
    if ((artwork.type !== 'shape' && artwork.type !== 'path') || !artwork.decoration || excluded(artwork)) continue;
    if (artwork.spotColor) issue('PUBLICATION_FLOW', 'Mesh gradients and hatching require process or RGB colors.', artwork.id);
    if (artwork.decoration.kind === 'hatch' && Math.hypot(artwork.width, artwork.height) / (2 * artwork.decoration.spacing) > 2048) {
      issue('PUBLICATION_FLOW', 'Increase hatch spacing for this large frame.', artwork.id);
    }
    if (target === 'epub') issue('PUBLICATION_FLOW', 'This EPUB edition uses the standard fill for mesh or hatch artwork.', artwork.id, 'warning');
  }
  if (state.publicationError) issue('PUBLICATION_FLOW', state.publicationError);
  const reviewedTables = new Set<string>();
  const findTableThread = createTableThreadLookup(state.spreads);
  for (const spread of state.spreads) for (const table of spread.elements) {
    if (table.type !== 'table' || excluded(table) || reviewedTables.has(table.id)) continue;
    const thread = findTableThread(table), head = thread[0];
    for (const frame of thread) reviewedTables.add(frame.id);
    if (head.rowSizing !== 'content') continue;
    if (thread.some(excluded)) {
      issue('TABLE_LAYOUT', 'A table continuation is hidden or excluded from publication. Show every linked frame or unlink the excluded frame before PDF export.', head.id);
    }
    const layout = layoutContentTables(thread);
    if (layout.pendingRows.length) issue('TABLE_LAYOUT', `${layout.pendingRows.length} table row(s) do not fit. Add a continuation page, enlarge the frame, or shorten the first overflowing row (${layout.pendingRows[0] + 1}).`, head.id);
    for (const frame of layout.frames) if (frame.horizontalOverflow) issue('TABLE_LAYOUT', 'Table text or repeated headers/footers exceed this frame. Widen the columns, reduce padding, or enlarge the frame.', frame.frameId);
  }
  const pending = (state.storyRevisions || []).filter(revision => revision.status === 'pending');
  if (pending.length) issue('PUBLICATION_FLOW', `${pending.length} manuscript revision(s) await review. Exports use the current manuscript; proposed edits are excluded.`, pending[0].storyId, 'warning');
  if (target === 'print') for (const item of printReadiness(state).items) if (item.severity === 'error') issue('PUBLICATION_FLOW', item.message, item.elementId);
  return issues;
}
