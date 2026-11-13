import { expect, test } from '@playwright/test';
import { contrastRatio } from './contrast';

for (const theme of ['dark', 'light', 'oled'] as const) {
  test(`keeps the spread overview readable with ${theme} and minimal controls`, async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.addInitScript(theme => {
      localStorage.setItem('recto_appearance', JSON.stringify({ theme, buttonStyle: 'minimal' }));
    }, theme);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-buttons', 'minimal');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('#spread-canvas')).toBeVisible();

    const trigger = page.getByRole('button', { name: 'All spreads', exact: true });
    await expect(trigger).toBeVisible();
    const colors = await trigger.evaluate(element => {
      const style = getComputedStyle(element);
      return { ink: style.color, surface: style.backgroundColor };
    });
    expect(colors.surface).toMatch(/^rgb\(/);
    expect(contrastRatio(colors.ink, colors.surface)).toBeGreaterThanOrEqual(4.5);

    await trigger.click();
    const workspace = page.getByRole('dialog', { name: 'Multi-spread workspace' });
    await expect(workspace).toBeVisible();
    const overview = await workspace.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        ink: style.color,
        surface: style.backgroundColor,
        themeSurface: getComputedStyle(document.body).backgroundColor,
      };
    });
    expect(overview.surface).toBe(overview.themeSurface);
    expect(contrastRatio(overview.ink, overview.surface)).toBeGreaterThanOrEqual(4.5);

    await page.keyboard.press('Escape');
    await expect(workspace).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
