import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseAppearance } from '../src/appearance';
import { translationCatalog } from '../src/translation/catalog';
import { writeTranslationExchange } from '../src/translation/xliff';
import { INITIAL_STATE } from '../src/state/defaults';
import { PDFDocument } from 'pdf-lib';
import { readZip } from '../src/zip';
import { bookCoverDimensions, type BookDeliveryRecipe } from '../src/engine/bookDelivery';
import { assembleArchivedBook, type BookArchive } from '../src/engine/bookArchive';
import { approveBookProof, makeBookProof } from '../src/engine/bookProof';
import type { ImageElement, TextElement } from '../src/types';

const timeout = 120_000;
const entry = path.resolve('bin/recto.js');
const knownText = 'Print sample.';
const project = structuredClone(INITIAL_STATE);
const pageId = project.spreads[0].pages[0].id;
const frame: TextElement = {
  id: 'story', type: 'text', pageId, x: 25, y: 30, width: 130, height: 70, rotation: 0, opacity: 1, zIndex: 1,
  locked: false, text: knownText, fontFamily: 'Helvetica', fontSizePt: 12, lineHeight: 1.3, letterSpacingPt: 0,
  color: '#000000', alignment: 'left', columns: 1, columnGutterMm: 4, backgroundColor: 'transparent',
  borderColor: 'transparent', borderWidthMm: 0, paddingMm: 2,
  storyContent: { version: 1, paragraphs: [{ id: 'stable', runs: [{ text: knownText, bold: true }] }] },
};
project.settings.title = 'Publishing server fixture';
project.settings.language = 'en';
project.spreads = [{ ...project.spreads[0], pages: [{ ...project.spreads[0].pages[0], pageNumber: 1 }], elements: [frame], masterSpreadId: null }];
project.masterSpreads = [];
const untouched = JSON.stringify(project);

describe('Recto publishing MCP over stdio', () => {
  let root: string;
  let workspace: string;
  let client: Client;
  let readClient: Client;
  let revision: string;
  const files = (name: string) => path.join(workspace, name);

  async function connect(writable: boolean) {
    const connection = new Client({ name: 'recto-test', version: '1.0.0' });
    await connection.connect(new StdioClientTransport({
      command: process.execPath,
      args: [entry, 'mcp', '--workspace', workspace, ...(writable ? ['--allow-write'] : [])],
    }), { timeout });
    return connection;
  }
  function call(name: string, args: Record<string, unknown>, via = client) {
    return via.callTool({ name, arguments: args }, { timeout });
  }
  async function result(name: string, args: Record<string, unknown>, via = client) {
    const reply = await call(name, args, via);
    expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
    return reply.structuredContent as Record<string, unknown>;
  }

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'recto-publishing-'));
    workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    await writeFile(files('original.recto'), untouched);
    await writeFile(path.join(root, 'outside.recto'), untouched);
    await symlink(root, files('outside'), process.platform === 'win32' ? 'junction' : 'dir');
    readClient = await connect(false);
    client = await connect(true);
    ({ revision } = await result('recto_inspect_publication', { project: 'original.recto' }) as { revision: string });
  }, timeout);

  afterAll(async () => {
    await Promise.allSettled([client?.close(), readClient?.close()]);
    if (root) await rm(root, { recursive: true, force: true });
  }, timeout);

  it('discovers read-only tools and rejects paths outside the chosen directory', async () => {
    const { tools } = await readClient.listTools();
    expect(tools.map(tool => tool.name)).toContain('recto_read_spread');
    expect(tools.map(tool => tool.name)).not.toContain('recto_save_draft');
    for (const file of ['../outside.recto', 'outside/outside.recto', path.resolve(root, 'outside.recto'), 'NUL.recto']) {
      expect((await call('recto_inspect_publication', { project: file }, readClient)).isError).toBe(true);
    }
    expect(await result('recto_read_spread', { project: 'original.recto', page: 1, limit: 1 }, readClient)).toMatchObject({
      revision, frames: [{ id: 'story', text: knownText }], totalFrames: 1,
    });
  }, timeout);

  it('compiles a declarative manuscript and a repeatable visual proof without overwrites', async () => {
    await writeFile(files('manuscript.md'), '# A printer proof\n\nManuscript with *emphasis* and a note.[^a]\n\n[^a]: In the harbor.');
    const args = { manuscript: 'manuscript.md', output: 'compiled-manuscript', pagesPerSignature: 4, targetSignatures: 1, sheetProof: true,
      paperSpec: { caliperMm: 0.105, gsm: 80 } };
    expect(await result('recto_plan_publication', { manuscript: args.manuscript, pagesPerSignature: 4 }, readClient))
      .toMatchObject({ budget: { manuscriptPages: 1, deliveredPages: 4 } });
    const readOnlyCall = await call('recto_compile_publication', args, readClient).catch((error: unknown) => {
      expect(String(error)).toMatch(/recto_compile_publication not found/);
      return { isError: true };
    });
    expect(readOnlyCall.isError).toBe(true);
    await expect(readFile(files('compiled-manuscript/interior.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
    const reply = await call('recto_compile_publication', args);
    expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
    expect(reply.structuredContent).toMatchObject({ report: {
      pageBudget: { manuscriptPages: 1, deliveredPages: 4, blankPages: 3 }, spine: { textBlockMm: 0.21 }, independentlyCertified: false,
    } });
    expect((reply.content as { type: string }[]).some(block => block.type === 'image')).toBe(true);
    expect((await PDFDocument.load(await readFile(files('compiled-manuscript/interior.pdf')))).getPageCount()).toBe(4);
    const handoff = JSON.parse(await readFile(files('compiled-manuscript/printer-handoff.json'), 'utf8'));
    expect(handoff.interior).toMatchObject({ file: 'interior.pdf', pages: 4, order: 'reader' });
    const plan = JSON.parse(await readFile(files('compiled-manuscript/signature-plan.json'), 'utf8'));
    expect(plan.sheetSides[0]).toMatchObject({ leftPageNumber: null, rightPageNumber: 1 });
    const sheets = await PDFDocument.load(await readFile(files('compiled-manuscript/signature-sheets-proof.pdf')));
    expect(sheets.getPageCount()).toBe(2);
    expect(sheets.getPage(0).getWidth()).toBeCloseTo(864);
    const compared = await result('recto_compile_publication', { ...args, output: 'compared-manuscript', previousPdf: 'compiled-manuscript/interior.pdf' });
    expect(compared).toMatchObject({ report: { comparison: { comparable: true } } });
    expect((compared as any).report.comparison.changedPixels).toBeLessThanOrEqual(50);
    expect((await readFile(files('compared-manuscript/proof-diff.png'))).subarray(1, 4).toString()).toBe('PNG');
    expect((await call('recto_compile_publication', args)).isError).toBe(true);
  }, timeout);

  it('inspects, compares and locates a quote in the same signed-off PDF bytes', async () => {
    const source = await PDFDocument.create();
    source.addPage([360, 540]);
    source.addPage([360, 540]).drawText('A printer proof', { x: 55, y: 450, size: 14 });
    const pdfPath = 'located-proof.pdf';
    await writeFile(files(pdfPath), await source.save());
    expect(await result('recto_inspect_delivery_pdf', { pdf: pdfPath, limit: 1 }, readClient))
      .toMatchObject({ pageCount: 2, nextOffset: 1 });
    expect(await result('recto_compare_pdf_proofs', { before: pdfPath, after: pdfPath, beforePage: 2, afterPage: 2 }, readClient))
      .toMatchObject({ comparable: true, changedPixels: 0, preview: 'difference' });
    const location = await call('recto_locate_pdf_text', { pdf: pdfPath, quote: 'A printer proof', pageLimit: 2 }, readClient);
    expect(location.isError, JSON.stringify(location.content)).not.toBe(true);
    expect(location.structuredContent).toMatchObject({ pageCount: 2, nextPage: null, matches: [{ page: 2 }] });
    expect((location.content as { type: string }[]).some(block => block.type === 'image')).toBe(true);
  }, timeout);

  it('previews rich text, refuses stale and overwriting drafts, then compiles the saved copy', async () => {
    const input = { project: 'original.recto', revision, frameId: 'story' };
    const change = { kind: 'replace', start: 0, end: 5, expectedText: 'Print', text: 'Proof' };
    const preview = await result('recto_preview_story_edit', { ...input, change });
    expect(preview.pageCount).toEqual({ before: 1, after: 1 });
    const visual = await call('recto_review_publication_change', { planId: preview.planId });
    expect(visual.isError, JSON.stringify(visual.content)).not.toBe(true);
    expect(visual.structuredContent).toMatchObject({
      revision, pages: [{ id: pageId, change: 'text', before: { physical: 1 }, after: { physical: 1 }, moved: false }],
      preview: { kind: 'diff', pageId },
    });
    expect(visual.content.some(block => block.type === 'image')).toBe(true);
    expect((await call('recto_save_draft', { planId: preview.planId, output: 'original.recto' })).isError).toBe(true);
    await writeFile(files('original.recto'), untouched + '\n');
    expect((await call('recto_review_publication_change', { planId: preview.planId })).isError).toBe(true);
    expect((await call('recto_save_draft', { planId: preview.planId, output: 'stale.recto' })).isError).toBe(true);
    await expect(readFile(files('stale.recto'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(files('original.recto'), untouched);
    const draft = await result('recto_save_draft', { planId: preview.planId, output: 'proof.recto' });
    const edited = JSON.parse(await readFile(files('proof.recto'), 'utf8'));
    expect(edited.spreads[0].elements[0].storyContent.paragraphs[0]).toMatchObject({ id: 'stable', runs: [{ text: 'Proof sample.', bold: true }] });
    expect(await readFile(files('original.recto'), 'utf8')).toBe(untouched);
    expect(await result('recto_run_preflight', { project: 'proof.recto', preset: 'pdfx4' })).toMatchObject({
      prerequisites: ['Import a CMYK output ICC profile for this preset.'],
    });
    expect(await result('recto_compile_pdf', { project: 'proof.recto', revision: draft.sha256, preset: 'print', output: 'proof.pdf' })).toMatchObject({ pages: 1 });
    expect((await PDFDocument.load(await readFile(files('proof.pdf')))).getPageCount()).toBe(1);
  }, timeout);

  it('identifies moved PDF pages and leaves unmatched revised pages unpaired', async () => {
    async function edition(name: string, labels: string[]) {
      const pdf = await PDFDocument.create();
      labels.forEach(label => pdf.addPage([360, 540]).drawText(label, { x: 36, y: 470 }));
      await writeFile(files(name), await pdf.save());
      return name;
    }
    const before = await edition('edition-before.pdf', ['First', 'Second', 'Previous']);
    const after = await edition('edition-after.pdf', ['Second', 'First', 'Revised']);
    const review = await result('recto_review_pdf_editions', { before, after, limit: 2 }, readClient);
    expect(review).toMatchObject({ nextOffset: 2, total: 4, pages: [
      { before: 2, after: 1, moved: true, change: 'unchanged' },
      { before: 1, after: 2, moved: true, change: 'unchanged' },
    ] });
    expect(await result('recto_review_pdf_editions', { before, after, offset: 2 }, readClient)).toMatchObject({
      nextOffset: null, pages: [{ before: null, after: 3, change: 'uncertain' }, { before: 3, after: null, change: 'uncertain' }],
    });
  }, timeout);

  it('uses the editor XLIFF format and preserves a portable appearance profile', async () => {
    const catalog = translationCatalog(project);
    const unit = catalog.flatMap(group => group.units).find(unit => unit.address.kind === 'paragraph')!;
    const translations = new Map([[unit.key, unit.source.map(part => part.kind === 'marker' ? part : { ...part, text: 'Druckprobe.' })]]);
    await writeFile(files('translation.xlf'), writeTranslationExchange(catalog, 'en', 'de', translations));
    const input = { project: 'original.recto', revision, exchange: 'translation.xlf' };
    expect(await result('recto_preview_translation', input)).toMatchObject({ planId: null, readyCount: 1 });
    const selected = await result('recto_preview_translation', { ...input, unitIds: [unit.key] });
    await result('recto_save_draft', { planId: selected.planId, output: 'german.recto' });
    const translated = JSON.parse(await readFile(files('german.recto'), 'utf8'));
    expect(translated.settings.language).toBe('de');
    expect(translated.spreads[0].elements[0].storyContent.paragraphs[0]).toMatchObject({ runs: [{ text: 'Druckprobe.', bold: true }] });
    const appearance = { theme: 'oled', buttonStyle: 'glass', accent: 'custom', customAccent: '#c8a2ff', compact: true, pasteboard: 'gray' };
    expect(await result('recto_save_appearance', { output: 'studio.rectoappearance', appearance })).toMatchObject({ appearance });
    expect(parseAppearance(await readFile(files('studio.rectoappearance'), 'utf8'))).toEqual(appearance);
    expect(await result('recto_appearance', { profile: 'studio.rectoappearance' })).toMatchObject({ appearance });
  }, timeout);

  it('creates a publication, stages editorial changes, and exports an editable interchange package', async () => {
    expect(await result('recto_create_publication', { title: 'Trade Book', pagePreset: 'Book-Trade-6x9', output: 'book.recto' }))
      .toMatchObject({ title: 'Trade Book', pagePreset: 'Book-Trade-6x9' });
    const preview = await result('recto_preview_layout_edit', {
      project: 'original.recto', revision,
      changes: [
        { kind: 'story-note', frameId: 'story', offset: knownText.length, noteType: 'footnote', text: 'Source for this passage.' },
        { kind: 'view', showReadingOrder: true },
      ],
    });
    await result('recto_save_draft', { planId: preview.planId, output: 'annotated.recto' });
    const state = JSON.parse(await readFile(files('annotated.recto'), 'utf8'));
    expect(state.settings.footnotes).toEqual([expect.objectContaining({ text: 'Source for this passage.', kind: 'footnote' })]);
    expect(state.showReadingOrder).toBe(true);
    const args = { project: 'original.recto', revision, format: 'idml', output: 'handoff.idml' };
    expect(await result('recto_export_publication', args)).toMatchObject({ format: 'idml' });
    expect(await result('recto_import_publication', { input: 'handoff.idml', output: 'handoff.recto' })).toMatchObject({ path: 'handoff.recto' });
    const imported = JSON.parse(await readFile(files('handoff.recto'), 'utf8'));
    expect(imported.spreads[0].elements.find((element: TextElement) => element.type === 'text').grepStyles)
      .toEqual([expect.objectContaining({ id: expect.any(String), bold: true })]);
  }, timeout);

  it('assembles an archived book and preserves a required recto opening in PDF', async () => {
    const archive = { version: 2, title: 'Collected proofs', chapters: [
      { id: 'one', name: 'One', recto: false, state: project },
      { id: 'two', name: 'Two', recto: true, state: project },
    ], delivery: { stock: 'cream-60lb', binding: 'paperback-perfect', preset: 'print' } };
    await writeFile(files('proofs.rectobook'), JSON.stringify(archive));
    const args = { book: 'proofs.rectobook' };
    const info = await result('recto_inspect_book', args, readClient);
    expect(info).toMatchObject({ pageCount: 3, blankPages: 1, cover: { approved: false },
      chapters: [{ startPageNumber: 1 }, { startPageNumber: 3 }] });
    expect(await result('recto_compile_book', { ...args, revision: info.revision, output: 'interior.pdf', preset: 'print' }))
      .toMatchObject({ pages: 3 });
    expect((await PDFDocument.load(await readFile(files('interior.pdf')))).getPageCount()).toBe(3);
  }, timeout);

  it('returns real PNG content for the saved and proposed layouts and offers the reviewed draft', async () => {
    const input = { project: 'original.recto', revision };
    const original = await call('recto_render_preview_image', { ...input, page: 1, maxEdge: 640 }, readClient);
    expect(original.isError, JSON.stringify(original.content)).not.toBe(true);
    const image = original.content.find(item => item.type === 'image');
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const originalPng = Buffer.from(image?.data ?? '', 'base64');
    expect(originalPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(originalPng.readUInt32BE(20)).toBeLessThanOrEqual(640);

    const preview = await result('recto_preview_layout_edit', { ...input, changes: [
      { kind: 'update-frame', frameId: 'story', xMm: 45 },
      { kind: 'object-style', frameId: 'story', styleId: 'obj-none' },
      { kind: 'add-shape', pageId, xMm: 30, yMm: 55, widthMm: 70, heightMm: 20, shape: 'rectangle', fill: '#ee4422' },
      { kind: 'add-table', pageId, xMm: 30, yMm: 85, widthMm: 70, heightMm: 20, rows: [['Name', 'Role'], ['Ada', 'Editor']] },
    ] });
    const refined = await result('recto_preview_layout_edit', { ...input, basePlanId: preview.planId,
      changes: [{ kind: 'update-frame', frameId: (preview.createdFrameIds as string[])[0], opacity: 0.75 }] });
    const rendered = await call('recto_render_preview_image', { planId: refined.planId, spread: 1, maxEdge: 640 });
    expect(rendered.isError, JSON.stringify(rendered.content)).not.toBe(true);
    expect(rendered.content.find(item => item.type === 'image')?.data).not.toBe(image?.data);
    const key = '1234567890abcdefghij';
    const canvas = `recto-canvas-${key}.png`;
    const proposal = `recto-proposal-${key}.rectoproposal`;
    await writeFile(files(canvas), originalPng);
    const observed = await call('recto_view_shared_canvas', { canvas }, readClient);
    expect(observed.content.find(item => item.type === 'image')).toMatchObject({ data: image?.data });
    await result('recto_offer_desktop_proposal', { planId: refined.planId, output: proposal });
    const envelope = JSON.parse(await readFile(files(proposal), 'utf8'));
    expect(envelope).toMatchObject({ format: 'recto-proposal', sourceRevision: revision });
    expect(envelope.draft.spreads[0].elements[0]).toMatchObject({ x: 45, objectStyleId: 'obj-none' });
    expect(envelope.draft.spreads[0].elements[1]).toMatchObject({ type: 'shape', opacity: 0.75 });
    expect(await readFile(files('original.recto'), 'utf8')).toBe(untouched);
  }, timeout);

  it('delivers a book ZIP only after cover dimensions have been approved', async () => {
    const recipe: BookDeliveryRecipe = { stock: 'cream-60lb', binding: 'paperback-perfect', preset: 'print' };
    const dimensions = bookCoverDimensions(project.settings, 1, recipe);
    const cover = structuredClone(project);
    cover.settings.widthMm = dimensions.width;
    cover.settings.heightMm = dimensions.height;
    cover.settings.bleedMm = dimensions.bleed;
    recipe.cover = cover;
    const archive = { version: 2, title: 'Delivery sample', chapters: [{ id: 'one', name: 'Chapter', recto: false, state: project }], delivery: recipe };
    const book = 'delivery.rectobook';
    await writeFile(files(book), JSON.stringify(archive));
    const pending = await result('recto_inspect_book', { book });
    expect((await call('recto_export_book_package', { book, revision: pending.revision, output: 'delivery.zip' })).isError).toBe(true);
    recipe.approvedDimensions = dimensions.signature;
    await writeFile(files(book), JSON.stringify(archive));
    const approved = await result('recto_inspect_book', { book });
    await result('recto_export_book_package', { book, revision: approved.revision, output: 'delivery.zip' });
    const entries = await readZip(new Uint8Array(await readFile(files('delivery.zip'))));
    expect([...entries.keys()]).toEqual(expect.arrayContaining(['interior.pdf', 'cover.pdf', 'ebook.epub', 'delivery-report.json']));
  }, timeout);

  it('compares an approved book with a staged chapter revision and returns the approved page image', async () => {
    const archive: BookArchive = { title: 'Approved book', references: [],
      chapters: [{ id: 'chapter-one', name: 'Chapter one', recto: false, state: project }] };
    const assembled = assembleArchivedBook(archive);
    const current = await makeBookProof(assembled.source, assembled.pages);
    archive.proof = await approveBookProof(current.snapshot, current.bytes);
    const book = 'approved.rectobook';
    await writeFile(files(book), JSON.stringify({ version: 2, ...archive }));
    const preview = await result('recto_preview_story_edit', { project: 'original.recto', revision, frameId: 'story',
      change: { kind: 'replace', start: 0, end: 5, expectedText: 'Print', text: 'Revised' } });
    const args = { book, chapterId: 'chapter-one', planId: preview.planId };
    const report = await result('recto_compare_book_proof', args);
    expect(report).toMatchObject({ changed: 1, moved: 0, rows: [{ change: 'text', after: { pageNumber: 1, chapterId: 'chapter-one' } }] });
    const png = await call('recto_render_book_proof_page', { book, edition: 'approved', page: 1, maxEdge: 480 }, readClient);
    expect(png.isError, JSON.stringify(png.content)).not.toBe(true);
    expect(png.content.find(item => item.type === 'image')).toMatchObject({ mimeType: 'image/png' });
  }, timeout);

  it('prints CSV records with a local photo and leaves no batch when a record fails', async () => {
    const template = structuredClone(project);
    const photo: ImageElement = { id: 'photo', type: 'image', pageId, x: 30, y: 110, width: 8, height: 8, rotation: 0,
      opacity: 1, zIndex: 2, locked: false, src: '{{photo}}', fitMode: 'fit', borderColor: 'transparent', borderWidthMm: 0,
      altText: 'Speaker photo' };
    template.settings.title = 'Event with {{name}}';
    template.spreads[0].elements.push(photo);
    await writeFile(files('template.recto'), JSON.stringify(template));
    await writeFile(files('picture.png'), await readFile('tests/fixtures/icc/alpha-sample.png'));
    await writeFile(files('invalid.csv'), 'name,photo\nAda,picture.png\nLin,../outside.png\n');
    await writeFile(files('events.csv'), 'name,photo\nAda,picture.png\nLin,picture.png\n');
    const templateInfo = await result('recto_inspect_publication', { project: 'template.recto' });
    const input = { project: 'template.recto', revision: templateInfo.revision, preset: 'print', photoFields: ['photo'] };
    expect((await call('recto_render_batch', { ...input, dataset: 'invalid.csv', output: 'failed' })).isError).toBe(true);
    await expect(readFile(files('failed/manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await result('recto_render_batch', { ...input, dataset: 'events.csv', output: 'programs' })).toMatchObject({ records: 2 });
    expect((await PDFDocument.load(await readFile(files('programs/record-0002.pdf')))).getTitle()).toBe('Event with Lin');
  }, timeout);
});
