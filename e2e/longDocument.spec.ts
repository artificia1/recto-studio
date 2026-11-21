import { test, expect } from '@playwright/test';
import { projectFileInput, projectFixture, savedProject } from './fixtures';

test('keeps a 256-page overview bounded and preserves editable text', async ({ page }) => {
  test.setTimeout(120000);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = projectFixture();
  project.settings.title = 'Long document navigation';
  const paragraph = 'The manuscript remains editable while its page preview is reused. '.repeat(70);
  project.spreads = Array.from({ length: 256 }, (_, index) => ({
    id: `spread-${index}`, spreadIndex: index,
    pages: [{ id: `page-${index}`, pageNumber: index + 1, side: 'single' }],
    elements: [{ ...project.spreads[0].elements[0], id: `text-${index}`, pageId: `page-${index}`,
      x: 20, y: 20, width: 170, height: 250, fontFamily: 'Times New Roman, serif', fontSizePt: 11,
      text: paragraph, storyContent: { version: 1, paragraphs: [{ runs: [{ text: paragraph }] }] } }],
  }));
  await page.goto('/');
  await projectFileInput(page).setInputFiles({ name: 'long.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByTitle('Click to rename document')).toHaveValue(project.settings.title);
  await page.getByRole('button', { name: 'All spreads', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Multi-spread workspace' });
  const firstImage = workspace.locator('[data-workspace-object="text-0"] image');
  await expect(firstImage).toBeVisible();
  const source = await firstImage.getAttribute('href');
  expect(source).toMatch(/^data:image\/png;base64,/);
  const scroll = workspace.locator('.spatial-scroll');
  for (const top of [20, 40, 60]) {
    await scroll.evaluate((element, top) => { element.scrollTop = top; element.dispatchEvent(new Event('scroll')); }, top);
    await expect(firstImage).toHaveAttribute('href', source!);
  }
  expect(await workspace.locator('[data-workspace-object]').count()).toBeLessThan(128);
  expect(await workspace.locator('svg *').count()).toBeLessThan(3000);
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(workspace.locator('[data-workspace-page="page-255"]')).toBeAttached();
  await page.getByRole('button', { name: 'Return to spread editor' }).click();
  const saved = await savedProject(page);
  expect(saved.spreads).toHaveLength(256);
  expect(saved.spreads[255].elements[0].storyContent.paragraphs[0].runs[0].text).toBe(paragraph);
  expect(errors).toEqual([]);
});
