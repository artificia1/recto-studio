import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { importProject, projectFixture, savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/'); await expect(page.locator('#spread-canvas')).toBeVisible();
});

test('flattens transparent artwork with the actual browser renderer and exports a CMYK print candidate', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.settings, { widthMm: 40, heightMm: 30 });
  Object.assign(project.spreads[0].elements[0], { type: 'shape', shapeKind: 'rectangle', x: 4, y: 4, width: 15, height: 15,
    fillColor: '#ff00ff', strokeColor: 'transparent', strokeWidthMm: 0, strokeDash: 'solid', opacity: 0.5 });
  await importProject(page, project);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByText('ICC colour management', { exact: true }).click();
  await page.getByLabel('CMYK output ICC profile', { exact: true }).setInputFiles('tests/fixtures/icc/lcms-test-output.icc');
  await expect(page.getByText('Output profile loaded.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  await page.getByRole('combobox', { name: /PDF preset/ }).selectOption('pdfx1a');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export document PDF', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.4');
  const pdf = await PDFDocument.load(bytes);
  const images = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
  expect(images.length).toBeGreaterThan(0);
  expect(images.every(image => image.dict.get(PDFName.of('ColorSpace'))?.toString() === '/DeviceCMYK' && !image.dict.has(PDFName.of('SMask')))).toBe(true);
  const states = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
  for (const [, value] of states.entries()) expect(pdf.context.lookup(value, PDFDict).has(PDFName.of('BM'))).toBe(false);
  await expect(page.getByRole('status').filter({ hasText: 'not GWG certified' })).toBeVisible();
});

test('merges table cells vertically, enables row splitting and keeps source copy through undo', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.spreads[0].elements[0], { type: 'table', rows: 3, cols: 2, height: 70,
    cells: [[{ text: 'Category' }, { text: 'Amount' }], [{ text: 'First group' }, { text: '100' }], [{ text: 'Second group' }, { text: '200' }]],
    headerRowCount: 1, headerFillColor: '#222222', headerTextColor: '#ffffff', borderWidthMm: 0.2, cellPaddingMm: 1 });
  await importProject(page, project);
  await page.getByTitle('Row 2, Col 1: First group', { exact: true }).click();
  await page.getByRole('button', { name: 'Merge cell down', exact: true }).click();
  const merged = await savedProject(page);
  expect(merged.spreads[0].elements[0].cells[1][0]).toMatchObject({ text: 'First group\nSecond group', rowSpan: 2 });
  await page.getByText('Table continuation', { exact: true }).click();
  await page.getByLabel('Split table rows across frames', { exact: true }).check();
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].allowRowSplit).toBe(true);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].cells[1][0].rowSpan).toBe(2);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].cells[2][0].text).toBe('Second group');
});
