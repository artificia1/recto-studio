import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { importProject, projectFixture } from './fixtures';

// Fonts installed on the machine running the test differ, so the test asks the browser which
// ones there are instead of naming any.
test.beforeEach(async ({ context, baseURL }) => {
  await context.grantPermissions(['local-fonts'], { origin: baseURL });
});

async function installedFamilies(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const faces: { family: string; fullName: string }[] = await (window as any).queryLocalFonts();
    return [...new Set(faces.map(face => face.family))].sort();
  });
}

test('loads a font installed on the computer into a text frame', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  const families = await installedFamilies(page);
  test.skip(!families.length, 'No fonts are installed where this test runs.');

  await page.evaluate(() => (window as any).recto.stateManager.selectElement('text-qa'));
  const open = page.getByRole('button', { name: 'Fonts on this computer…' });
  await open.scrollIntoViewIfNeeded();
  await open.click();
  const picker = page.getByRole('dialog', { name: 'Fonts on this computer' });
  await expect(picker.getByText(`${families.length} of ${families.length} families`, { exact: false })).toBeVisible();
  await expect(picker.getByText('copies its font file into this project', { exact: false })).toBeVisible();

  await picker.getByRole('searchbox').fill(families[0]);
  await picker.locator('li > button', { has: page.getByText(families[0], { exact: true }) }).click();
  await picker.locator('li div button').first().click();
  await expect(picker).toHaveCount(0);

  const frame = await page.evaluate(() => {
    const { stateManager } = (window as any).recto;
    return { font: stateManager.getElementById('text-qa').fontFamily as string,
      embedded: (stateManager.getState().embeddedFonts || []).map((asset: { family: string }) => asset.family) as string[] };
  });
  expect(frame.font.startsWith(families[0])).toBe(true);
  expect(frame.embedded).toContain(frame.font);
});

test('finds a missing document font among the fonts on the computer', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  const families = await installedFamilies(page);
  test.skip(!families.length, 'No fonts are installed where this test runs.');
  const project = projectFixture();
  const installed = families[families.length - 1];
  project.spreads[0].elements[0] = { ...project.spreads[0].elements[0], fontFamily: installed };
  project.spreads[0].elements.push({ ...project.spreads[0].elements[0], id: 'text-missing', y: 150, fontFamily: 'No Such Font Recto' });
  await importProject(page, project);

  await page.getByText('Links', { exact: true }).first().click();
  await page.getByText('Document fonts & replacement').click();
  const panel = page.locator('details', { hasText: 'Document fonts & replacement' });

  await panel.getByRole('button', { name: `Find ${installed} on this computer` }).click();
  await expect(panel.getByRole('status')).toContainText('on this computer and copied it into this project');
  await expect(panel.locator('.editorial-list li').filter({ hasText: installed }).first()).toContainText('font file loaded');

  await panel.getByRole('button', { name: 'Find No Such Font Recto on this computer' }).click();
  await expect(panel.getByRole('status')).toContainText('is not installed on this computer');
});

/** Replaces the browser's font list with one face whose file is given, or with an empty (refused) list. */
async function fakeInstalledFont(page: import('@playwright/test').Page, data?: string) {
  await page.addInitScript(data => {
    (window as any).queryLocalFonts = async () => data ? [{ family: 'Licence Test', style: 'Regular', fullName: 'Licence Test Regular',
      postscriptName: 'LicenceTest-Regular', blob: async () => new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))]) }] : [];
  }, data);
}

test('says when a chosen font may not be embedded in exports', async ({ page }) => {
  // OpenSans with the OS/2 fsType "restricted licence" bit set.
  const bytes = new Uint8Array(readFileSync('tests/fixtures/fonts/OpenSans-Regular.ttf'));
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < view.getUint16(4); index++) {
    if (view.getUint32(12 + index * 16) === 0x4f532f32) view.setUint16(view.getUint32(12 + index * 16 + 8) + 8, 0x0002);
  }
  await fakeInstalledFont(page, Buffer.from(bytes).toString('base64'));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  await page.evaluate(() => (window as any).recto.stateManager.selectElement('text-qa'));
  const open = page.getByRole('button', { name: 'Fonts on this computer…' });
  await open.scrollIntoViewIfNeeded();
  await open.click();
  const picker = page.getByRole('dialog', { name: 'Fonts on this computer' });
  await picker.getByRole('button', { name: /Licence Test/ }).click();
  await picker.getByRole('button', { name: 'Regular', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.local-font-notice')).toContainText('does not allow embedding');
  await expect(page.locator('.local-font-notice')).toContainText('EPUB and flipbook exports leave it out');
  const embedded = await page.evaluate(() => ((window as any).recto.stateManager.getState().embeddedFonts || []).length);
  expect(embedded).toBeGreaterThan(0);

  // The EPUB leaves the font out and says so once the file is saved.
  const message = new Promise<string>(resolve => page.once('dialog', dialog => { resolve(dialog.message()); void dialog.accept(); }));
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  const download = page.waitForEvent('download');
  await page.getByText('Export EPUB 3', { exact: true }).click();
  const epub = await readFile((await (await download).path())!);
  expect(await message).toMatch(/Please review:[\s\S]*Open Sans[\s\S]*left out of this export/);
  expect(epub.includes(Buffer.from('OEBPS/fonts/'))).toBe(false);
});

test('offers the font file import when access to the fonts is refused', async ({ page }) => {
  await fakeInstalledFont(page);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  await page.evaluate(() => (window as any).recto.stateManager.selectElement('text-qa'));
  const open = page.getByRole('button', { name: 'Fonts on this computer…' });
  await open.scrollIntoViewIfNeeded();
  await open.click();
  const picker = page.getByRole('dialog', { name: 'Fonts on this computer' });
  await expect(picker.getByRole('alert')).toContainText('import the font file instead');
  await expect(picker.getByText('Importing a font file (TTF, OTF, WOFF, WOFF2) works in every browser.')).toBeVisible();
  await expect(page.getByText('Import font: TTF, OTF, WOFF, WOFF2')).toBeVisible();
});
