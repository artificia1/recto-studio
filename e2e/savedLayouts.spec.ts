import { expect, test } from '@playwright/test';
import { importProject, savedProject } from './fixtures';

test('saves a spread layout, finds it after reload and inserts a new editable copy', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  const templates = page.getByRole('button', { name: 'Templates', exact: true });
  await templates.click();
  await page.getByLabel('Layout name', { exact: true }).fill('Editorial sample');
  await page.getByRole('button', { name: 'Save active spread', exact: true }).click();
  await expect(page.getByText('Spread layout saved.')).toBeVisible();
  await page.reload();
  await templates.click();
  const search = page.getByRole('searchbox', { name: 'Search layouts' });
  await search.fill('other');
  await expect(page.getByText('No saved layouts match your search.')).toBeVisible();
  await search.fill('editorial SAMPLE');
  const card = page.getByRole('article').filter({ hasText: 'Editorial sample' });
  await card.getByRole('button', { name: 'Add spread', exact: true }).click();
  const document = await savedProject(page);
  const original = document.spreads[0].elements[0];
  const inserted = document.spreads[1].elements[0];
  expect(inserted).toMatchObject({ text: original.text, x: original.x, y: original.y, width: original.width, height: original.height });
  expect(inserted.id).not.toBe(original.id);
  expect(inserted.pageId).toBe(document.spreads[1].pages[0].id);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await savedProject(page)).spreads).toHaveLength(1);
});
