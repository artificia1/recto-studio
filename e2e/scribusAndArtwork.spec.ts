import { expect, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { importProject, projectFixture, savedProject } from './fixtures';
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

test('migrates legacy artwork and saves even when localStorage is full', async ({ page }) => {
  const artwork = {
    format: 'recto-artwork-v1',
    id: '8ab59977-7f45-4ef0-ae91-1e839398d09b',
    name: 'Legacy artwork',
    elements: [{ ...projectFixture().spreads[0].elements[0], pageId: 'artwork-page' }],
  };
  await page.addInitScript(artwork => {
    if (!sessionStorage.getItem('legacy-artwork-seeded')) {
      localStorage.setItem('recto-artwork-library-v1', JSON.stringify([artwork]));
      sessionStorage.setItem('legacy-artwork-seeded', 'true');
    }
    Storage.prototype.setItem = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
  }, artwork);

  await page.goto('./');
  await importProject(page);
  const openLibrary = async () => {
    await page.getByRole('button', { name: /Templates/ }).click();
    await page.getByText('Artwork library', { exact: true }).click();
    return page.locator('details').filter({ has: page.getByText('Artwork library', { exact: true }) });
  };
  const library = await openLibrary();
  await expect(library.getByText('Legacy artwork', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('recto-artwork-library-v1'))).toBeNull();
  await library.getByLabel('Artwork name').fill('New artwork');
  await library.getByRole('button', { name: 'Save selection' }).click();
  await expect(library.getByRole('status')).toContainText('Saved New artwork');
  await page.reload();
  const reopened = await openLibrary();
  await expect(reopened.getByText('Legacy artwork', { exact: true })).toBeVisible();
  const entry = reopened.locator('.publication-panel').filter({ hasText: 'New artwork' });
  await expect(entry).toBeVisible();
  await entry.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(entry).toHaveCount(0);
  await expect(reopened.getByText('Legacy artwork', { exact: true })).toBeVisible();
});

test('keeps an excluded layer visible and editable while saving its publication setting', async ({ page }) => {
  await page.goto('./');
  await importProject(page);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('checkbox', { name: /Include .* in publication output/ }).uncheck();
  const state = await savedProject(page);
  expect(state.layers.find((layer: { id: string }) => layer.id === state.activeLayerId)).toMatchObject({ printable: false, visible: true, locked: false });
  expect(state.spreads[0].elements[0].text).toBe('Browser workflow sample');
});
