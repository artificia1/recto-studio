import { expect, test } from '@playwright/test';
import { projectFileInput, projectFixture, savedProject } from './fixtures';

test('finds placed images by filename and combines search with their link status', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');

  const fixture = projectFixture();
  const spread = fixture.spreads[0];
  const base = {
    pageId: spread.pages[0].id, type: 'image', x: 20, y: 25, width: 40, height: 40,
    rotation: 0, opacity: 1, locked: false, zIndex: 0, fitMode: 'fit',
    borderColor: 'transparent', borderWidthMm: 0,
  };
  const project = {
    ...fixture, selectedElementId: null, selectedElementIds: [],
    spreads: [{ ...spread, elements: [
      { ...base, id: 'cover', name: 'Cover mark.svg', format: 'SVG',
        src: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%2F%3E%3C%2Fsvg%3E' },
      { ...base, x: 70, id: 'missing', name: 'Author portrait.jpg', format: 'JPG', src: '' },
      { ...base, x: 120, id: 'sample', name: 'Proof photo.png', format: 'PNG', originalWidth: 1, originalHeight: 1,
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    ] }],
  };
  await projectFileInput(page).setInputFiles({
    name: 'asset-filter.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTitle('Click to rename document')).toHaveValue(fixture.settings.title);
  await page.getByRole('button', { name: 'Links', exact: true }).click();

  const panel = page.locator('.links-panel');
  const filename = panel.getByRole('searchbox', { name: 'Search filenames' });
  const filter = panel.getByRole('combobox', { name: 'Status', exact: true });
  const count = panel.locator('.placed-assets-heading').getByRole('status');
  const reset = panel.getByRole('button', { name: 'Clear filters', exact: true });
  await expect(count).toHaveText('3 of 3 shown');
  await expect(reset).toBeDisabled();

  await filename.fill(' COVER ');
  await expect(count).toHaveText('1 of 3 shown');
  await expect(panel.getByText('Cover mark.svg', { exact: true })).toBeVisible();
  await filter.selectOption('missing');
  await expect(count).toHaveText('0 of 3 shown');
  await expect(panel.getByText('No assets match your search and status filter.')).toBeVisible();

  await filename.fill('');
  await expect(count).toHaveText('1 of 3 shown');
  await expect(panel.getByText('Author portrait.jpg', { exact: true })).toBeVisible();
  await expect(panel.getByText('Missing image source', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Relink...', exact: true })).toBeVisible();

  await filter.selectOption('warning');
  await expect(count).toHaveText('1 of 3 shown');
  await expect(panel.getByText('Proof photo.png', { exact: true })).toBeVisible();
  await reset.click();
  await expect(count).toHaveText('3 of 3 shown');
  await expect(filter).toHaveValue('all');
});

test('previews bulk relink conflicts and restores all applied sources with one undo', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');

  const fixture = projectFixture();
  const spread = fixture.spreads[0];
  const base = {
    pageId: spread.pages[0].id, type: 'image', x: 25, y: 30, width: 40, height: 35,
    rotation: 12, opacity: 1, locked: false, zIndex: 0, fitMode: 'fit',
    src: '', borderColor: 'transparent', borderWidthMm: 0,
  };
  const elements = [
    { ...base, id: 'cover', name: 'Cover.svg', caption: 'A custom caption' },
    { ...base, id: 'logo', name: 'Logo.svg', x: 75 },
    { ...base, id: 'locked-logo', name: 'Logo.svg', x: 125, locked: true },
    { ...base, id: 'ambiguous', name: 'Photo.svg', y: 85 },
  ];
  await projectFileInput(page).setInputFiles({
    name: 'bulk-relink.recto', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...fixture, spreads: [{ ...spread, elements }], selectedElementId: null, selectedElementIds: [] })),
  });
  const title = page.getByTitle('Click to rename document');
  await expect(title).toHaveValue(fixture.settings.title);
  await page.getByRole('button', { name: 'Links', exact: true }).click();

  const picker = page.getByLabel('Bulk relink files', { exact: true });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" /></svg>');
  const files = ['COVER.svg', 'Logo.svg', 'photo.svg', 'PHOTO.SVG', 'Unused.svg']
    .map(name => ({ name, mimeType: 'image/svg+xml', buffer: svg }));
  const review = page.getByRole('region', { name: 'Bulk relink review' });
  const apply = review.getByRole('button', { name: 'Apply 2 replacements' });
  const readImages = async () => (await savedProject(page)).spreads[0].elements;

  await picker.setInputFiles(files);
  await expect(review.getByText('More than one selected file has this name.')).toHaveCount(2);
  await expect(review.getByText('1 locked frame skipped')).toBeVisible();
  await expect(review.getByText('No placed image has this filename.')).toBeVisible();
  await review.getByRole('button', { name: 'Cancel bulk relink' }).click();
  expect((await readImages()).map(({ src }: { src: string }) => src)).toEqual(['', '', '', '']);

  await picker.setInputFiles(files);
  await expect(apply).toBeEnabled();
  await title.fill('Bulk relink proof');
  await title.press('Enter');
  await expect(apply).toBeDisabled();
  await expect(review.getByText('The document changed. Select the replacements again.')).toBeVisible();

  await picker.setInputFiles(files);
  await apply.click();
  await expect(page.getByText('Relinked 2 image frames.')).toBeVisible();
  const applied = await readImages();
  expect(applied[0]).toMatchObject({
    src: expect.stringMatching(/^data:image\/svg\+xml/), caption: 'A custom caption',
    x: base.x, y: base.y, width: base.width, height: base.height, rotation: base.rotation,
  });
  expect(applied[1].src).toMatch(/^data:image\/svg\+xml/);
  expect(applied[2].src).toBe('');
  expect(applied[3].src).toBe('');
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  expect((await readImages()).map(({ src }: { src: string }) => src)).toEqual(['', '', '', '']);
});
