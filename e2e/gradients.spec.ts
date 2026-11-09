import { expect, test } from '@playwright/test';
import { importProject, projectFixture, savedProject } from './fixtures';

test('edits gradient stops and converts the shape to an editable path', async ({ page }) => {
  await page.goto('./');
  const fixture = projectFixture();
  const shape = { id: 'text-qa', pageId: 'page-qa', type: 'shape', shapeKind: 'ellipse', x: 25, y: 35, width: 120, height: 70,
    rotation: 0, opacity: 1, zIndex: 1, locked: false, fillColor: '#224488', strokeColor: '#112233', strokeWidthMm: 0.25, strokeDash: 'solid' };
  fixture.spreads[0].elements = [shape] as unknown as typeof fixture.spreads[0]['elements'];
  await importProject(page, fixture);
  await page.getByText('Gradient fill', { exact: true }).click();
  await page.getByLabel('Fill type').selectOption('radial');
  await page.getByRole('button', { name: 'Add stop' }).click();
  await page.getByLabel('Stop 2 position (%)').fill('42');
  await page.getByLabel('Stop 2 position (%)').press('Tab');
  await page.getByRole('button', { name: 'Convert to editable path' }).click();
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0]).toMatchObject({ type: 'path', closed: true, nodes: expect.any(Array),
    fillGradient: { kind: 'radial', stops: [{ offset: 0 }, { offset: 0.42 }, { offset: 1 }] } });
});
