import { expect, test } from '@playwright/test';
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
  await expect(panel.getByRole('status')).toContainText('on this computer and loaded it');
  await expect(panel.locator('.editorial-list li').filter({ hasText: installed }).first()).toContainText('font file loaded');

  await panel.getByRole('button', { name: 'Find No Such Font Recto on this computer' }).click();
  await expect(panel.getByRole('status')).toContainText('is not installed on this computer');
});
