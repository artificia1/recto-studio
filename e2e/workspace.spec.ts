import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importProject, projectFixture, savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#spread-canvas')).toBeVisible();
});

test('drags artwork from the first spread to page 48 and undoes the transfer', async ({ page }) => {
  const project = projectFixture();
  const photo = project.spreads[0].elements[0];
  Object.assign(photo, { id: 'photo', type: 'image', width: 50, height: 50, fitMode: 'fit',
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' });
  project.selectedElementId = 'photo'; project.selectedElementIds = ['photo'];
  for (let index = 1; index < 64; index++) project.spreads.push({ id: `spread-${index}`, spreadIndex: index,
    pages: [{ id: `page-${index}`, pageNumber: index + 1, side: 'single' }], elements: [] });
  await importProject(page, project);
  await page.getByRole('button', { name: 'All spreads', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Multi-spread workspace' });
  await workspace.getByLabel('Workspace columns').selectOption('8');
  await workspace.getByLabel('Workspace zoom').selectOption('0.1');
  const source = (await page.locator('[data-workspace-object="photo"]').boundingBox())!;
  const target = (await page.locator('[data-workspace-page="page-47"]').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 30, target.y + 35, { steps: 12 });
  await page.mouse.up();
  await expect(workspace.getByRole('status')).toHaveText('Artwork moved to target page.');
  await workspace.getByLabel('Workspace zoom').selectOption('0.05');
  await page.screenshot({ path: 'test-results/multi-spread-workspace.png', fullPage: true });
  await workspace.getByRole('button', { name: 'Return to spread editor' }).click();
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements).toHaveLength(0);
  expect(saved.spreads[47].elements[0]).toMatchObject({ id: 'photo', pageId: 'page-47', pasteboard: false });
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].id).toBe('photo');
});

test('sets numerical spacing and groups and ungroups the selection', async ({ page }) => {
  const project = projectFixture(), original = project.spreads[0].elements[0];
  project.spreads[0].elements = [10, 60, 120].map((x, index) => ({ ...original, id: `item-${index}`, x, width: 20, height: 20, text: String(index) }));
  project.selectedElementId = 'item-0'; project.selectedElementIds = ['item-0', 'item-1', 'item-2'];
  await importProject(page, project);
  await page.getByLabel('Exact spacing (mm)', { exact: true }).fill('4.5');
  await page.getByRole('button', { name: 'Set horizontal gap' }).click();
  let saved = await savedProject(page);
  expect(saved.spreads[0].elements.map((element: { x: number }) => element.x)).toEqual([10, 34.5, 59]);
  await page.getByTitle('Selection Tool (V)', { exact: true }).click();
  await page.keyboard.press('Control+g');
  saved = await savedProject(page);
  expect(new Set(saved.spreads[0].elements.map((element: { groupId: string }) => element.groupId)).size).toBe(1);
  expect(saved.spreads[0].elements[0].groupId).toBeTruthy();
  await page.getByRole('button', { name: 'Ungroup objects' }).click();
  expect((await savedProject(page)).spreads[0].elements.every((element: { groupId?: string }) => !element.groupId)).toBe(true);
});

test('scrolls during a drag and saves artwork on the adjacent pasteboard', async ({ page }) => {
  const project = projectFixture();
  project.spreads[0].elements[0].width = 40; project.spreads[0].elements[0].height = 30;
  project.spreads.push({ id: 'spread-target', spreadIndex: 1, pages: [{ id: 'page-target', pageNumber: 2, side: 'single' }], elements: [] });
  await importProject(page, project);
  await page.getByRole('button', { name: 'All spreads', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Multi-spread workspace' });
  await workspace.getByLabel('Workspace columns').selectOption('1');
  await workspace.getByLabel('Workspace zoom').selectOption('0.5');
  const source = (await page.locator('[data-workspace-object="text-qa"]').boundingBox())!;
  const scroll = page.locator('.spatial-scroll'), host = (await scroll.boundingBox())!;
  await page.mouse.move(source.x + 5, source.y + 5); await page.mouse.down();
  await page.mouse.move(source.x + 5, host.y + host.height - 5, { steps: 8 });
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  // Park away from the edge before reading the target's final screen position.
  await page.mouse.move(source.x + 5, host.y + host.height / 2);
  const target = (await page.locator('[data-workspace-page="page-target"]').boundingBox())!;
  await page.mouse.move(target.x - 15, target.y + 35, { steps: 4 }); await page.mouse.up();
  await expect(workspace.getByRole('status')).toHaveText('Artwork stored on pasteboard.');
  await workspace.getByRole('button', { name: 'Return to spread editor' }).click();
  const saved = await savedProject(page);
  expect(saved.spreads[1].elements[0]).toMatchObject({ id: 'text-qa', pasteboard: true, pageId: 'page-target' });
  await importProject(page, saved);
  expect((await savedProject(page)).spreads[1].elements[0].pasteboard).toBe(true);
});

test('loads a licensed replacement font and replaces document references', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Links', exact: true }).click();
  await page.getByText('Document fonts & replacement', { exact: true }).click();
  await page.getByLabel('Replace document font', { exact: true }).selectOption('Georgia, serif');
  await page.getByLabel('Replacement font file', { exact: true }).setInputFiles('tests/fixtures/fonts/OpenSans-Regular.ttf');
  await expect(page.getByRole('status').filter({ hasText: 'Font loaded.' })).toBeVisible();
  const family = await page.getByLabel('Use loaded font').inputValue();
  expect(family).toBeTruthy();
  await page.getByRole('button', { name: 'Replace font throughout document' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Font references replaced.' })).toBeVisible();
  expect((await savedProject(page)).spreads[0].elements[0].fontFamily).toBe(family);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].fontFamily).toBe('Georgia, serif');
});

test('creates a child master and edits its inherited source without creating a cycle', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByTitle('Create a new Master Spread template', { exact: true }).click();
  const a = (await savedProject(page)).masterSpreads[0];
  await page.getByLabel('New master parent').selectOption(a.id);
  await page.getByTitle('Create a new Master Spread template', { exact: true }).click();
  const b = (await savedProject(page)).masterSpreads[1];
  expect(b.parentMasterId).toBe(a.id); expect(b.elements).toEqual([]);
  await page.getByText('Edit master items', { exact: true }).click();
  await page.getByLabel('Master to edit').selectOption(a.id);
  await page.getByRole('button', { name: 'Unlock master item', exact: true }).first().click();
  const y = page.getByLabel(`Master y ${a.elements[0].id}`, { exact: true });
  await y.fill('18'); await y.press('Tab');
  expect((await savedProject(page)).masterSpreads[0].elements[0].y).toBe(18);
  await page.getByLabel(`Parent master for ${a.name}`, { exact: true }).selectOption(b.id);
  await expect(page.getByRole('alert')).toHaveText('Master inheritance contains a cycle.');
  expect((await savedProject(page)).masterSpreads[0].parentMasterId).toBeUndefined();
});

test('persists object blending and exports a live PDF blend state', async ({ page }) => {
  await importProject(page);
  await page.getByLabel('Object blend', { exact: true }).selectOption('multiply');
  expect((await savedProject(page)).spreads[0].elements[0].blendMode).toBe('multiply');
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  const download = page.waitForEvent('download');
  await page.getByText('Standard PDF (Clean / Proof)', { exact: true }).click();
  const path = await (await download).path(), bytes = await readFile(path!);
  await writeFile('test-results/workspace-blend.pdf', bytes);
  expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.7');
  expect(bytes.includes(Buffer.from('/BM /Multiply'))).toBe(true);
});
