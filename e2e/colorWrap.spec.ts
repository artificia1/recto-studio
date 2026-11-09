import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importProject, projectFixture, savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/'); await expect(page.locator('#spread-canvas')).toBeVisible();
});

test('imports a real ICC profile, converts in a worker, saves it and exports managed PDF', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByText('ICC colour management', { exact: true }).click();
  await page.getByLabel('CMYK output ICC profile', { exact: true }).setInputFiles('tests/fixtures/icc/lcms-test-output.icc');
  await expect(page.getByText('Output profile loaded.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test ICC conversion', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /C [\d.]+% · M/ })).toBeVisible();
  await page.getByLabel('ICC rendering intent').selectOption('perceptual');
  const saved = await savedProject(page);
  expect(saved.settings.colorManagement.intent).toBe('perceptual');
  expect(saved.settings.colorManagement.outputProfile.data.length).toBeGreaterThan(1000);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const path = await (await download).path();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.7');
  expect(bytes.toString('latin1')).toContain('/OutputIntents [');
  await page.screenshot({ path: 'test-results/icc-panel.png', fullPage: true });
});

test('traces an image alpha outline and retains its wrap settings on save and undo', async ({ page }) => {
  const project = projectFixture();
  const png = await readFile('tests/fixtures/icc/alpha-sample.png');
  Object.assign(project.spreads[0].elements[0], { type: 'image', width: 100, height: 50,
    src: `data:image/png;base64,${png.toString('base64')}`, fitMode: 'fill' });
  await importProject(page, project);
  await page.getByText('Wrap around transparency', { exact: true }).click();
  await page.getByLabel('Wrap alpha threshold').fill('200');
  await page.getByRole('button', { name: 'Trace transparency', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /outline slices saved/ })).toBeVisible();
  const saved = await savedProject(page), image = saved.spreads[0].elements[0];
  expect(image.textWrap.mode).toBe('contour');
  expect(image.alphaContour).toEqual([{ minX: 0, maxX: 0.5 }]);
  expect(image.originalWidth).toBe(2); expect(image.originalHeight).toBe(1);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].alphaContour).toBeUndefined();
});

test('samples actual artwork for the separations preview and toggles individual plates', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByText('Separations preview', { exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Maximum [\d.]+%/ })).toBeVisible();
  const preview = page.getByLabel('Ink separations artwork preview');
  const before = await preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByLabel('Black', { exact: true }).uncheck();
  await expect.poll(async () => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(before);
  await page.getByLabel('Proof TAC threshold').fill('320');
  await page.getByLabel('Highlight excessive ink coverage').check();
  await expect(page.getByRole('status').filter({ hasText: /above 320%/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/ink-preview.png', fullPage: true });
});

test('does not apply a pending ICC import to a different document', async ({ page }) => {
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { arrived = resolve; });
  await page.context().route(/lcms[^/]*\.wasm/, async route => { arrived(); await gate; await route.continue(); });
  try {
    await importProject(page);
    await page.getByRole('button', { name: 'Setup', exact: true }).click();
    await page.getByText('ICC colour management', { exact: true }).click();
    await page.getByLabel('CMYK output ICC profile', { exact: true }).setInputFiles('tests/fixtures/icc/lcms-test-output.icc');
    await requested;
    const replacement = projectFixture(); replacement.settings.title = 'Replacement document';
    await importProject(page, replacement);
    release();
    await expect(page.getByRole('status').filter({ hasText: /document changed while the profile was loading/ })).toBeVisible();
    expect((await savedProject(page)).settings.colorManagement).toBeUndefined();
  } finally { release(); }
});
