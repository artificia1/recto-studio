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

  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(preset, `Paper size at ${width}px`).toBeInViewport({ ratio: 1 });
    await expect(updater, `Updater at ${width}px`).toBeInViewport({ ratio: 1 });
    await expect(status, `Update status at ${width}px`).toBeInViewport({ ratio: 1 });
  }

  await preset.selectOption('US-Letter');
  await expect(preset).toHaveValue('US-Letter');
});
