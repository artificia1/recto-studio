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
import { documentChange, proposeDocumentChanges } from './documentTools';
import { appearanceThemes, defaultAppearance, parseAppearance, pasteboardColors, serializeAppearance } from '../../src/appearance';

const file = z.string().min(1).max(1024);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const frameId = z.string().min(1).max(512);
const preset = z.enum(['screen', 'accessible', 'print', 'press', 'flattened', 'pdfx1a', 'pdfx4']);
const pagination = { offset: z.int().min(0).max(1_000_000).default(0), limit: z.int().min(1).max(50).default(30) };
const projectInput = { project: file.describe('Workspace-relative .recto or .json publication'), revision: revision.optional() };

function createPublishingServer(workspace: PublishingWorkspace) {
  const server = new McpServer({ name: 'recto-publishing', version: pkg.version }, {
    capabilities: { tools: {} },
  });
  const plans = new DraftPlans();
  let busy = false;
  function tool<T extends z.ZodType>(name: string, description: string, inputSchema: T,
    run: (args: z.infer<T>) => Promise<Record<string, unknown>>, writes = false) {
    server.registerTool(name, { description, inputSchema: inputSchema as z.ZodType<unknown>,
      annotations: { readOnlyHint: !writes, destructiveHint: false, openWorldHint: false } }, async (args: unknown): Promise<CallToolResult> => {
      if (busy) return failure('The publishing server is processing another request. Retry after it finishes.');
      busy = true;
      try {
        const result = await run(args as z.infer<T>);
        return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'The tool failed.');
      } finally { busy = false; }
    });
  }

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
        headings: headings.slice(0, 30).map(heading => ({ ...heading, title: heading.title.slice(0, 200) })), headingCount: headings.length };
    });
  });

  tool('recto_read_spread', 'Inspect frames on a physical page or spread. Positions are in millimetres. Includes short manuscript excerpts and story IDs.', z.strictObject({
    ...projectInput, ...pagination,
    page: z.int().min(1).max(limits.pages).optional(), spread: z.int().min(1).max(limits.pages).optional(),
  }).refine(args => (args.page === undefined) !== (args.spread === undefined), 'Choose exactly one physical page or spread number.'), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
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
    ...projectInput, frameId, start: z.int().min(0).default(0), length: z.int().min(1).max(8000).default(3000),
  }), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
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
    ...projectInput, revision, frameId,
    change: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('replace'), start: z.int().min(0), end: z.int().min(0),
        expectedText: z.string().max(24_000), text: z.string().max(24_000) }),
      z.strictObject({ kind: z.literal('tracking'), deltaPerThousandEm: z.int().min(-30).max(30).refine(value => value !== 0) }),
    ]),
  }), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
    return withPublication(project, async source => {
      const draft = await proposeStoryChange(source, args.frameId, args.change);
      const preview = previewDraft(source, draft);
      return { ...plans.stage(project, draft), ...preview };
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

  tool('recto_preview_layout_edit', 'Preview new text and shapes, alignment, layers, editions, parents, image relinking, title, saved view, table cells, notes, or generated lists. Table rows and columns are one-based.', z.strictObject({
    ...projectInput, revision, changes: z.array(documentChange).min(1).max(25),
  }), async args => {
    const project = await loadProject(workspace, args.project, args.revision);
    return withPublication(project, async source => {
      const { draft, createdFrameIds } = await proposeDocumentChanges(workspace, source, args.changes);
      const preview = previewDraft(source, draft);
      return { ...plans.stage(project, draft), createdFrameIds, operations: args.changes.map(change => change.kind), ...preview };
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

  tool('recto_available_features', 'Report available and editor-only capabilities for this connection.', z.strictObject({}), async () => ({
    mode: workspace.writable ? 'drafts-and-exports' : 'read-only',
    covered: ['project creation', 'spread and story inspection', 'story replacement and tracking', 'text and shape placement', 'alignment and distribution', 'layer and edition visibility',
      'parent assignment', 'saved view and document title', 'image relinking', 'table cell edits', 'footnotes and endnotes', 'generated publication lists',
      'appearance profiles', 'XLIFF review', 'preflight', 'PDF and EPUB export', 'IDML import and export', 'Scribus import', 'batch publishing',
      'book archive inspection and interior PDF export'],
    editorOnly: ['live canvas interaction', 'current workspace and unsaved changes', 'live collaboration', 'native dialogs and updater',
      'interactive drawing and image adjustments', 'advanced table, style and book authoring'],
  }));

  if (workspace.writable) {
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
