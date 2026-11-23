import { expect, test, type Locator } from '@playwright/test';
import { contrastRatio } from './contrast';
import { importProject, menuCommand, projectFixture } from './fixtures';

async function expectReadable(text: Locator, surface: Locator = text) {
  const foreground = await text.evaluate(element => getComputedStyle(element).color);
  const background = await surface.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
}

test('preflight groups stay readable and inside a narrow light workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('recto_appearance', JSON.stringify({ theme: 'light', buttonStyle: 'minimal' }));
  });
  await page.goto('/');

  const project = projectFixture();
  const frames = project.spreads[0].elements;
  frames[0].x = 2;
  frames.push({ ...frames[0], id: 'second-trim-frame', y: 126 });
  await importProject(page, project);
  await page.getByRole('button', { name: /^Preflight: / }).click();
  const audit = page.getByRole('region', { name: 'Print Preflight Audit' });
  await expect(audit).toBeInViewport({ ratio: 1 });
  await expect(audit).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const group = audit.getByText(/TRIM_HAZARD · 2 findings/);
  await expectReadable(group, audit);
  await group.click();
  await expectReadable(audit.locator('.preflight-group-message'), audit);
  await expect(audit.getByRole('button', { name: /Page 1 · Spread 1/ })).toHaveCount(2);
});

test('preflight pages large finding groups and still locates the last frame', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  const project = projectFixture();
  const frame = project.spreads[0].elements[0];
  project.spreads[0].elements = Array.from({ length: 85 }, (_, index) => ({ ...frame, id: `trim-frame-${index}`, x: 2 }));
  await importProject(page, project);
  await page.getByRole('button', { name: /^Preflight: / }).click();
  const audit = page.getByRole('region', { name: 'Print Preflight Audit' });
  const summary = audit.getByText(/TRIM_HAZARD · 85 findings/);
  const group = audit.locator('details').filter({ hasText: /TRIM_HAZARD · 85 findings/ });
  await expect(group.locator('.preflight-item')).toHaveCount(0);
  await summary.click();
  await expect(group.locator('.preflight-item')).toHaveCount(40);
  await group.getByRole('button', { name: 'Next findings' }).click();
  await group.getByRole('button', { name: 'Next findings' }).click();
  await expect(group.locator('.preflight-item')).toHaveCount(5);
  await group.locator('.preflight-item-locate').last().click();
  const selected = await page.evaluate(() => (window as unknown as { recto: { stateManager: {
    getState(): { selectedElementId: string | null };
  } } }).recto.stateManager.getState().selectedElementId);
  expect(selected).toBe('trim-frame-84');
});

for (const [theme, inputBackground] of [['light', 'rgb(255, 255, 255)'], ['oled', 'rgb(11, 11, 13)']] as const) {
  test(`the ${theme} Story Editor keeps manuscript text and Minimal controls readable`, async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.addInitScript(theme => {
      localStorage.setItem('recto_appearance', JSON.stringify({ theme, buttonStyle: 'minimal' }));
    }, theme);
    await page.goto('/');
    await importProject(page);
    await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');

    const editor = page.getByRole('dialog', { name: 'Story Editor' });
    const manuscript = editor.getByRole('textbox', { name: 'Story manuscript' });
    await expect(manuscript).toHaveValue('Browser workflow sample');
    await expect(manuscript).toHaveCSS('background-color', inputBackground);
    await expectReadable(manuscript);
    const increaseSize = editor.getByRole('button', { name: 'Increase editor text size' });
    await expectReadable(increaseSize, editor.locator('header'));
    await increaseSize.click();
    await expect(manuscript).toHaveCSS('font-size', '18px');
    await manuscript.press('Escape');
    await expect(editor).toBeHidden();
  });
}
