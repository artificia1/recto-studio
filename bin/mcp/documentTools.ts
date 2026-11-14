import { randomUUID } from 'node:crypto';
import type { BaseElement, CanvasElement, ProjectState, TextElement } from '../../src/types';
import { arrangeSelection } from '../../src/engine/selectionGeometry';
import { migrateLegacyNotes, refreshPublication, reflowStoryState, storyHeads } from '../../src/engine/publicationReferences';
import { parseProject } from '../../src/state/projectValidation';
import { INITIAL_STATE } from '../../src/state/defaults';
import { z } from 'zod/v4';
import { limits, type PublishingWorkspace } from './workspace';
import { plainStory } from '../../src/engine/storyContent';

const id = z.string().min(1).max(512);
const mm = z.number().min(-2500).max(2500);
const dimension = mm.min(0.1);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const placement = { pageId: id, xMm: mm, yMm: mm, widthMm: dimension, heightMm: dimension, layerId: id.optional() };
export const documentChange = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('arrange'), spread: z.int().min(1).max(500), frameIds: z.array(id).min(2).max(100),
    operation: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom', 'horizontal', 'vertical']), gapMm: mm.min(0).optional() }),
  z.strictObject({ kind: z.literal('layer'), layerId: id, visible: z.boolean().optional(), printable: z.boolean().optional(),
    locked: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('edition'), conditionId: id, visible: z.boolean() }),
  z.strictObject({ kind: z.literal('parent'), spread: z.int().min(1).max(500), parentId: id.nullable() }),
  z.strictObject({ kind: z.literal('metadata'), title: z.string().trim().min(1).max(300) }),
  z.strictObject({ kind: z.literal('add-text'), ...placement, text: z.string().max(24_000),
    paragraphStyleId: id.optional(), fontSizePt: z.number().min(1).max(300).optional() }),
  z.strictObject({ kind: z.literal('add-shape'), ...placement, shape: z.enum(['rectangle', 'ellipse']),
    fill: color, stroke: color.optional(), strokeWidthMm: z.number().min(0).max(30).optional() }),
  z.strictObject({ kind: z.literal('relink-image'), frameId: id, source: z.string().min(1).max(1024) }),
  z.strictObject({ kind: z.literal('table-cell'), frameId: id, row: z.int().min(1).max(2000),
    column: z.int().min(1).max(200), text: z.string().max(24_000) }),
  z.strictObject({ kind: z.literal('story-note'), frameId: id, offset: z.int().min(0),
    noteType: z.enum(['footnote', 'endnote']), text: z.string().trim().min(1).max(8000) }),
  z.strictObject({ kind: z.literal('publication-list'), pageId: id.optional(),
    listType: z.enum(['toc', 'index', 'endnotes', 'authorities', 'figures', 'tables']) }),
  z.strictObject({ kind: z.literal('view'), showGuides: z.boolean().optional(), showBleed: z.boolean().optional(),
    showBaselineGrid: z.boolean().optional(), snapToGuides: z.boolean().optional(), showReadingOrder: z.boolean().optional(),
    showSlugBanner: z.boolean().optional(), displayQuality: z.enum(['fast', 'typical', 'high']).optional() }),
]);

type DocumentChange = z.infer<typeof documentChange>;

function placeFrame(draft: ProjectState, change: Extract<DocumentChange, { kind: 'add-text' | 'add-shape' }>) {
  const spread = draft.spreads.find(spread => spread.pages.some(page => page.id === change.pageId));
  const layer = draft.layers.find(layer => layer.id === (change.layerId || draft.activeLayerId));
  if (!spread || !layer || !layer.visible || layer.locked) throw new Error('Choose an existing page and a visible, unlocked layer.');
  const geometry: Omit<BaseElement, 'type'> = { id: 'frame-' + randomUUID(), pageId: change.pageId, layerId: layer.id,
    x: change.xMm, y: change.yMm, width: change.widthMm, height: change.heightMm,
    rotation: 0, opacity: 1, zIndex: spread.elements.reduce((highest, element) => Math.max(highest, element.zIndex), 0) + 1,
    locked: false };
  let frame: CanvasElement;
  if (change.kind === 'add-text') {
    const style = draft.paragraphStyles.find(style => style.id === change.paragraphStyleId);
    if (change.paragraphStyleId && !style) throw new Error('Choose an existing paragraph style.');
    const content = plainStory(change.text.replace(/\r\n?/g, '\n'), style?.id);
    if (change.fontSizePt) for (const paragraph of content.paragraphs) paragraph.formatting = { fontSizePt: change.fontSizePt };
    const body: TextElement = { ...geometry, type: 'text', text: change.text, storyContent: content, paragraphStyleId: style?.id,
      fontFamily: style?.fontFamily || 'Times', fontSizePt: change.fontSizePt || style?.fontSizePt || 11, lineHeight: style?.lineHeight || 1.35,
      letterSpacingPt: style?.letterSpacingPt || 0, color: style?.color || '#111111', alignment: style?.alignment || 'left',
      columns: 1, columnGutterMm: 4, paddingMm: 2, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
    frame = body;
  } else {
    frame = { ...geometry, type: 'shape', shapeKind: change.shape, fillColor: change.fill, strokeColor: change.stroke || 'transparent',
      strokeWidthMm: change.strokeWidthMm ?? (change.stroke ? 0.25 : 0), strokeDash: 'solid' };
  }
  spread.elements.push(frame);
  return frame.id;
}

async function applyEditorialChange(workspace: PublishingWorkspace, draft: ProjectState, change: Extract<DocumentChange,
  { kind: 'table-cell' | 'story-note' | 'publication-list' | 'relink-image' }>) {
  const { StateManager } = await import('../../src/state/stateManager');
  const manager = new StateManager();
  manager.loadFromJson(JSON.stringify(draft));
  if (change.kind === 'relink-image') {
    const target = manager.getElementById(change.frameId);
    if (target?.type !== 'image' || target.editorialOnly) throw new Error('Select an editable image frame.');
    const bytes = await workspace.read(change.source, ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'], limits.image);
    const { embeddedAsset } = await import('../../src/export/publicationAssets');
    const source = embeddedAsset('data:application/octet-stream;base64,' + bytes.toString('base64'));
    if (!manager.relinkAsset(change.frameId, source.dataUrl, {
      name: change.source.split('/').at(-1), fileSize: bytes.length, format: source.extension,
    })) throw new Error('Unlock the frame and its layer before relinking.');
  } else if (change.kind === 'table-cell') {
    const { tableThread } = await import('../../src/engine/tableCells');
    const current = manager.getState();
    const frame = manager.getElementById(change.frameId);
    if (frame?.type !== 'table') throw new Error('Select a table frame.');
    const head = tableThread(current.spreads, frame)[0];
    if (!head.cells[change.row - 1]?.[change.column - 1]) throw new Error('Choose an existing table cell.');
    manager.updateTableCell(head.id, change.row - 1, change.column - 1, change.text);
  } else if (change.kind === 'story-note') {
    const { assertEditable, resolveStory } = await import('./publication');
    assertEditable(manager.getState(), resolveStory(manager.getState(), change.frameId).frames);
    manager.insertFootnote(change.frameId, change.text, change.offset, change.noteType);
  } else {
    if (change.pageId && !manager.getState().spreads.some(spread => spread.pages.some(page => page.id === change.pageId))) {
      throw new Error('Choose an existing page or omit pageId to create a new page.');
    }
    manager.createPublicationList(change.listType, change.pageId);
  }
  return manager.getState();
}

export async function proposeDocumentChanges(workspace: PublishingWorkspace, source: ProjectState, changes: DocumentChange[]) {
  let draft = structuredClone(source);
  const createdFrameIds: string[] = [];
  for (const change of changes) {
    switch (change.kind) {
      case 'arrange': {
        const spread = draft.spreads[change.spread - 1];
        if (!spread || change.frameIds.some(frame => !spread.elements.some(element => element.id === frame))) {
          throw new Error('All arrangement targets must be on the specified spread.');
        }
        const selection = [draft.activeSpreadIndex, draft.selectedElementIds] as const;
        draft.activeSpreadIndex = change.spread - 1;
        draft.selectedElementIds = change.frameIds;
        if (!arrangeSelection(draft, change.operation, change.gapMm)) throw new Error('Choose more independent, editable objects for this arrangement.');
        [draft.activeSpreadIndex, draft.selectedElementIds] = selection;
        break;
      }
      case 'layer': {
        const layer = draft.layers.find(layer => layer.id === change.layerId);
        if (!layer) throw new Error('The selected layer does not exist.');
        const { kind, layerId, ...patch } = change;
        Object.assign(layer, patch);
        break;
      }
      case 'edition': {
        const condition = draft.conditions?.find(condition => condition.id === change.conditionId);
        if (!condition) throw new Error('The selected edition condition does not exist.');
        condition.visible = change.visible;
        break;
      }
      case 'parent': {
        const spread = draft.spreads[change.spread - 1];
        if (!spread || change.parentId && !draft.masterSpreads.some(parent => parent.id === change.parentId)) {
          throw new Error('Choose an existing spread and parent page.');
        }
        spread.masterSpreadId = change.parentId;
        break;
      }
      case 'metadata':
        draft.settings.title = change.title;
        break;
      case 'add-text':
      case 'add-shape':
        createdFrameIds.push(placeFrame(draft, change));
        break;
      case 'table-cell':
      case 'relink-image':
      case 'story-note':
      case 'publication-list':
        draft = await applyEditorialChange(workspace, draft, change);
        if (draft.spreads.reduce((pages, spread) => pages + spread.pages.length, 0) > limits.pages) {
          throw new Error('The edited publication would exceed 500 pages.');
        }
        break;
      case 'view': {
        const { kind, ...patch } = change;
        Object.assign(draft, patch);
        break;
      }
    }
  }
  if (JSON.stringify(source) === JSON.stringify(draft)) throw new Error('These settings leave the publication unchanged.');
  const validated = parseProject(JSON.stringify(draft), INITIAL_STATE);
  migrateLegacyNotes(validated);
  refreshPublication(validated);
  for (const head of storyHeads(validated)) if (head.storyContent) reflowStoryState(validated, head.id);
  return { draft: validated, createdFrameIds };
}
