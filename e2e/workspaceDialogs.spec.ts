import { expect, test } from '@playwright/test';
import { contrastRatio } from './contrast';
import { menuCommand } from './fixtures';

test('workspace dialogs follow the light theme and keep their controls readable', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');

  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const appearance = page.getByRole('dialog', { name: 'Appearance' });
  await appearance.getByRole('button', { name: 'Light Soft white' }).click();
  await appearance.getByRole('button', { name: 'Close Appearance' }).click();

  const historyButton = page.getByTitle('Local-First Git Version Snapshots & Checkpoints');
  await historyButton.click();
  const history = page.getByRole('dialog', { name: 'Version History & Snapshots' });
  await expect(history).toHaveCSS('background-color', 'rgb(246, 248, 251)');
  const description = history.getByRole('textbox', { name: 'Snapshot description' });
  await description.fill('Cover revisions');
  await description.press('Enter');
  const snapshot = history.getByRole('button', { name: /Cover revisions/ });
  await expect(snapshot).toHaveAttribute('aria-pressed', 'true');
  const snapshotContrast = await snapshot.evaluate(button => {
    const { color, backgroundColor } = getComputedStyle(button);
    return [color, backgroundColor] as const;
  });
  expect(contrastRatio(...snapshotContrast)).toBeGreaterThanOrEqual(4.5);
  await snapshot.press('Escape');
  await expect(history).toBeHidden();
  await expect(historyButton).toBeFocused();

  await menuCommand(page, 'Batch populate records via CSV dataset');
  const merge = page.getByRole('dialog', { name: 'CSV / JSON Data Merge' });
  await expect(merge).toHaveCSS('background-color', 'rgb(246, 248, 251)');
  const data = merge.getByRole('textbox', { name: 'CSV or JSON data' });
  await expect(data).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await merge.getByRole('button', { name: 'Load Sample CSV' }).click();
  await expect(merge.getByText(/Detected 3 records/)).toBeVisible();
  await data.press('Escape');
  await expect(merge).toBeHidden();
});
