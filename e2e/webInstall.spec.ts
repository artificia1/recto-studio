import { expect, test } from '@playwright/test';
import { importProject, savedProject } from './fixtures';

test('opens the cached editor and a lazy tool offline without losing the publication', async ({ page, context, request }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#spread-canvas')).toBeVisible();
  await importProject(page);
  const manifest = await request.get('/manifest.webmanifest');
  expect(await manifest.json()).toMatchObject({ name: 'Recto Studio', start_url: './', scope: './', display: 'standalone' });
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

  const file = page.getByTitle('File Management, Project IO, and Document Imports');
  await file.click();
  await page.getByRole('button', { name: 'Install or use offline…' }).click();
  const guide = page.getByRole('dialog', { name: 'Install Recto Studio' });
  await guide.getByRole('button', { name: 'Enable offline access' }).click();
  await expect(guide.getByRole('status')).toHaveText('Ready to open offline.', { timeout: 30_000 });
  await page.evaluate(async () => {
    const editor = window as Window & { recto?: { stateManager: { autosave: { flush(): Promise<void> } } } };
    if (!editor.recto) throw new Error('Editor did not start.');
    await editor.recto.stateManager.autosave.flush();
  });
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await expect(file).toBeFocused();

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('#spread-canvas')).toBeVisible();
    await expect(page.getByTitle('Click to rename document')).toHaveValue('Browser QA document');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible();
    await page.getByRole('button', { name: 'Close Appearance' }).click();
    expect((await savedProject(page)).settings.title).toBe('Browser QA document');
  } finally {
    await context.setOffline(false);
  }
});
