import { test, expect } from '@playwright/test';
import { importProject, savedProject } from './fixtures';
import { readFile } from 'node:fs/promises';

test('INDD offers conversion without silently replacing the document', async ({ page }) => {
  test.setTimeout(120000);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  const binary = Buffer.alloc(200);
  Buffer.from([6, 6, 237, 245, 216, 29, 70, 229, 189, 49, 239, 231, 254, 116, 183, 29]).copy(binary);
  Buffer.from('A recoverable manuscript paragraph.', 'utf16le').copy(binary, 64);
  await page.locator('input[accept=".recto,.papercut,.json,.idml,.indd"]').setInputFiles({
    name: 'sample.indd', mimeType: 'application/octet-stream', buffer: binary,
  });
  const modal = page.getByRole('dialog', { name: 'Open an InDesign document' });
  await expect(modal).toBeVisible();
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Browser QA document');
  const download = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Save IDML conversion kit…' }).click();
  const zip = await readFile((await (await download).path())!);
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  expect(zip.toString()).toContain('Recto-Export-IDML.jsx');
  await modal.getByText('Recover fragments without InDesign', { exact: true }).click();
  const recovery = modal.getByRole('button', { name: 'Recover content only', exact: true });
  await expect(recovery).toBeDisabled();
  await modal.getByLabel('Replace the current document with recovered content').check();
  await recovery.click();
  await expect(page.getByTitle('Click to rename document')).toHaveValue('sample (Recovered content)');
  const state = await savedProject(page);
  expect(state.spreads).toHaveLength(1);
  expect(state.spreads[0].elements.find((item: { id: string }) => item.id === 'indd-recovered-text').text).toContain('A recoverable manuscript paragraph.');
});
