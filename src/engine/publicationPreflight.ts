import type { CanvasElement, PreflightIssue, ProjectState } from '../types';
import { contentOf, layoutFrameNotes, publicationHeadings, storyHeads, textFrames } from './publicationReferences';
import { printReadiness } from './printReadiness';
import { tableThread } from './tableCells';
import { layoutContentTables } from './tableLayout';
import { publicationCaptions } from './publicationCaptions';

export function publicationPreflight(state: ProjectState, target: 'editor' | 'epub' | 'print' = 'editor'): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const hiddenLayers = new Set(state.layers?.filter(layer => !layer.visible || layer.printable === false).map(layer => layer.id));
  const excluded = (element: CanvasElement) => element.pasteboard || element.editorialOnly || element.nonprinting || hiddenLayers.has(element.layerId || 'layer-1');
  const frames = textFrames(state).filter(frame => !frame.pasteboard);
  const allRuns = storyHeads(state).filter(head => !head.pasteboard).flatMap(head => contentOf(head).paragraphs.flatMap(paragraph => paragraph.runs.map(run => ({ run, head }))));
  const headings = publicationHeadings(state);
  const captions = new Set(publicationCaptions(state).map(caption => caption.id));
  function issue(code: PreflightIssue['code'], message: string, elementId?: string, severity: PreflightIssue['severity'] = 'error') {
    const spreadIndex = Math.max(0, state.spreads.findIndex(spread => spread.elements.some(element => element.id === elementId)));
    const element = state.spreads[spreadIndex]?.elements.find(element => element.id === elementId);
    const page = state.spreads[spreadIndex]?.pages.find(page => page.id === element?.pageId) || state.spreads[spreadIndex]?.pages[0];
    issues.push({ id: `publication-${code}-${elementId || issues.length}`, code, message, severity, elementId, spreadIndex, pageNumber: page?.pageNumber || 1 });
  }
  for (const note of state.settings.footnotes || []) {
    if (!note.text.trim()) issue('ORPHAN_NOTE', `Note ${note.number} has no body. Fill it in or delete the note before exporting.`, note.elementId);
    const anchors = allRuns.filter(({ run }) => run.noteId === note.id);
    if (anchors.length !== 1) issue('ORPHAN_NOTE', `Note ${note.number} has ${anchors.length ? 'duplicated' : 'no surviving'} manuscript anchors. Reinsert or delete this note.`, note.elementId);
  }
  for (const { run, head } of allRuns) {
    if (run.noteId && !state.settings.footnotes?.some(note => note.id === run.noteId)) issue('ORPHAN_NOTE', 'A note marker has no note body. Remove or replace the marker.', head.id);
    if (run.reference) {
      const ref = run.reference;
      const exists = ref.format === 'caption' ? captions.has(ref.targetElementId) : ref.targetParagraphId ? headings.some(heading => heading.paragraphId === ref.targetParagraphId) : frames.some(frame => frame.id === ref.targetElementId);
      if (!exists) issue('MISSING_REFERENCE', 'A reference target was removed or is no longer a heading. Choose a new target in the Story Editor.', head.id);
    }
  }
  for (const entry of state.indexEntries || []) if (!frames.some(frame => frame.id === entry.elementId) || !allRuns.some(({ run }) => run.indexId === entry.id)) {
    issue('MISSING_REFERENCE', `Index topic “${entry.topic}” has no live text anchor. Mark the text again or remove the entry.`, entry.elementId, 'warning');
  }
  for (const frame of frames) {
    if (frame.generated?.kind === 'caption' && !captions.has(frame.id)) issue('MISSING_REFERENCE', 'This caption no longer has visible artwork. Move or remove the caption before export.', frame.id);
    const notes = layoutFrameNotes(state, frame);
    if (target !== 'epub' && (notes.unplacedAnchors || (!frame.nextFrameId && notes.remaining) ||
      notes.height > frame.height - 2 * (frame.paddingMm ?? 2) - frame.fontSizePt * 25.4 / 72)) {
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
  for (const spread of state.spreads) for (const table of spread.elements) {
    if (table.type !== 'table' || excluded(table)) continue;
    const thread = tableThread(state.spreads, table), head = thread[0];
    if (head.rowSizing !== 'content' || reviewedTables.has(head.id)) continue;
    reviewedTables.add(head.id);
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
