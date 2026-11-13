import { expect, test, type Locator } from '@playwright/test';
import { contrastRatio } from './contrast';
import { importProject } from './fixtures';

async function expectReadableControl(control: Locator, fallbackSurface?: string) {
  const { foreground, background, gradient } = await control.evaluate(element => {
    const { color, backgroundColor, backgroundImage } = getComputedStyle(element);
    return { foreground: color, background: backgroundColor, gradient: backgroundImage };
  });
  const gradientStops = gradient.match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g);
  const surfaces = gradientStops ?? [background === 'rgba(0, 0, 0, 0)' && fallbackSurface ? fallbackSurface : background];
  for (const surface of surfaces) expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.5);
}

test('native color input previews a drag locally and saves the final color once', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.addInitScript(() => {
    if (!localStorage.getItem('recto_appearance')) {
      localStorage.setItem('recto_appearance', JSON.stringify({ theme: 'oled', buttonStyle: 'glass' }));
    }
  });
  await page.goto('/');
  await importProject(page);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Appearance' });
  const picker = popup.getByLabel('Pick a custom accent color');
  const hex = popup.getByRole('textbox', { name: 'Custom hex' });
  await expect(popup.locator('.appearance-accent-preview')).toBeVisible();
  const initialHex = await hex.inputValue();
  const finalHex = '#e88c1a';

  const result = await picker.evaluate(async (control: HTMLInputElement, finalHex) => {
    const root = document.documentElement;
    const context = document.querySelector<HTMLCanvasElement>('#spread-canvas')!.getContext('2d')!;
    const popup = control.closest('[role="dialog"]')!;
    const sample = popup.querySelector<HTMLElement>('.appearance-accent-preview')!;
    const saved = () => localStorage.getItem('recto_appearance');
    const rootAccent = () => [root.dataset.accent, root.style.getPropertyValue('--custom-accent')];
    const originalSaved = saved();
    const originalAccent = rootAccent();
    const originalSetItem = Storage.prototype.setItem;
    const originalFillRect = context.fillRect;
    const preferenceWrites: string[] = [];
    let spreadPaints = 0;
    let previewUpdates = 0;
    const previewObserver = new MutationObserver(records => { previewUpdates += records.length; });
    previewObserver.observe(sample, { attributes: true, attributeFilter: ['style'] });
    Storage.prototype.setItem = function (key: string, value: string) {
      if (this === localStorage && key === 'recto_appearance') preferenceWrites.push(value);
      originalSetItem.call(this, key, value);
    };
    context.fillRect = function (...args) {
      spreadPaints++;
      originalFillRect.apply(this, args);
    };
    const waitForPaint = () => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    try {
      // Native picker movements emit repeated input events before the change event.
      const colors = [...Array.from({ length: 30 }, (_, index) => `#12${(index + 64).toString(16)}82`), finalHex];
      for (const color of colors) {
        control.value = color;
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await waitForPaint();
      const preview = {
        hex: popup.querySelector<HTMLInputElement>('input[type="text"]')?.value,
        color: sample.style.getPropertyValue('--preview-color'),
        updates: previewUpdates,
        rootUnchanged: JSON.stringify(rootAccent()) === JSON.stringify(originalAccent),
        storageUnchanged: saved() === originalSaved,
        writes: preferenceWrites.length,
      };
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForPaint();
      return {
        preview,
        spreadPaints,
        persisted: preferenceWrites.map(value => JSON.parse(value).customAccent),
      };
    } finally {
      previewObserver.disconnect();
      Storage.prototype.setItem = originalSetItem;
      context.fillRect = originalFillRect;
    }
  }, finalHex);

  expect(initialHex).not.toBe(finalHex);
  expect(result.preview).toEqual({
    hex: finalHex, color: finalHex, updates: 1, rootUnchanged: true, storageUnchanged: true, writes: 0,
  });
  expect(result.persisted).toEqual([finalHex]);
  expect(result.spreadPaints).toBe(0);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'custom');
  await expect(page.locator('html')).toHaveCSS('--custom-accent', finalHex);
  await expect(popup.getByRole('button', { name: `Use recent color ${finalHex}`, exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'oled');
  await expect(page.locator('html')).toHaveAttribute('data-buttons', 'glass');
  await expect(page.locator('html')).toHaveCSS('--custom-accent', finalHex);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(picker).toHaveValue(finalHex);
  await expect(hex).toHaveValue(finalHex);
  const recent = popup.getByRole('button', { name: `Use recent color ${finalHex}`, exact: true });
  await expect(recent).toBeVisible();
  await popup.getByRole('button', { name: 'Jade', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'jade');
  await recent.click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'custom');
  await expect(page.locator('html')).toHaveCSS('--custom-accent', finalHex);
});

test('closing Appearance applies a pending custom color when the picker has not emitted change', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Appearance' });
  await popup.getByRole('button', { name: 'System Follows your device' }).click();
  await popup.getByRole('button', { name: /Minimal Quiet controls/ }).click();
  const picker = popup.getByLabel('Pick a custom accent color');
  await picker.evaluate((control: HTMLInputElement) => {
    control.value = '#23104a';
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await popup.getByRole('button', { name: 'Close Appearance' }).click();
  await expect(popup).toBeHidden();
  await expect(page.locator('html')).toHaveCSS('--custom-accent', '#23104a');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-buttons', 'minimal');
  await expect(page.locator('html')).toHaveCSS('--custom-accent', '#23104a');
});

for (const theme of ['dark', 'light', 'midnight', 'oled'] as const) {
  test(`toolbar controls remain readable in ${theme} with all three button styles`, async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.addInitScript(theme => {
      localStorage.setItem('recto_appearance', JSON.stringify({ theme, accent: 'custom', customAccent: '#fbffef' }));
    }, theme);
    await page.goto('/');
    const toolbar = page.locator('.top-bar');
    const settings = toolbar.getByRole('button', { name: 'Appearance', exact: true });
    const popup = page.getByRole('dialog', { name: 'Appearance' });
    const surface = await toolbar.evaluate(element => getComputedStyle(element).backgroundColor);
    const save = toolbar.getByTitle('Save .recto project to disk (Ctrl+S)');
    const exportPdf = toolbar.getByTitle('Export Clean Digital PDF (Exact Trim Dimensions)');

    for (const [style, label] of [['classic', /^Classic Solid/], ['minimal', /^Minimal Quiet/], ['glass', /^Glass Tinted/]] as const) {
      await settings.click();
      await popup.getByRole('button', { name: label }).click();
      await popup.getByRole('button', { name: 'Close Appearance' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-buttons', style);
      await page.mouse.move(0, 0);
      await expectReadableControl(save, surface);
      await expectReadableControl(exportPdf, surface);
      await exportPdf.hover();
      await expect(exportPdf).toHaveCSS('filter', 'none');
      await expectReadableControl(exportPdf, surface);
    }

    const file = toolbar.getByTitle('File Management, Project IO, and Document Imports');
    await file.click();
    const menu = toolbar.locator('.file-dropdown-menu');
    const action = menu.getByRole('button', { name: /^Open Project/ });
    await expect(action).toBeVisible();
    await page.mouse.move(0, 0);
    await expectReadableControl(file);
    await expectReadableControl(action, await menu.evaluate(element => getComputedStyle(element).backgroundColor));
    await file.click();

    await settings.click();
    await popup.getByRole('textbox', { name: 'Custom hex' }).fill('#000000');
    await popup.getByRole('button', { name: 'Close Appearance' }).click();
    await expect(page.locator('html')).toHaveCSS('--custom-accent', '#000000');
    const properties = page.locator('.inspector-tabs').getByRole('button', { name: 'Properties', exact: true });
    await expect(properties).toHaveAttribute('aria-pressed', 'true');
    await expectReadableControl(properties);
  });
}
