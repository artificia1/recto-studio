import { expect, test } from '@playwright/test';

test('desktop toolbar keeps the paper size and updater visible when the window narrows', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        async invoke(command: string) {
          if (command === 'plugin:updater|check') return null;
          throw new Error(`Unexpected desktop command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');

  const preset = page.getByTitle('Document Dimension Preset', { exact: true });
  const updater = page.getByRole('button', { name: 'Check for updates', exact: true });
  const status = page.locator('.app-updater').getByRole('status');

  await expect(preset).toHaveValue('A4');
  await updater.click();
  await expect(status).toBeVisible();

  for (const width of [1440, 1366, 1251, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(preset, `Paper size at ${width}px`).toBeInViewport({ ratio: 1 });
    await expect(updater, `Updater at ${width}px`).toBeInViewport({ ratio: 1 });
    await expect(status, `Update status at ${width}px`).toBeInViewport({ ratio: 1 });
    if (width >= 1366) {
      const toolbar = await page.locator('.top-bar').boundingBox();
      expect(toolbar?.height, `One toolbar row at ${width}px`).toBeLessThan(52);
      const presetBox = await preset.boundingBox();
      const updaterBox = await updater.boundingBox();
      expect(Math.abs(presetBox!.y - updaterBox!.y)).toBeLessThanOrEqual(4);
    }
  }

  await preset.selectOption('US-Letter');
  await expect(preset).toHaveValue('US-Letter');
  await page.getByTitle('File Management, Project IO, and Document Imports').click();
  const fileMenu = page.locator('.file-dropdown-menu');
  await expect(fileMenu).toBeInViewport({ ratio: 1 });
  await expect(fileMenu.getByText('Open Project...', { exact: true })).toBeVisible();
});
