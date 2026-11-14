import { randomUUID } from 'node:crypto';
import type { BaseElement, CanvasElement, ProjectState, TableElement, TextElement } from '../../src/types';
import { arrangeSelection, lockedArtworkIds } from '../../src/engine/selectionGeometry';
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
const geometryPatch = { xMm: mm.optional(), yMm: mm.optional(), widthMm: dimension.optional(), heightMm: dimension.optional(),
  rotation: z.number().min(-360).max(360).optional(), opacity: z.number().min(0).max(1).optional() };
const byte = z.int().min(0).max(255);
const tone = z.strictObject({ grayscale: z.boolean().optional(), black: byte, white: byte, gamma: z.number().min(0.1).max(10),
  curve: z.array(z.strictObject({ input: byte.min(1).max(254), output: byte })).max(12).default([]),
}).refine(value => value.white > value.black && value.curve.every((point, index, curve) => !index || point.input > curve[index - 1].input),
  'White must exceed black and curve inputs must be strictly increasing.');
const decoration = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hatch'), color, angle: z.number().min(-360).max(360), spacing: mm.min(0.5).max(100),
    weight: mm.min(0.05).max(10), crossed: z.boolean() }),
  z.strictObject({ kind: z.literal('mesh'), columns: z.int().min(2).max(8), rows: z.int().min(2).max(8), colors: z.array(color).min(4).max(64) }),
]).refine(value => value.kind !== 'mesh' || value.colors.length === value.rows * value.columns, 'Supply one color per mesh node.');
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
  z.strictObject({ kind: z.literal('add-image'), ...placement, source: z.string().min(1).max(1024),
    altText: z.string().trim().max(500).optional(), fit: z.enum(['fit', 'fill', 'center', 'stretch']).default('fit') }),
  z.strictObject({ kind: z.literal('add-table'), ...placement, rows: z.array(z.array(z.string().max(2000)).min(1).max(20)).min(1).max(80),
    header: z.boolean().default(true) }).refine(value => value.rows.every(row => row.length === value.rows[0].length), 'Table rows need the same column count.'),
  z.strictObject({ kind: z.literal('update-frame'), frameId: id, ...geometryPatch }),
  z.strictObject({ kind: z.literal('object-style'), frameId: id, styleId: id }),
  z.strictObject({ kind: z.literal('paragraph-style'), frameId: id, styleId: id,
    start: z.int().min(0).optional(), end: z.int().min(0).optional() }),
  z.strictObject({ kind: z.literal('image-adjustments'), frameId: id, adjustments: tone.nullable() }),
  z.strictObject({ kind: z.literal('vector-decoration'), frameId: id, decoration: decoration.nullable().optional(),
    pattern: z.strictObject({ dash: mm.min(0.1).max(100), gap: mm.min(0.1).max(100) }).nullable().optional() }),
  z.strictObject({ kind: z.literal('relink-image'), frameId: id, source: z.string().min(1).max(1024) }),
  z.strictObject({ kind: z.literal('table-cell'), frameId: id, row: z.int().min(1).max(2000),
    column: z.int().min(1).max(200), text: z.string().max(24_000) }),
  z.strictObject({ kind: z.literal('table-merge'), frameId: id, row: z.int().min(1).max(2000),
    column: z.int().min(1).max(200), operation: z.enum(['right', 'down', 'unmerge']) }),
  z.strictObject({ kind: z.literal('table-flow'), frameId: id, rowSizing: z.enum(['equal', 'content']).optional(),
    allowRowSplit: z.boolean().optional(), continueOnNewPage: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal('story-note'), frameId: id, offset: z.int().min(0),
    noteType: z.enum(['footnote', 'endnote']), text: z.string().trim().min(1).max(8000) }),
  z.strictObject({ kind: z.literal('publication-list'), pageId: id.optional(),
    listType: z.enum(['toc', 'index', 'endnotes', 'authorities', 'figures', 'tables']) }),
  z.strictObject({ kind: z.literal('view'), showGuides: z.boolean().optional(), showBleed: z.boolean().optional(),
    showBaselineGrid: z.boolean().optional(), snapToGuides: z.boolean().optional(), showReadingOrder: z.boolean().optional(),
    showSlugBanner: z.boolean().optional(), displayQuality: z.enum(['fast', 'typical', 'high']).optional() }),
]);

type DocumentChange = z.infer<typeof documentChange>;

async function placedAsset(workspace: PublishingWorkspace, file: string) {
  const bytes = await workspace.read(file, ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'], limits.image);
  const { embeddedAsset } = await import('../../src/export/publicationAssets');
  const asset = embeddedAsset('data:application/octet-stream;base64,' + bytes.toString('base64'));
  return { src: asset.dataUrl, name: file.split('/').at(-1), fileSize: bytes.length, format: asset.extension };
}

async function placeFrame(workspace: PublishingWorkspace, draft: ProjectState,
  change: Extract<DocumentChange, { kind: 'add-text' | 'add-shape' | 'add-image' | 'add-table' }>) {
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
  } else if (change.kind === 'add-shape') {
    frame = { ...geometry, type: 'shape', shapeKind: change.shape, fillColor: change.fill, strokeColor: change.stroke || 'transparent',
      strokeWidthMm: change.strokeWidthMm ?? (change.stroke ? 0.25 : 0), strokeDash: 'solid' };
  } else if (change.kind === 'add-image') {
    frame = { ...geometry, ...await placedAsset(workspace, change.source), type: 'image', fitMode: change.fit,
      altText: change.altText, borderColor: 'transparent', borderWidthMm: 0 };
  } else {
    const table: TableElement = { ...geometry, type: 'table', rows: change.rows.length, cols: change.rows[0].length,
      cells: change.rows.map(row => row.map(text => ({ text }))), headerRowCount: change.header ? 1 : 0,
      headerFillColor: '#111111', headerTextColor: '#FFFFFF', borderColor: '#BABABA', borderWidthMm: 0.2,
      cellPaddingMm: 1, fontFamily: 'Helvetica', fontSizePt: 10 };
    frame = table;
  }
  spread.elements.push(frame);
  return frame.id;
}

function editFrame(draft: ProjectState, id: string) {
  const index = draft.spreads.findIndex(spread => spread.elements.some(frame => frame.id === id));
  if (index < 0) throw new Error('Choose an existing publication frame.');
  if (lockedArtworkIds({ ...draft, activeSpreadIndex: index }).has(id)) throw new Error('Unlock the frame, its group and its layer first.');
  return { index, frame: draft.spreads[index].elements.find(frame => frame.id === id)! };
}

async function applyEditorialChange(workspace: PublishingWorkspace, draft: ProjectState, change: Extract<DocumentChange,
  { kind: 'table-cell' | 'table-merge' | 'table-flow' | 'story-note' | 'publication-list' | 'relink-image' | 'object-style' | 'paragraph-style' }>) {
  const { StateManager } = await import('../../src/state/stateManager');
  const manager = new StateManager();
  manager.loadFromJson(JSON.stringify(draft));
  if (change.kind === 'relink-image') {
    const { frame } = editFrame(manager.getState(), change.frameId);
    if (frame.type !== 'image') throw new Error('Select an editable image frame.');
    const { src, ...metadata } = await placedAsset(workspace, change.source);
    if (!manager.relinkAsset(change.frameId, src, metadata)) throw new Error('Unlock the frame and its layer before relinking.');
  } else if (change.kind === 'object-style' || change.kind === 'paragraph-style') {
    const current = manager.getState();
    const { index, frame } = editFrame(current, change.frameId);
    if (change.kind === 'object-style') {
      if (!current.objectStyles?.some(style => style.id === change.styleId)) throw new Error('Choose an existing object style.');
      const active = current.activeSpreadIndex, selection = current.selectedElementIds, selected = current.selectedElementId;
      manager.setActiveSpread(index);
      manager.applyObjectStyle(frame.id, change.styleId);
      Object.assign(current, { activeSpreadIndex: active, selectedElementIds: selection, selectedElementId: selected });
    } else {
      if (frame.type !== 'text' || !current.paragraphStyles.some(style => style.id === change.styleId)) throw new Error('Choose a text frame and an existing paragraph style.');
      const { resolveStory } = await import('./publication');
      const head = resolveStory(current, frame.id).head;
      const { contentOf } = await import('../../src/engine/publicationReferences');
      const { storyText } = await import('../../src/engine/storyContent');
      const length = storyText(contentOf(head)).length;
      const start = change.start ?? 0, end = change.end ?? length;
      if (start > end || end > length) throw new Error('Choose a valid UTF-16 story range.');
      manager.styleStoryRange(frame.id, start, end, change.styleId);
    }
  } else if (change.kind === 'table-cell' || change.kind === 'table-merge' || change.kind === 'table-flow') {
    const { tableThread, mergeTableCellRight, mergeTableCellDown, unmergeTableCell } = await import('../../src/engine/tableCells');
    const current = manager.getState();
    const { frame } = editFrame(current, change.frameId);
    if (frame.type !== 'table') throw new Error('Select a table frame.');
    const head = tableThread(current.spreads, frame)[0];
    if (change.kind === 'table-flow') {
      if (change.allowRowSplit === false) manager.updateTableSource(head.id, { allowRowSplit: false });
      if (change.rowSizing) manager.setTableRowSizing(head.id, change.rowSizing);
      if (change.allowRowSplit) {
        if (change.rowSizing === 'equal') throw new Error('Choose content-sized rows before enabling row splitting.');
        manager.updateTableSource(head.id, { allowRowSplit: true, rowSizing: 'content' });
      }
      if (change.continueOnNewPage) {
        const view = { activeSpreadIndex: current.activeSpreadIndex, selectedElementIds: current.selectedElementIds, selectedElementId: current.selectedElementId };
        manager.addTableContinuationPage(head.id);
        Object.assign(manager.getState(), view);
      }
    } else {
      const row = change.row - 1, col = change.column - 1;
      if (!head.cells[row]?.[col]) throw new Error('Choose an existing table cell.');
      if (change.kind === 'table-cell') manager.updateTableCell(head.id, row, col, change.text);
      else {
        const merge = { right: mergeTableCellRight, down: mergeTableCellDown, unmerge: unmergeTableCell }[change.operation];
        manager.updateTableSource(head.id, { cells: merge(head.cells, row, col), rowSizing: change.operation === 'down' ? 'content' : head.rowSizing });
      }
    }
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
      case 'add-image':
      case 'add-table':
        createdFrameIds.push(await placeFrame(workspace, draft, change));
        break;
      case 'update-frame': {
        const { frame } = editFrame(draft, change.frameId);
        if (frame.groupId && [change.xMm, change.yMm, change.widthMm, change.heightMm, change.rotation].some(value => value !== undefined)) {
          throw new Error('Use Arrange for grouped objects.');
        }
        frame.x = change.xMm ?? frame.x; frame.y = change.yMm ?? frame.y;
        frame.width = change.widthMm ?? frame.width; frame.height = change.heightMm ?? frame.height;
        frame.rotation = change.rotation ?? frame.rotation; frame.opacity = change.opacity ?? frame.opacity;
        break;
      }
      case 'image-adjustments': {
        const { frame } = editFrame(draft, change.frameId);
        if (frame.type !== 'image' || frame.equation || /svg/i.test(frame.format || frame.src.slice(0, 40))) throw new Error('Choose a raster image.');
        if (change.adjustments) frame.adjustments = change.adjustments;
        else delete frame.adjustments;
        break;
      }
      case 'vector-decoration': {
        const { frame } = editFrame(draft, change.frameId);
        if (frame.type !== 'shape' && frame.type !== 'path') throw new Error('Choose a vector shape or path.');
        if (change.decoration !== undefined) frame.decoration = change.decoration ?? undefined;
        if (change.pattern !== undefined) frame.strokePattern = change.pattern ?? undefined;
        break;
      }
      case 'object-style':
      case 'paragraph-style':
      case 'table-cell':
      case 'table-merge':
      case 'table-flow':
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
