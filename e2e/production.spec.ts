import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importProject, projectFixture, savedProject } from './fixtures';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

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
  await production.locator('input[type="file"]').setInputFiles([
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
