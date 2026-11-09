import { expect, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { importProject, savedProject } from './fixtures';
import { scribusFixture } from '../tests/scribusFixture';

test('reviews a compressed Scribus import before opening an editable project', async ({ page }) => {
  await page.goto('./');
  await importProject(page);
  await page.getByTitle('File Management, Project IO, and Document Imports').click();
  await page.getByRole('button', { name: 'Import Scribus Document (.sla)…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Scribus document' });
  await dialog.getByLabel('Scribus document').setInputFiles({
    name: 'scribus-book.sla.gz', mimeType: 'application/gzip', buffer: gzipSync(scribusFixture),
  });
  await expect(dialog.getByRole('status')).toContainText('6 editable object(s) · 1 skipped');
  await expect(dialog.getByText(/need relinking/)).toBeVisible();
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Browser QA document');
  await dialog.getByRole('button', { name: 'Open in Recto' }).click();
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Scribus handoff');
  const state = await savedProject(page);
  expect(state.spreads[0].elements[0].storyContent.paragraphs[0].runs[1]).toMatchObject({ text: 'copy', bold: true });
  expect(state.spreads[0].elements[0].nextFrameId).toBe(state.spreads[1].elements[0].id);
  expect(state.masterSpreads[0].elements[0].strokeColor).toBe('cmyk(100,28,0,3)');
});

test('saves a selection to the artwork library and places it with a new identity', async ({ page }) => {
  await page.goto('./');
  await importProject(page);
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.getByText('Artwork library', { exact: true }).click();
  const library = page.locator('details').filter({ has: page.getByText('Artwork library', { exact: true }) });
  await library.getByLabel('Artwork name').fill('Reusable text');
  await library.getByRole('button', { name: 'Save selection' }).click();
  await expect(library.getByRole('status')).toContainText('Saved Reusable text');
  await library.getByRole('button', { name: 'Place', exact: true }).click();
  await expect(library.getByRole('status')).toContainText('Placed Reusable text');
  const state = await savedProject(page);
  const elements = state.spreads[0].elements;
  expect(elements).toHaveLength(2);
  expect(elements[1]).toMatchObject({ text: elements[0].text, id: expect.stringMatching(/^artwork-/), pageId: elements[0].pageId });
});
