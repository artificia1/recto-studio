import { expect, test } from '@playwright/test';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importProject, savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
});

test('compares proofs and retains notes from both matched and changed pages', async ({ page }) => {
  await page.getByRole('button', { name: 'Compare proofs', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Compare proofs' });
  const download = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Download current review PDF' }).click();
  const original = await readFile((await (await download).path())!);
  const annotated = await PDFDocument.load(original);
  const added = annotated.addPage();
  for (const [index, pdfPage] of [annotated.getPage(0), added].entries()) {
    const note = annotated.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 640, 75, 665],
      T: PDFHexString.fromText('Editor'), Contents: PDFHexString.fromText(index ? 'Check the added page' : 'Check the headline') });
    pdfPage.node.addAnnot(annotated.context.register(note));
  }
  await review.getByLabel('Original proof', { exact: true }).setInputFiles({ name: 'original.pdf', mimeType: 'application/pdf', buffer: original });
  await review.getByLabel('Revised proof', { exact: true }).setInputFiles({ name: 'revised.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await annotated.save()) });
  await review.getByRole('button', { name: 'Compare PDFs', exact: true }).click();
  await expect(review.getByRole('status')).toHaveText('1 of 2 page positions changed.');
  await expect(review.getByRole('button', { name: 'Page 2 · Added page', exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Import comments from revised proof' }).click();
  await expect(review.getByRole('status')).toContainText('2 new comments imported. 1 of the PDF comments need placement.');
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  const state = await savedProject(page);
  expect(state.comments).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'Check the headline', pageId: 'page-qa', unplaced: false }),
    expect.objectContaining({ text: 'Check the added page', unplaced: true, proofPage: 2 }),
  ]));
});

test('saves printer requirements and applies them to the active PDF export', async ({ page }) => {
  await page.getByText('Printer profiles', { exact: true }).click();
  await page.getByLabel('Printer profile name', { exact: true }).fill('Book press');
  await page.getByRole('button', { name: 'Save printer profile', exact: true }).click();
  await expect(page.getByLabel('Active printer profile')).toHaveValue('Book press');
  await page.getByRole('button', { name: 'Export document PDF', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Book press requires 3 mm bleed' })).toBeVisible();
  await page.getByRole('combobox', { name: /PDF preset/ }).selectOption('press');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export document PDF', exact: true }).click();
  expect((await (await download).path())!).toBeTruthy();
});

test('saves a delivery report tied to the actual exported PDF', async ({ page }) => {
  await page.getByRole('combobox', { name: /PDF preset/ }).selectOption('press');
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export document PDF', exact: true }).click();
  const pdf = await readFile((await (await pdfDownload).path())!);
  const sha256 = createHash('sha256').update(pdf).digest('hex');

  await page.getByRole('button', { name: 'Inspect delivery PDF', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Inspect delivery PDF' });
  const input = inspector.getByLabel('Delivery PDF', { exact: true });
  await input.setInputFiles({ name: 'delivery.pdf', mimeType: 'application/pdf', buffer: pdf });
  await inspector.getByRole('button', { name: 'Inspect PDF', exact: true }).click();
  await expect(inspector.getByText(sha256, { exact: true })).toBeVisible();
  const reportDownload = page.waitForEvent('download');
  const save = inspector.getByRole('button', { name: 'Save delivery report' });
  await save.click();
  const report = JSON.parse(await readFile((await (await reportDownload).path())!, 'utf8'));
  expect(report.source).toMatchObject({ name: 'delivery.pdf', sha256, sizeBytes: pdf.length });
  expect(report.pages[0].boxesPt).toHaveProperty('TrimBox');
  expect(Math.min(...(Object.values(report.pages[0].bleedMm) as number[]))).toBeCloseTo(3);

  await input.setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: pdf.subarray(0, 100) });
  await inspector.getByRole('button', { name: 'Inspect PDF', exact: true }).click();
  await expect(inspector.getByRole('status')).toHaveText('Choose a complete PDF file.');
  await expect(save).toBeDisabled();
});
