import { expect, test } from '@playwright/test';
import { importProject, projectFixture } from './fixtures';

test('shows document measurements without a selection and opens page setup', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');

  const fixture = projectFixture();
  const project = {
    ...fixture,
    settings: {
      ...fixture.settings,
      preset: 'US-Letter',
      widthMm: 215.9,
      heightMm: 279.4,
      facingPages: false,
      bleedMm: 3,
      columnCount: 1,
    },
    selectedElementId: '',
    selectedElementIds: [],
  };
  await importProject(page, project);

  const overview = page.getByRole('region', { name: 'Document overview' });
  await expect(overview.getByRole('heading', { name: 'US Letter' })).toBeVisible();
  await expect(overview.getByText('215.9 × 279.4 mm')).toBeVisible();
  await expect(overview.getByText('1 · Single')).toBeVisible();
  await expect(overview.getByText('3 mm', { exact: true })).toBeVisible();
  await expect(overview.getByText('gutter')).toHaveCount(0);
  await overview.getByRole('button', { name: 'Page setup' }).click();
  await expect(page.getByText('PAGE TRIM & SPREAD SETUP', { exact: true })).toBeVisible();
  const setup = page.getByRole('button', { name: 'Setup', exact: true });
  await expect(setup).toHaveAttribute('aria-pressed', 'true');
  await expect(setup).toBeFocused();

  await importProject(page, fixture);
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(page.getByText('GEOMETRY & TRANSFORM', { exact: true })).toBeVisible();
  await expect(overview).toHaveCount(0);
});
