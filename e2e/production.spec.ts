import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importProject, projectFixture, savedProject } from './fixtures';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { readZip } from '../src/zip';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/'); await expect(page.locator('#spread-canvas')).toBeVisible();
});

test('loads chapter snapshots, saves a book archive and exports the assembled PDF', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  const production = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Production & books$/ }) });
  const first = projectFixture(), second = projectFixture();
  first.settings.title = 'First chapter'; second.settings.title = 'Second chapter';
  second.spreads[0].elements[0].text = 'Second chapter manuscript';
  await production.getByLabel('Add .recto chapters or open a saved .rectobook').setInputFiles([
    { name: 'first.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(first)) },
    { name: 'second.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(second)) },
  ]);
  await expect(production.getByRole('status')).toHaveText('2 chapters loaded locally.');
  await production.getByLabel('Book title', { exact: true }).fill('Collected Essays');
  const archiveDownload = page.waitForEvent('download'); await production.getByRole('button', { name: 'Save book archive' }).click();
  const archivePath = await (await archiveDownload).path();
  const archive = JSON.parse(await readFile(archivePath!, 'utf8'));
  expect(archive.chapters).toHaveLength(2); expect(archive.title).toBe('Collected Essays');
  const pdfDownload = page.waitForEvent('download'); await production.getByRole('button', { name: 'Export book PDF' }).click();
  const pdf = await pdfDownload; expect(pdf.suggestedFilename()).toBe('Collected Essays.pdf');
  await expect(production.getByRole('status')).toHaveText('Book exported: 3 pages.');
  expect((await readFile((await pdf.path())!)).subarray(0, 8).toString()).toBe('%PDF-1.7');
});

test('refreshes a chapter and updates a book reference without changing the source manuscript', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  const production = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Production & books$/ }) });
  const first = projectFixture(), second = projectFixture();
  first.settings.title = 'Introduction';
  second.settings.title = 'Methods chapter';
  Object.assign(first.spreads[0].elements[0], { text: 'See page [[book:methods]].', paragraphStyleId: 'style-h1' });
  Object.assign(second.spreads[0].elements[0], { text: 'Methods', paragraphStyleId: 'style-h1', fontSizePt: 24 });
  const file = (name: string, value: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  const picker = production.getByLabel('Add .recto chapters or open a saved .rectobook');
  await picker.setInputFiles([file('intro.recto', first), file('methods.recto', second)]);
  await expect(production.getByRole('status')).toHaveText('2 chapters loaded locally.');
  await production.getByText('Book references', { exact: true }).click();
  await production.getByLabel('Reference key').fill('methods');
  await production.getByLabel('Target chapter').selectOption({ label: 'Methods chapter' });
  await production.getByLabel('Target heading or caption').selectOption({ label: '1. Methods' });
  await production.getByRole('button', { name: 'Add book reference' }).click();

  const download = async (button: string) => {
    const waiting = page.waitForEvent('download');
    await production.getByRole('button', { name: button, exact: true }).click();
    return readFile((await (await waiting).path())!, 'utf8');
  };
  expect(await download('Export book contents')).toContain('Methods\t3');
  const revised = structuredClone(second);
  const heading = revised.spreads[0].elements.pop()!;
  heading.pageId = 'revised-page';
  revised.spreads.push({ id: 'revised-spread', spreadIndex: 1,
    pages: [{ id: heading.pageId, pageNumber: 2, side: 'single' }], elements: [heading] });
  revised.spreads[1].elements.push({ ...heading, id: 'revised-overset', fontSizePt: 12, height: 12,
    text: 'New text that cannot fit in a short frame. '.repeat(50), ...{ paragraphStyleId: 'style-body' } });
  const choosing = page.waitForEvent('filechooser');
  await production.getByRole('button', { name: 'Refresh chapter methods.recto' }).click();
  await (await choosing).setFiles(file('methods-revised.recto', revised));
  await expect(production.getByRole('region', { name: 'Chapter refresh preview' })).toContainText('methods-revised.recto (2 pages)');
  await expect(production.getByRole('region', { name: 'Chapter refresh preview' })).toContainText('Methods (page 1) → Methods (page 2)');
  await expect(production.getByRole('region', { name: 'Chapter refresh preview' })).toContainText('Text overflows its final frame.');
  await production.getByRole('button', { name: 'Apply chapter refresh' }).click();
  const contents = await download('Export book contents');
  expect(contents).toContain('See page 4.\t1');
  expect(contents).toContain('Methods\t4');

  const archive = JSON.parse(await download('Save book archive'));
  expect(archive.references[0].chapterId).toBe(archive.chapters[1].id);
  expect(archive.chapters[0].state.spreads[0].elements[0].text).toContain('[[book:methods]]');
  await picker.setInputFiles(file('reopened.rectobook', archive));
  await expect(production.getByRole('status')).toHaveText('2 chapters loaded locally.');
  expect(await download('Export book contents')).toBe(contents);
});

test('exports the continuation of a footnote on its linked page', async ({ page }) => {
  const project = projectFixture();
  const first = project.spreads[0].elements[0];
  Object.assign(first, { width: 100, height: 36, fontFamily: 'Times', fontSizePt: 12, nextFrameId: 'note-tail',
    storyContent: { version: 1, paragraphs: [{ runs: [{ text: 'Cited source' }, { text: '¹', noteId: 'source-note' }] }] } });
  Object.assign(project.settings, { footnotes: [{ id: 'source-note', number: 1, kind: 'footnote', anchorVersion: 1,
    text: 'A detailed citation with enough text to continue. '.repeat(22) + 'Last citation sentence.', elementId: first.id, pageId: first.pageId }] });
  const tail = { ...first, id: 'note-tail', pageId: 'note-page', height: 220, text: '' };
  Object.assign(tail, { prevFrameId: first.id, nextFrameId: undefined, storyContent: undefined });
  project.spreads.push({ id: 'note-spread', spreadIndex: 1, pages: [{ id: 'note-page', pageNumber: 2, side: 'single' }], elements: [tail] });
  await importProject(page, project);
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  const download = page.waitForEvent('download');
  await page.getByTitle('Export Clean Digital PDF (Exact Trim Dimensions)').click();
  const pdf = await PDFDocument.load(await readFile((await (await download).path())!));
  expect(pdf.getPageCount()).toBe(2);
  const content = pdf.getPages()[1].node.lookup(PDFName.of('Contents'));
  if (!(content instanceof PDFRawStream)) throw new Error('Expected a PDF page content stream.');
  const text = new TextDecoder().decode(decodePDFRawStream(content).decode());
  expect(text).toContain('1. Continued');
  expect(text).toContain('Last citation sentence.');
});

test('exports a book package after reviewing the matching cover', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  const production = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Production & books$/ }) });
  const chapter = projectFixture(), cover = projectFixture();
  Object.assign(chapter.settings, { title: 'Delivered chapter', bleedMm: 3 });
  Object.assign(cover.settings, { title: 'Designed cover', widthMm: 422.6, bleedMm: 3 });
  const file = (name: string, project: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await production.getByLabel('Add .recto chapters or open a saved .rectobook').setInputFiles(file('chapter.recto', chapter));
  await expect(production.getByRole('status')).toHaveText('1 chapters loaded locally.');
  await production.getByText('Book delivery package', { exact: true }).click();
  const exportButton = production.getByRole('button', { name: 'Export book package', exact: true });
  await expect(exportButton).toBeDisabled();
  await production.getByLabel('Cover .recto file').setInputFiles(file('cover.recto', cover));
  await production.getByRole('button', { name: 'Approve cover dimensions' }).click();
  const download = page.waitForEvent('download');
  await exportButton.click();
  const files = await readZip(await readFile((await (await download).path())!));
  expect([...files.keys()]).toEqual(['interior.pdf', 'cover.pdf', 'ebook.epub', 'delivery-report.json']);
  await writeFile(test.info().outputPath('book-reflowable.epub'), files.get('ebook.epub')!);
});

test('exports fixed-layout EPUB as page XHTML with selectable text', async ({ page }) => {
  await importProject(page);
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Fixed-Layout EPUB', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  const files = await readZip(bytes);
  const decode = (name: string) => new TextDecoder().decode(files.get(name));
  expect(decode('OEBPS/package.opf')).toContain('pre-paginated');
  expect(decode('OEBPS/page-1.xhtml').replace(/<[^>]*>/g, '')).toContain('Browser workflow sample');
  expect(decode('OEBPS/page-1.xhtml')).toContain('name="viewport"');
  await writeFile(test.info().outputPath('book-fixed.epub'), bytes);
});

test('shares a story between separate layout sizes without resizing the destination', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  await page.getByRole('button', { name: 'Manage publication layouts' }).click();
  await page.getByText('Shared layouts', { exact: true }).click();
  const source = projectFixture(), target = projectFixture();
  source.settings.title = 'Original layout';
  target.settings.title = 'Compact layout';
  target.settings.widthMm = 140;
  target.spreads[0].elements[0].width = 98;
  target.spreads[0].elements[0].text = 'Old version';
  const upload = page.getByLabel('Add layout or open publication bundle');
  const file = (name: string, project: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await upload.setInputFiles(file('source.recto', source));
  await expect(page.getByText(/Original layout · 210/)).toBeVisible();
  await upload.setInputFiles(file('target.recto', target));
  await expect(page.getByText(/Compact layout · 140/)).toBeVisible();
  await page.getByLabel('Source layout', { exact: true }).selectOption({ label: 'Original layout' });
  await page.getByLabel('Source object').selectOption('text-qa');
  await page.getByLabel('Destination layout').selectOption({ label: 'Compact layout' });
  await page.getByLabel('Destination object').selectOption('text-qa');
  await page.getByRole('button', { name: 'Link layout objects' }).click();
  await page.getByRole('button', { name: 'Preview linked update' }).click();
  await expect(page.getByRole('region', { name: 'Linked layout update preview' })).toContainText('Browser workflow sample');
  await page.getByRole('button', { name: 'Apply linked update' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('listitem').filter({ hasText: 'Compact layout · 140' })
    .getByRole('button', { name: 'Download editable layout' }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(saved.settings.widthMm).toBe(140);
  expect(saved.spreads[0].elements[0]).toMatchObject({ width: 98, text: 'Browser workflow sample' });
});

test('imports spreadsheet cells and merges a row without losing its text', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.spreads[0].elements[0], { type: 'table', rows: 2, cols: 2,
    cells: [[{ text: 'A' }, { text: 'B' }], [{ text: '1' }, { text: '2' }]], headerRowCount: 1,
    headerFillColor: '#222222', headerTextColor: '#ffffff', borderWidthMm: 0.2, cellPaddingMm: 1 });
  await importProject(page, project);
  await page.getByText('Import table data', { exact: true }).click();
  await page.getByLabel('Table CSV or TSV data').fill('Product\tPrice\nBook\t12');
  await page.getByRole('button', { name: 'Replace table data' }).click();
  await page.getByTitle('Row 1, Col 1: Product', { exact: true }).click();
  await page.getByRole('button', { name: 'Merge cell right' }).click();
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].cells[0][0]).toMatchObject({ text: 'Product Price', colSpan: 2 });
  await page.getByRole('button', { name: 'Split merged cell' }).click();
  expect((await savedProject(page)).spreads[0].elements[0].cells[0][0].colSpan).toBeUndefined();
});

test('exports the selected publication edition without deleting the excluded frame', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  await page.getByText('Publication editions', { exact: true }).click();
  await page.getByLabel('Selected object edition', { exact: true }).selectOption('cond-teacher');
  await page.getByRole('combobox', { name: /PDF preset/ }).selectOption('print');
  const exportedText = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export document PDF', exact: true }).click();
    const pdf = await PDFDocument.load(await readFile((await (await download).path())!));
    const content = pdf.getPages()[0].node.lookup(PDFName.of('Contents'));
    if (!(content instanceof PDFRawStream)) throw new Error('Expected a single PDF page content stream.');
    return new TextDecoder().decode(decodePDFRawStream(content).decode());
  };
  expect(await exportedText()).not.toContain('Browser workflow sample');
  await page.getByLabel('Teacher Edition', { exact: true }).check();
  expect(await exportedText()).toContain('Browser workflow sample');
  expect((await savedProject(page)).spreads[0].elements[0]).toMatchObject({ text: 'Browser workflow sample', conditionId: 'cond-teacher' });
});

test('retains manuscript formatting during filtered Find/Change and undo', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.spreads[0].elements[0], { storyContent: { version: 1, paragraphs: [{ runs: [{ text: 'Bold opening ', bold: true }, { text: 'needle in manuscript' }] }] }, rawStoryText: 'Bold opening needle in manuscript' });
  await importProject(page, project);
  await page.getByTitle('Find / Change (GREP) (Ctrl+F)').click();
  await page.getByPlaceholder('Text to find...').fill('needle');
  await page.getByPlaceholder('Replacement text...').fill('corrected');
  await expect(page.getByLabel('Find paragraph style')).toBeVisible();
  await page.getByRole('button', { name: 'Change All', exact: true }).click();
  await page.getByPlaceholder('Text to find...').press('Escape');
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].rawStoryText).toContain('corrected');
  expect(saved.spreads[0].elements[0].storyContent.paragraphs[0].runs[0].bold).toBe(true);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].rawStoryText).toContain('needle');
});
