import { Console } from 'node:console';
import { parseArgs } from 'node:util';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import pkg from '../../package.json';
import { publicationHeadings, publicationSnapshot } from '../../src/engine/publicationReferences';
import { plainStory, storyText } from '../../src/engine/storyContent';
import { limits, PublishingWorkspace, sha256 } from './workspace';
import { confirmProjectRevision, headlessLayoutNotice, loadProject, previewDraft, proposeStoryChange, resolveStory, withPublication } from './publication';
import { DraftPlans } from './plans';
import { publicationPlan, publicationRecipe } from '../publicationRecipe';
import { documentChange, proposeDocumentChanges } from './documentTools';
import { appearanceThemes, defaultAppearance, parseAppearance, pasteboardColors, serializeAppearance } from '../../src/appearance';

const file = z.string().min(1).max(1024);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const frameId = z.string().min(1).max(512);
const preset = z.enum(['screen', 'accessible', 'print', 'press', 'flattened', 'pdfx1a', 'pdfx4']);
const pagination = { offset: z.int().min(0).max(1_000_000).default(0), limit: z.int().min(1).max(50).default(30) };
const projectInput = { project: file.describe('Workspace-relative .recto or .json publication'), revision: revision.optional() };
const proofPage = z.int().min(1).max(500);
const proofBounds = z.strictObject({
  left: z.number().min(0).max(1), top: z.number().min(0).max(1),
  right: z.number().min(0).max(1), bottom: z.number().min(0).max(1),
}).refine(box => box.left < box.right && box.top < box.bottom, 'The region must have positive width and height.');
const proofSelection = z.strictObject({ page: proofPage, bounds: proofBounds });

function createPublishingServer(workspace: PublishingWorkspace) {
  const server = new McpServer({ name: 'recto-publishing', version: pkg.version }, {
    capabilities: { tools: {} },
  });
  const plans = new DraftPlans();
  async function reviewSource(args: { project?: string; revision?: string; planId?: string }) {
    if (Boolean(args.project) === Boolean(args.planId) || (args.planId && args.revision)) throw new Error('Choose a project with an optional revision, or a plan ID.');
    return args.planId ? plans.preview(workspace, args.planId) : loadProject(workspace, args.project!, args.revision);
  }
  async function editingBase(args: { project: string; revision: string; basePlanId?: string }) {
    const original = await loadProject(workspace, args.project, args.revision);
    if (!args.basePlanId) return { original, base: original, inputs: undefined };
    const base = await plans.preview(workspace, args.basePlanId);
    if (base.file !== original.file || base.revision !== original.revision) throw new Error('The preview belongs to a different source.');
    return { original, base, inputs: base.inputs };
  }
  let busy = false;
  function tool<T extends z.ZodType>(name: string, description: string, inputSchema: T,
    run: (args: z.infer<T>, images: NonNullable<CallToolResult['content']>) => Promise<Record<string, unknown>>, writes = false) {
    server.registerTool(name, { description, inputSchema: inputSchema as z.ZodType<unknown>,
      annotations: { readOnlyHint: !writes, destructiveHint: false, openWorldHint: false } }, async (args: unknown): Promise<CallToolResult> => {
      if (busy) return failure('The publishing server is processing another request. Retry after it finishes.');
      busy = true;
      try {
        const images: NonNullable<CallToolResult['content']> = [];
        const result = await run(args as z.infer<T>, images);
        return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }, ...images] };
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'The tool failed.');
      } finally { busy = false; }
    });
  }

  tool('recto_plan_publication', 'Compose a Markdown or DOCX manuscript to estimate pagination, signatures, and spine before exporting. This does not write files.', publicationPlan, async args => {
    const { planPublication } = await import('../compilePublication');
    return planPublication(workspace, args);
  });

  tool('recto_inspect_delivery_pdf', 'Inspect a local PDF’s page geometry, font embedding, output ICC profiles, and findings. This is a document inspection, not standards certification.', z.strictObject({
    pdf: file, ...pagination,
  }), async args => {
    const bytes = await workspace.read(args.pdf, ['.pdf'], limits.pdf);
    const { inspectDeliveryPdf } = await import('../../src/export/pdfDelivery');
    const { pages, findings, fonts, ...metadata } = await inspectDeliveryPdf(new File([bytes], args.pdf.split('/').at(-1)!));
    return { ...metadata, pageCount: pages.length, pages: pages.slice(args.offset, args.offset + args.limit),
      nextOffset: args.offset + args.limit < pages.length ? args.offset + args.limit : null,
      fonts: fonts.slice(0, 50), fontCount: fonts.length, findings: findings.slice(0, 50), findingCount: findings.length };
  });

  tool('recto_compare_pdf_proofs', 'Compare chosen physical pages in two workspace PDFs and return a PNG with changed pixels marked. Use page numbers after accounting for repagination.', z.strictObject({
    before: file, after: file, beforePage: z.int().min(1).max(500).default(1), afterPage: z.int().min(1).max(500).default(1),
  }), async (args, images) => {
    const { buildProof, visualDiff } = await import('./proof');
    const before = await workspace.read(args.before, ['.pdf'], limits.pdf);
    const oldProof = await buildProof(before, args.beforePage);
    const after = await workspace.read(args.after, ['.pdf'], limits.pdf);
    const newProof = await buildProof(after, args.afterPage);
    const diff = await visualDiff(oldProof, newProof);
    const preview = diff.comparable ? diff.bytes : newProof.bytes;
    const included = preview.length <= limits.proofImage;
    if (included) images.push({ type: 'image', mimeType: 'image/png', data: preview.toString('base64') });
    return { before: { sha256: sha256(before), page: args.beforePage, width: oldProof.width, height: oldProof.height },
      after: { sha256: sha256(after), page: args.afterPage, width: newProof.width, height: newProof.height },
      comparable: diff.comparable, changedPixels: diff.comparable ? diff.changedPixels : null,
      changedFraction: diff.comparable ? diff.changedPixels / (newProof.width * newProof.height) : null,
      preview: diff.comparable ? 'difference' : 'current', previewIncluded: included };
  });

  tool('recto_review_pdf_editions', 'Find exact unique page matches across two local PDFs, including moves. Unmatched pages are reported as uncertain when correspondence cannot be established.', z.strictObject({
    before: file, after: file, ...pagination,
  }), async args => {
    const { reviewPdfEditions } = await import('./editionReview');
    return reviewPdfEditions(workspace, args.before, args.after, args.offset, args.limit);
  });

  tool('recto_review_publication_change', 'Compare a pending draft with its saved source by stable page ID. Returns changed, moved, added and removed pages and an optional PNG for the first difference.', z.strictObject({
    planId: z.uuid(), offset: pagination.offset, limit: z.int().min(1).max(16).default(8), preview: z.boolean().default(true),
  }), async (args, images) => {
    const plan = await plans.preview(workspace, args.planId);
    const original = await loadProject(workspace, plan.file, plan.revision);
    const { reviewPublicationChange } = await import('./editionReview');
    const result = await reviewPublicationChange(original, plan, args.offset, args.limit, args.preview);
    if (result.image) images.push({ type: 'image', mimeType: 'image/png', data: result.image.toString('base64') });
    return { planId: args.planId, ...result.report };
  });

  tool('recto_locate_pdf_text', 'Locate selectable text in a saved PDF. Return physical page numbers, text fragment bounds, and a highlighted PNG. Scanned pages need a text layer.', z.strictObject({
    pdf: file, quote: z.string().trim().min(1).max(500), matchCase: z.boolean().default(false),
    startPage: z.int().min(1).max(500).default(1), pageLimit: z.int().min(1).max(30).default(12),
  }), async (args, images) => {
    const bytes = await workspace.read(args.pdf, ['.pdf'], limits.pdf);
    const { locatePdfProofText } = await import('./proof');
    const { preview, ...result } = await locatePdfProofText(bytes, args.quote, args.matchCase, args.startPage, args.pageLimit);
    if (preview && preview.length <= 3 * 1024 * 1024) images.push({ type: 'image', mimeType: 'image/png', data: preview.toString('base64') });
    return { ...result, sha256: sha256(bytes), coordinates: 'Page-relative fractions, measured from top left. Bounds cover matched text fragments.' };
  });

  tool('recto_render_pdf_region', 'Render a detailed PNG of part of a local PDF page. Reuse the normalized bounds from text location or supply your own region.', z.strictObject({
    pdf: file, ...proofSelection.shape, revision: revision.optional(),
    maxEdge: z.int().min(128).max(1800).default(1200),
  }), async (args, images) => {
    const bytes = await workspace.read(args.pdf, ['.pdf'], limits.pdf);
    const hash = sha256(bytes);
    if (args.revision && args.revision !== hash) throw new Error('The PDF changed. Locate the region in the current edition.');
    const { openProof } = await import('./proof');
    const renderer = await openProof(bytes);
    try {
      let edge = args.maxEdge;
      let preview = await renderer.region(args.page - 1, args.bounds, edge);
      while (preview.bytes.length > limits.proofImage && edge > 256) {
        edge = Math.max(256, Math.floor(edge * 0.7));
        preview = await renderer.region(args.page - 1, args.bounds, edge);
      }
      const included = preview.bytes.length <= limits.proofImage;
      if (included) images.push({ type: 'image', mimeType: 'image/png', data: preview.bytes.toString('base64') });
      return { sha256: hash, page: args.page, bounds: args.bounds, width: preview.width, height: preview.height,
        dpi: preview.dpi, previewIncluded: included };
    } finally { await renderer.destroy(); }
  });

  tool('recto_verify_pdf_proof_regions', 'Check approval-critical regions against a pinned PDF revision. Compare the same marks or copy across independently selected physical pages and return the first visual failure.', z.strictObject({
    approvedPdf: file, approvedRevision: revision, currentPdf: file, currentRevision: revision.optional(),
    checks: z.array(z.strictObject({
      name: z.string().trim().min(1).max(96), approved: proofSelection, current: proofSelection,
      maxChangedFraction: z.number().min(0).max(1).default(0),
    })).min(1).max(12),
    maxEdge: z.int().min(256).max(1200).default(800),
  }), async (args, images) => {
    const { verifyProofRegions } = await import('./proofChecks');
    const result = await verifyProofRegions(workspace, args);
    if (result.image) images.push({ type: 'image', mimeType: 'image/png', data: result.image.toString('base64') });
    return result.report;
  });

  tool('recto_compile_publication', 'Compile a Markdown or DOCX manuscript into an editable book, reader-order PDF, and PNG proof. Optionally budget offset signatures and compare a prior PDF.', publicationRecipe, async (args, images) => {
    workspace.assertWritable();
    const { compilePublication } = await import('../compilePublication');
    const { report, outputs, preview } = await compilePublication(workspace, args);
    if (preview.byteLength <= 3 * 1024 * 1024) images.push({ type: 'image', mimeType: 'image/png', data: preview.toString('base64') });
    return { report, outputs };
  }, true);

  tool('recto_inspect_publication', 'List spreads, pages, and headings. Use the returned revision to guard changes and exports.', z.strictObject({
    ...projectInput, ...pagination,
  }), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
    return withPublication(project, async source => {
      const state = publicationSnapshot(source);
      const spreads = state.spreads.slice(args.offset, args.offset + args.limit).map((spread, index) => ({
        number: args.offset + index + 1, id: spread.id, pages: spread.pages.map(page => ({ id: page.id, number: page.pageNumber })),
      }));
      const headings = publicationHeadings(state);
      return { revision: project.revision, title: state.settings.title, language: state.settings.language,
        trimMm: [state.settings.widthMm, state.settings.heightMm],
        pageCount: state.spreads.reduce((sum, spread) => sum + spread.pages.length, 0), totalSpreads: state.spreads.length,
        spreads, nextOffset: args.offset + args.limit < state.spreads.length ? args.offset + args.limit : null,
        layers: source.layers.slice(0, 50), layerCount: source.layers.length,
        parents: source.masterSpreads.slice(0, 50).map(parent => ({ id: parent.id, name: parent.name })),
        conditions: source.conditions?.slice(0, 50) || [],
        paragraphStyles: source.paragraphStyles.slice(0, 50).map(({ id, name }) => ({ id, name })),
        objectStyles: source.objectStyles?.slice(0, 50).map(({ id, name }) => ({ id, name })) ?? [],
        activeSpread: source.activeSpreadIndex + 1,
        headings: headings.slice(0, 30).map(heading => ({ ...heading, title: heading.title.slice(0, 200) })), headingCount: headings.length };
    });
  });

  tool('recto_render_preview_image', 'Return a PNG of a saved page or spread, or of a pending edit. Use it for visual review and compare it with the saved source.', z.strictObject({
    project: file.optional(), revision: revision.optional(), planId: z.uuid().optional(),
    page: z.int().min(1).max(limits.pages).optional(), spread: z.int().min(1).max(limits.pages).optional(),
    maxEdge: z.int().min(256).max(1800).default(1200),
  }), async (args, images) => {
    if (args.page !== undefined && args.spread !== undefined) throw new Error('Choose a physical page or a spread, or omit both for the active spread.');
    const project = await reviewSource(args);
    const { renderProof } = await import('./proof');
    const { bytes, ...proof } = await withPublication(project, source => renderProof(source,
      args.page === undefined ? { spread: args.spread ?? source.activeSpreadIndex + 1 } : { page: args.page }, args.maxEdge));
    images.push({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') });
    return { ...proof, revision: project.revision, planId: args.planId ?? null, metrics: headlessLayoutNotice };
  });

  tool('recto_view_shared_canvas', 'See the visible Recto desktop canvas that the user explicitly shared. Pass the PNG filename from the desktop review dialog.', z.strictObject({ canvas: file }), async (args, images) => {
    if (!/^recto-canvas-[a-zA-Z0-9]{20}\.png$/.test(args.canvas.split('/').at(-1) || '')) throw new Error('Use the canvas filename from the desktop review dialog.');
    const png = await workspace.read(args.canvas, ['.png'], 3 * 1024 * 1024);
    if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('This canvas snapshot is not a PNG. Share a fresh canvas from the editor.');
    }
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 1200 || height > 1200) throw new Error('The snapshot dimensions exceed the shared canvas limit.');
    images.push({ type: 'image', mimeType: 'image/png', data: png.toString('base64') });
    return { canvas: args.canvas, width, height, view: 'editor-canvas-snapshot' };
  });

  tool('recto_read_spread', 'Inspect frames on a physical page or spread. Positions are in millimetres. Includes short manuscript excerpts and story IDs.', z.strictObject({
    project: file.optional(), revision: revision.optional(), planId: z.uuid().optional(), ...pagination,
    page: z.int().min(1).max(limits.pages).optional(), spread: z.int().min(1).max(limits.pages).optional(),
  }).refine(args => (args.page === undefined) !== (args.spread === undefined), 'Choose exactly one physical page or spread number.'), async args => {
    const project = await reviewSource(args);
    return withPublication(project, async source => {
      const state = publicationSnapshot(source);
      const spread = args.spread !== undefined ? state.spreads[args.spread - 1]
        : state.spreads.find(item => item.pages.some(page => page.pageNumber === args.page));
      if (!spread) throw new Error('The requested page or spread is missing.');
      const page = spread.pages.find(item => item.pageNumber === args.page);
      const elements = spread.elements.filter(item => !item.pasteboard && (!page || item.pageId === page.id));
      return { revision: project.revision, spread: state.spreads.indexOf(spread) + 1,
        pages: spread.pages.map(item => ({ id: item.id, number: item.pageNumber })),
        totalFrames: elements.length, nextOffset: args.offset + args.limit < elements.length ? args.offset + args.limit : null,
        frames: elements.slice(args.offset, args.offset + args.limit).map(item => ({
          id: item.id, type: item.type, pageId: item.pageId, layerId: item.layerId, locked: item.locked,
          positionMm: { x: item.x, y: item.y, width: item.width, height: item.height },
          ...(item.type === 'text' ? { storyId: resolveStory(state, item.id).head.id, text: item.text.slice(0, 300),
            font: item.fontFamily, fontSizePt: item.fontSizePt, generated: Boolean(item.generated) } : {}),
          ...(item.type === 'image' ? { name: item.name, embedded: item.src.startsWith('data:'), altText: item.altText?.slice(0, 300) } : {}),
        })), metrics: headlessLayoutNotice };
    });
  });

  tool('recto_read_story', 'Read a bounded range of the source story and identify protected manuscript markers. Offsets are UTF-16.', z.strictObject({
    project: file.optional(), revision: revision.optional(), planId: z.uuid().optional(),
    frameId, start: z.int().min(0).default(0), length: z.int().min(1).max(8000).default(3000),
  }), async args => {
    const project = await reviewSource(args);
    const { head, frames } = resolveStory(project.source, args.frameId);
    const content = head.storyContent || plainStory(head.rawStoryText ?? frames.map(frame => frame.text).join('\n\n'), head.paragraphStyleId);
    const text = storyText(content);
    if (args.start > text.length) throw new Error('The requested offset is beyond the story.');
    const splitPair = (offset: number) => /[\uD800-\uDBFF]/.test(text[offset - 1] || '') && /[\uDC00-\uDFFF]/.test(text[offset] || '');
    if (splitPair(args.start)) throw new Error('Choose an offset at a whole Unicode character.');
    let end = Math.min(text.length, args.start + args.length);
    if (splitPair(end)) end++;
    let offset = 0;
    const markers: { start: number; end: number; kind: string }[] = [];
    for (const paragraph of content.paragraphs) {
      for (const run of paragraph.runs) {
        const limit = offset + run.text.length;
        if (limit > args.start && offset < end && (run.noteId || run.reference || run.indexId)) {
          markers.push({ start: offset, end: limit, kind: run.noteId ? 'note' : run.reference ? 'reference' : 'index' });
        }
        offset = limit;
      }
      offset++;
    }
    return { revision: project.revision, storyId: head.id, frameIds: frames.map(frame => frame.id),
      start: args.start, end, totalLength: text.length, nextStart: end < text.length ? end : null,
      text: text.slice(args.start, end), markers: markers.slice(0, 100), markerCount: markers.length };
  });

  tool('recto_run_preflight', 'Report headless preflight, including overset and requirements for the PDF preset. Export performs additional checks.', z.strictObject({
    ...projectInput, ...pagination, preset: preset.default('press'),
  }), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
    const { preflightReport } = await import('./render');
    return withPublication(project, async source => ({ revision: project.revision, ...preflightReport(source, args.preset, args.offset, args.limit),
      metrics: headlessLayoutNotice }));
  });

  tool('recto_preview_story_edit', 'Preview a protected text replacement or a small story-wide tracking adjustment. Review the layout and preflight before saving a copy.', z.strictObject({
    ...projectInput, revision, frameId, basePlanId: z.uuid().optional(),
    change: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('replace'), start: z.int().min(0), end: z.int().min(0),
        expectedText: z.string().max(24_000), text: z.string().max(24_000) }),
      z.strictObject({ kind: z.literal('tracking'), deltaPerThousandEm: z.int().min(-30).max(30).refine(value => value !== 0) }),
    ]),
  }), async args => {
    const { original, base, inputs } = await editingBase(args);
    return withPublication(base, async source => {
      const draft = await proposeStoryChange(source, args.frameId, args.change);
      const preview = previewDraft(original.source, draft);
      return { ...plans.stage(original, draft, inputs), ...preview };
    });
  });

  tool('recto_preview_translation', 'Review a Recto XLIFF 2.0 exchange and preview ready translations. A conflicting, unreviewed, or locked unit blocks the selection.', z.strictObject({
    ...projectInput, revision, exchange: file, unitIds: z.array(z.string().max(4098)).min(1).max(2000).optional(),
  }), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
    const xml = await workspace.read(args.exchange, ['.xlf', '.xliff'], limits.exchange);
    const { proposeTranslation } = await import('./translation');
    return withPublication(project, async source => {
      const { summary, translated } = proposeTranslation(source, xml.toString('utf8'), args.unitIds);
      if (!translated) return { ...summary, planId: null, sourceRevision: project.revision };
      const preview = previewDraft(source, translated.draft);
      return { ...summary, ...plans.stage(project, translated.draft, [{ file: args.exchange, revision: sha256(xml) }]),
        ...preview, fontFindings: translated.fonts.slice(0, 30), fontFindingCount: translated.fonts.length };
    });
  });

  tool('recto_preview_layout_edit', 'Preview frame placement, geometry, styles, image and vector effects, tables, alignment, layers, editions, parents, notes, or generated lists. Table rows and columns are one-based.', z.strictObject({
    ...projectInput, revision, basePlanId: z.uuid().optional(), changes: z.array(documentChange).min(1).max(25),
  }), async args => {
    const { original, base, inputs } = await editingBase(args);
    return withPublication(base, async source => {
      const { draft, createdFrameIds } = await proposeDocumentChanges(workspace, source, args.changes);
      const preview = previewDraft(original.source, draft);
      return { ...plans.stage(original, draft, inputs), createdFrameIds, operations: args.changes.map(change => change.kind), ...preview };
    });
  });

  tool('recto_appearance', 'Inspect the default appearance, available choices, or a saved .rectoappearance profile. Live editor preferences stay in the editor.', z.strictObject({
    profile: file.optional(),
  }), async args => ({
    appearance: args.profile ? parseAppearance((await workspace.read(args.profile, ['.rectoappearance'], 8192)).toString('utf8')) : defaultAppearance,
    choices: { themes: appearanceThemes.map(theme => theme.value), accents: ['blue', 'jade', 'violet', 'amber', 'custom'],
      buttonStyles: ['classic', 'minimal', 'glass'], pasteboard: Object.keys(pasteboardColors) },
  }));

  tool('recto_inspect_book', 'Review chapters, assembled page numbers, inserted blanks, and cover dimensions from a portable .rectobook archive.', z.strictObject({
    book: file, revision: revision.optional(),
  }), async args => {
    const { loadBook } = await import('./book');
    const book = await loadBook(workspace, args.book, args.revision);
    return { ...book.report, revision: book.revision };
  });

  tool('recto_check_idml_handoff', 'Review unsupported artwork, grouping, transforms, and image links before IDML export.', z.strictObject({
    ...projectInput, ...pagination,
  }), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
    const { idmlHandoffFindings } = await import('../../src/export/idmlHandoff');
    const findings = idmlHandoffFindings(project.source), end = args.offset + args.limit;
    return { revision: project.revision, total: findings.length, findings: findings.slice(args.offset, end),
      nextOffset: end < findings.length ? end : null };
  });

  const bookReviewInput = { book: file, revision: revision.optional(), chapterId: frameId.optional(), planId: z.uuid().optional() };
  tool('recto_compare_book_proof', 'Compare the book or a proposed chapter edit with its approved PDF. Flags moved pages, new findings, and cover changes.', z.strictObject({
    ...bookReviewInput, ...pagination,
  }).refine(args => Boolean(args.chapterId) === Boolean(args.planId), 'Pass both chapterId and planId to review a chapter draft.'), async args => {
    const { reviewBook } = await import('./bookProof');
    const { rows, newFindings, resolvedFindings, ...report } = await reviewBook(workspace, plans, args);
    const end = args.offset + args.limit;
    return { ...report, rows: rows.slice(args.offset, end), newFindings: newFindings.slice(args.offset, end),
      resolvedFindings: resolvedFindings.slice(args.offset, end), newFindingCount: newFindings.length,
      resolvedFindingCount: resolvedFindings.length,
      nextOffset: end < Math.max(rows.length, newFindings.length, resolvedFindings.length) ? end : null };
  });

  tool('recto_render_book_proof_page', 'Return a PNG from the approved PDF or the current book, including an optional proposed chapter edit.', z.strictObject({
    ...bookReviewInput, edition: z.enum(['approved', 'current']), page: z.int().min(1).max(limits.pages),
    maxEdge: z.int().min(256).max(1800).default(1200),
  }).refine(args => Boolean(args.chapterId) === Boolean(args.planId) && !(args.edition === 'approved' && args.planId),
    'Pass a chapter ID and plan ID together for the current edition.'), async (args, images) => {
    const { renderBookProofPage } = await import('./bookProof');
    const { bytes, ...result } = await renderBookProofPage(workspace, plans, args);
    images.push({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') });
    return result;
  });

  tool('recto_available_features', 'Report available and editor-only capabilities for this connection.', z.strictObject({}), async () => ({
    mode: workspace.writable ? 'drafts-and-exports' : 'read-only',
    covered: ['project creation', 'spread and story inspection', 'story replacement and tracking', 'text and shape placement', 'alignment and distribution', 'layer and edition visibility',
      'parent assignment', 'saved view and document title', 'image relinking', 'table cell edits', 'footnotes and endnotes', 'generated publication lists',
      'appearance profiles', 'XLIFF review', 'preflight', 'PDF and EPUB export', 'IDML import and export', 'Scribus import', 'batch publishing',
      'book archive inspection, approved proof comparison, interior PDF and delivery ZIP', 'visual proof images', 'shared desktop canvas snapshots',
      'desktop edit proposals', 'frame geometry and style application', 'image levels and curves', 'vector decorations',
      'table merging, row splitting and continuation pages', 'manuscript layout planning and compilation',
      'delivery PDF inspection', 'PDF proof comparison and text location', 'PDF region previews and approval checks', 'PDF edition page matching', 'staged draft visual review'],
    editorOnly: ['live canvas gestures', 'continuous screen sharing', 'live collaboration', 'native dialogs and updater',
      'freehand drawing', 'advanced style authoring'],
  }));

  if (workspace.writable) {
    tool('recto_export_book_package', 'Export an approved book delivery recipe to a ZIP with interior PDF, cover PDF, EPUB, and report. Requires the current book revision and a cover approved in Recto.', z.strictObject({
      book: file, revision, output: file,
    }), async args => {
      await workspace.checkOutput(args.output, '.zip');
      const { loadBook, confirmBookRevision } = await import('./book');
      const book = await loadBook(workspace, args.book, args.revision);
      if (!book.delivery) throw new Error('Set and approve a delivery recipe in Recto, then save the book archive.');
      const { buildBookDelivery } = await import('../../src/engine/bookDelivery');
      const archive = await buildBookDelivery(book.source, book.delivery, true);
      if (archive.byteLength > limits.batch) throw new Error('The delivery ZIP exceeds 128 MiB.');
      await confirmBookRevision(workspace, args.book, args.revision);
      return { ...await workspace.write(args.output, '.zip', archive), sourceRevision: book.revision, pages: book.report.pageCount };
    }, true);

    tool('recto_offer_desktop_proposal', 'Send a staged draft to the open desktop review dialog using its one-time workspace-relative filename. The editor user can review and apply it.', z.strictObject({
      planId: z.uuid(), output: file,
    }), async args => plans.offer(workspace, args.planId, args.output), true);

    tool('recto_compile_book', 'Assemble and export the interior of a portable .rectobook archive as a strict PDF. Review the book revision and cover requirements first.', z.strictObject({
      book: file, revision, output: file, preset: preset.default('press'),
    }), async args => {
      await workspace.checkOutput(args.output, '.pdf');
      const { loadBook, confirmBookRevision } = await import('./book');
      const book = await loadBook(workspace, args.book, args.revision);
      const { compilePdf } = await import('./render');
      const { bytes, ...report } = await withPublication(book, source => compilePdf(source, args.preset));
      await confirmBookRevision(workspace, args.book, args.revision);
      return { ...report, sourceRevision: book.revision, ...await workspace.write(args.output, '.pdf', bytes) };
    }, true);

    tool('recto_save_appearance', 'Create a portable profile to load in Appearance. Supports every theme, button style, accent, density and pasteboard setting.', z.strictObject({
      output: file, baseProfile: file.optional(),
      appearance: z.strictObject({
        theme: z.enum(['dark', 'light', 'midnight', 'oled', 'system']).optional(),
        accent: z.enum(['blue', 'jade', 'violet', 'amber', 'custom']).optional(),
        customAccent: z.string().regex(/^#[a-f0-9]{6}$/i).optional(),
        compact: z.boolean().optional(),
        pasteboard: z.enum(['charcoal', 'gray', 'light']).optional(),
        buttonStyle: z.enum(['classic', 'minimal', 'glass']).optional(),
      }),
    }), async args => {
      const base = args.baseProfile ? parseAppearance((await workspace.read(args.baseProfile, ['.rectoappearance'], 8192)).toString('utf8')) : defaultAppearance;
      const appearance = { ...base, ...args.appearance };
      return { appearance, ...await workspace.write(args.output, '.rectoappearance', Buffer.from(serializeAppearance(appearance))) };
    }, true);

    tool('recto_save_draft', 'Save a reviewed preview to a new .recto file. Rejects stale previews and existing destinations.', z.strictObject({
      planId: z.uuid(), output: file,
    }), async args => plans.save(workspace, args.planId, args.output), true);

    tool('recto_create_publication', 'Start a blank editable publication with the same page presets as the editor. Saves to a new .recto file.', z.strictObject({
      output: file, title: z.string().trim().min(1).max(300),
      pagePreset: z.enum(['A4', 'US-Letter', 'Book-Trade-6x9', 'Digest-5.5x8.5', 'Zine-A5']).default('A4'),
      facingPages: z.boolean().default(true),
    }), async args => {
      await workspace.checkOutput(args.output, '.recto');
      const { StateManager } = await import('../../src/state/stateManager');
      const manager = new StateManager();
      manager.createBlankProject(args.pagePreset, args.title, args.facingPages);
      const state = manager.getState();
      return { title: args.title, pagePreset: args.pagePreset, pageId: state.spreads[0].pages[0].id,
        ...await workspace.write(args.output, '.recto', Buffer.from(manager.exportJson())) };
    }, true);

    tool('recto_import_publication', 'Convert an IDML package or Scribus document to a new editable Recto project. Review unsupported features and missing assets after conversion.', z.strictObject({
      input: file, output: file,
    }), async args => {
      await workspace.checkOutput(args.output, '.recto');
      const input = await workspace.read(args.input, ['.idml', '.sla', '.gz'], limits.project);
      let bytes: Buffer;
      let warnings: string[];
      if (args.input.toLowerCase().endsWith('.idml')) {
        const { parseIdmlPackage } = await import('../../src/idmlImport');
        bytes = Buffer.from(JSON.stringify(await parseIdmlPackage(input, args.input.split('/').at(-1))));
        warnings = ['Review imported text, links and unsupported layout features in Recto.'];
      } else {
        const { importScribusFile } = await import('../../src/import/scribusImport');
        const { project, warnings: notes } = await importScribusFile(new File([Uint8Array.from(input)], args.input.split('/').at(-1)!));
        bytes = Buffer.from(JSON.stringify(project));
        warnings = notes;
      }
      const { validatePublishingProject } = await import('./publication');
      const state = validatePublishingProject(bytes);
      return { title: state.settings.title, warnings: warnings.slice(0, 50),
        ...await workspace.write(args.output, '.recto', Buffer.from(JSON.stringify(state))) };
    }, true);

    tool('recto_compile_pdf', 'Export a new PDF with strict checks. PDF/X output is a candidate for independent validation.', z.strictObject({
      ...projectInput, revision, output: file, preset: preset.default('press'),
    }), async args => {
      await workspace.checkOutput(args.output, '.pdf');
      const project = await loadProject(workspace, args.project, args.revision);
      const { compilePdf } = await import('./render');
      const { bytes, ...report } = await withPublication(project, source => compilePdf(source, args.preset));
      await confirmProjectRevision(workspace, args.project, args.revision);
      return { ...report, sourceRevision: project.revision, ...await workspace.write(args.output, '.pdf', bytes) };
    }, true);

    tool('recto_render_batch', 'Render one strict PDF per CSV or JSON record. Photo columns may reference workspace-relative raster files. Writes a new directory and a manifest.', z.strictObject({
      ...projectInput, revision, dataset: file, output: file, preset: preset.default('press'),
      photoFields: z.array(z.string().min(1).max(100)).max(8).default([]),
    }), async args => {
      const project = await loadProject(workspace, args.project, args.revision);
      const { renderDataset } = await import('./render');
      return withPublication(project, async () => ({ sourceRevision: project.revision,
        ...await renderDataset(workspace, project, args.dataset, args.output, args.preset, [...new Set(args.photoFields)]) }));
    }, true);

    tool('recto_export_publication', 'Export reflowable EPUB, fixed-layout EPUB, supported IDML, or a Recto XLIFF handoff to a new file.', z.strictObject({
      ...projectInput, revision, output: file,
      format: z.enum(['epub', 'fixed-epub', 'idml', 'xliff']), targetLanguage: z.string().min(1).max(64).optional(),
    }), async args => {
      const extension = args.format === 'idml' ? '.idml' : args.format === 'xliff' ? '.xlf' : '.epub';
      await workspace.checkOutput(args.output, extension);
      const project = await loadProject(workspace, args.project, args.revision);
      const { compilePublication } = await import('./render');
      const { bytes, warnings } = await withPublication(project, source => compilePublication(source, args.format, args.targetLanguage));
      await confirmProjectRevision(workspace, args.project, args.revision);
      return { format: args.format, sourceRevision: project.revision, warnings, ...await workspace.write(args.output, extension, bytes) };
    }, true);
  }
  return server;
}

function failure(message: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: message.slice(0, 2000) }] };
}

export async function runPublishingServer(args: string[]) {
  const { values } = parseArgs({ args, options: { workspace: { type: 'string' }, 'allow-write': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log('recto mcp --workspace <folder> [--allow-write]'); return; }
  if (!values.workspace) throw new Error('Provide --workspace with a folder containing the publications to expose.');
  const workspace = await PublishingWorkspace.open(values.workspace, Boolean(values['allow-write']));
  // Stdio stdout carries only MCP messages, even if a publishing dependency logs.
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  serveStdio(() => createPublishingServer(workspace), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 1024 * 1024 }),
    onerror: error => console.error(error.message),
  });
}
