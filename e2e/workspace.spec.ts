import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importProject, menuCommand, projectFixture, savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#spread-canvas')).toBeVisible();
});

test('places one photo on canvas and preserves transparent replacements across reload', async ({ page }) => {
  const project = projectFixture();
  project.spreads[0].elements = [];
  await importProject(page, project);
  const canvas = page.locator('#spread-canvas');
  const payload = await page.evaluate(() => {
    const bitmap = document.createElement('canvas');
    bitmap.width = 1400;
    bitmap.height = 20;
    const ctx = bitmap.getContext('2d')!;
    ctx.fillStyle = '#dc004e';
    ctx.fillRect(0, 0, 700, 20);
    return bitmap.toDataURL().split(',')[1];
  });
  await canvas.evaluate((element, encoded) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    transfer.items.add(new File([bytes], 'placed.png', { type: 'image/png' }));
    const { x, y, width, height } = element.getBoundingClientRect();
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true,
      clientX: x + width / 2, clientY: y + height / 2 }));
  }, payload);
  await expect.poll(async () => (await savedProject(page)).spreads[0].elements.length).toBe(1);

  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: 'Replace Photo', exact: true })).toBeVisible();
  const picker = page.locator('input[accept="image/*,.psd,.psb"]');
  await picker.setInputFiles({ name: 'transparent.png', mimeType: 'image/png', buffer: Buffer.from(payload, 'base64') });
  await expect.poll(async () => (await savedProject(page)).spreads[0].elements[0].name).toBe('transparent.png');
  const image = (await savedProject(page)).spreads[0].elements[0];
  expect(image.proxySrc).toMatch(/^data:image\/png;base64,/);
  expect(image.originalWidth).toBe(1400);
  const alpha = await page.evaluate(async source => {
    const preview = new Image();
    preview.src = source;
    await preview.decode();
    const sample = document.createElement('canvas');
    const ctx = sample.getContext('2d')!;
    ctx.drawImage(preview, 1 - preview.width, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  }, image.proxySrc);
  expect(alpha).toBe(0);

  await picker.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(page.getByRole('alert').filter({ hasText: 'Could not read this image' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('recto_project_autosave') || '{}');
    return saved.spreads?.[0]?.elements?.[0]?.name;
  })).toBe('transparent.png');
  await page.reload();
  await expect(page.getByTitle('Click to rename document')).toHaveValue(project.settings.title);
  expect((await savedProject(page)).spreads[0].elements[0]).toMatchObject({ name: 'transparent.png', src: image.src });
});

test('preserves a Data Merge draft across closing and reopening the dialog', async ({ page }) => {
  const project = projectFixture();
  project.spreads[0].elements[0].text = '{{Title}}';
  await importProject(page, project);
  const open = () => menuCommand(page, 'Batch populate records via CSV dataset');
  const dialog = page.getByRole('dialog', { name: 'CSV / JSON Data Merge' });
  const input = dialog.getByPlaceholder('Paste CSV data here with header row...');
  const csv = 'Title\nFirst record\nSecond record';
  await open();
  await input.fill(csv);
  await expect(dialog.getByRole('button', { name: 'Generate Merged Spreads (2)' })).toBeEnabled();
  await input.press('Escape');
  await expect(dialog).toBeHidden();
  await open();
  await expect(input).toHaveValue(csv);
  await dialog.getByRole('button', { name: 'Generate Merged Spreads (2)' }).click();
  await expect(dialog).toBeHidden();
  expect((await savedProject(page)).spreads.map((spread: typeof project.spreads[number]) => spread.elements[0].text))
    .toEqual(['{{Title}}', 'First record', 'Second record']);
});

test('saves editable image and vector effects through the inspector', async ({ page }) => {
  const imageProject = projectFixture();
  const photo = imageProject.spreads[0].elements[0];
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL();
  });
  Object.assign(photo, { type: 'image', src: source, fitMode: 'fit' });
  await importProject(page, imageProject);
  await page.getByText('Image adjustments', { exact: true }).click();
  await page.getByLabel('Grayscale', { exact: true }).check();
  const edited = (await savedProject(page)).spreads[0].elements[0];
  expect(edited.adjustments.grayscale).toBe(true);
  expect(edited.src).toBe(source);

  const shapeProject = projectFixture();
  shapeProject.settings.title = 'Vector effects';
  Object.assign(shapeProject.spreads[0].elements[0], { type: 'shape', shapeKind: 'rectangle', fillColor: '#ebebeb',
    strokeColor: '#111111', strokeWidthMm: 1, strokeDash: 'solid' });
  await importProject(page, shapeProject);
  await page.getByText('Vector fills and strokes', { exact: true }).click();
  await page.getByLabel('Vector fill', { exact: true }).selectOption('mesh');
  await page.getByRole('button', { name: 'Start CMYK mesh' }).click();
  await page.getByLabel('Patterned stroke', { exact: true }).check();
  const decorated = (await savedProject(page)).spreads[0].elements[0];
  expect(decorated.decoration).toMatchObject({ kind: 'mesh', columns: 2, rows: 2 });
  expect(decorated.decoration.colors[0]).toMatch(/^cmyk\(/);
  expect(decorated.strokePattern).toEqual({ dash: 3, gap: 2 });
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
  await page.getByRole('button', { name: 'Preview font replacement' }).click();
  await expect(page.getByText('Affected document pages: 1.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preflight change preview' })).toBeVisible();
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
