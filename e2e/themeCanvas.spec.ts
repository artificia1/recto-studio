import { expect, test } from '@playwright/test';
import { contrastRatio } from './contrast';
import { importProject, projectFixture } from './fixtures';

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
    const ruler = page.locator('#ruler-top');
    await expect.poll(() => ruler.evaluate(element => {
      const corner = document.querySelector('.ruler-corner')!;
      const color = getComputedStyle(corner).backgroundColor;
      const context = (element as HTMLCanvasElement).getContext('2d')!;
      const pixels = context.getImageData(0, 0, 16, 1).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 255 && `rgb(${pixels[i]}, ${pixels[i + 1]}, ${pixels[i + 2]})` === color) return true;
      }
      return false;
    })).toBe(true);

    const trigger = page.getByRole('button', { name: 'All spreads', exact: true });
    await expect(trigger).toBeVisible();
    const colors = await trigger.evaluate(element => {
      const style = getComputedStyle(element);
      return { ink: style.color, surface: style.backgroundColor };
    });
    expect(colors.surface).toMatch(/^rgb\(/);
    expect(contrastRatio(colors.ink, colors.surface)).toBeGreaterThanOrEqual(4.5);

    await trigger.press('Space');
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

test('all spreads reports an unavailable workspace chunk and leaves the editor usable', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.route(/\/assets\/SpatialWorkspace-[^/]+\.js$/, route => route.abort());
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'All spreads', exact: true });
  await trigger.click();
  const status = page.getByRole('dialog', { name: 'All spreads', exact: true });
  await expect(status.getByRole('alert')).toHaveText('All spreads could not be opened. Reload the app to try again.');
  await status.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(status).toBeHidden();
  await expect(page.locator('#spread-canvas')).toBeVisible();
  await page.getByTitle('File Management, Project IO, and Document Imports').click();
  await expect(page.getByRole('button', { name: /^Open Project/ })).toBeVisible();
});

test('all spreads stays clickable over an open inline text editor', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  const project = projectFixture();
  await importProject(page, project);

  await page.evaluate(() => {
    const { stateManager, spreadCanvas } = (window as any).recto;
    const button = document.querySelector('.workspace-map-toggle')!.getBoundingClientRect();
    const canvas = document.querySelector('#spread-canvas')!.getBoundingClientRect();
    const state = stateManager.getState();
    const frame = stateManager.getActiveSpread().elements[0];
    const scale = state.zoom * 96 / 25.4;
    const left = (canvas.width - state.settings.widthMm * scale) / 2;
    const top = (canvas.height - state.settings.heightMm * scale) / 2;
    stateManager.setZoomAndPan(state.zoom,
      button.left - canvas.left - left - frame.x * scale - 15,
      button.top - canvas.top - top - frame.y * scale - 5);
    spreadCanvas.openInlineTextEditor(frame.id);
  });
  const editor = page.locator('.canvas-inline-editor');
  await expect(editor).toBeFocused();
  await editor.fill('Text committed when opening All spreads');
  const trigger = page.getByRole('button', { name: 'All spreads', exact: true });
  const [buttonBounds, editorBounds] = await Promise.all([trigger.boundingBox(), editor.boundingBox()]);
  const x = buttonBounds!.x + buttonBounds!.width / 2;
  const y = buttonBounds!.y + buttonBounds!.height / 2;
  expect(x).toBeGreaterThan(editorBounds!.x);
  expect(y).toBeGreaterThan(editorBounds!.y);
  expect(x).toBeLessThan(editorBounds!.x + editorBounds!.width);
  expect(y).toBeLessThan(editorBounds!.y + editorBounds!.height);
  await page.mouse.click(x, y);
  await expect(page.getByRole('dialog', { name: 'Multi-spread workspace' })).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).recto.stateManager.getActiveSpread().elements[0].text))
    .toBe('Text committed when opening All spreads');
});
