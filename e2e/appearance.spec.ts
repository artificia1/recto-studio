import { expect, test } from '@playwright/test';
import { importProject, savedProject } from './fixtures';

test('workspace appearance follows saved preferences without changing the project', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  const project = await savedProject(page);
  const root = page.locator('html');
  const toolbar = page.locator('.top-bar');
  const settings = page.locator('.appearance-panel');
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Setup', exact: true }).click();
    await settings.getByText('Workspace appearance', { exact: true }).click();
  };

  await openSettings();
  await settings.getByRole('button', { name: 'Paper' }).click();
  await settings.getByRole('button', { name: 'Jade' }).click();
  await settings.getByLabel('Spread pasteboard').selectOption('gray');
  await settings.getByRole('checkbox', { name: 'Compact controls' }).check();
  await expect(toolbar).toHaveCSS('background-color', 'rgb(246, 248, 251)');
  await expect(root).toHaveAttribute('data-accent', 'jade');
  await expect(root).toHaveAttribute('data-density', 'compact');
  await expect(toolbar.getByTitle('Save .recto project to disk (Ctrl+S)')).toHaveCSS('height', '25px');
  const themed = await savedProject(page);
  expect(themed.settings).toEqual(project.settings);
  expect(themed.spreads).toEqual(project.spreads);

  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveAttribute('data-accent', 'jade');
  await expect(root).toHaveAttribute('data-density', 'compact');
  await openSettings();
  await expect(settings.getByRole('button', { name: 'Paper' })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByLabel('Spread pasteboard')).toHaveValue('gray');

  await page.emulateMedia({ colorScheme: 'light' });
  await settings.getByRole('button', { name: 'System' }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await settings.getByRole('button', { name: 'Midnight' }).click();
  await expect(toolbar).toHaveCSS('background-color', 'rgb(26, 35, 52)');
  await settings.getByRole('button', { name: 'Reset' }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveAttribute('data-accent', 'blue');
  await expect(root).toHaveAttribute('data-density', 'default');

  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Quick Apply' });
  const search = palette.getByRole('combobox');
  await expect(search).toBeFocused();
  await search.fill('theme midnight');
  const match = palette.getByRole('option', { name: /Use Midnight theme/ });
  await expect(match).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(palette).toBeHidden();
  await expect(root).toHaveAttribute('data-theme', 'midnight');
  await expect(settings.getByRole('button', { name: 'Midnight' })).toHaveAttribute('aria-pressed', 'true');
});
