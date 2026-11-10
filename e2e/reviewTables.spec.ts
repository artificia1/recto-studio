import { test, expect } from '@playwright/test';
import { importProject, menuCommand, projectFixture, savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/'); await expect(page.locator('#spread-canvas')).toBeVisible();
});

test('proposes a manuscript edit, accepts it, undoes it and reviews it from Pages', async ({ page }) => {
  await importProject(page);
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  const editor = page.getByRole('textbox', { name: 'Story manuscript', exact: true });
  await editor.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(0, 7); element.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByText('Proposed revisions (0 pending)', { exact: true }).click();
  await page.getByRole('button', { name: 'Draft edit at selection' }).click();
  await page.getByLabel('Revision reviewer', { exact: true }).fill('Copy editor');
  await page.getByLabel('Proposed passage', { exact: true }).fill('Reviewed');
  await page.getByRole('button', { name: 'Submit revision' }).click();
  await expect(editor).toHaveValue('Browser workflow sample');
  await expect(page.getByText('Proposed revisions (1 pending)', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/revision-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Accept revision' }).click();
  await expect(editor).toHaveValue('Reviewed workflow sample');
  await editor.press('Escape');
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  const restored = await savedProject(page);
  expect(restored.storyRevisions[0].status).toBe('pending');
  expect(restored.spreads[0].elements[0].text).toBe('Browser workflow sample');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Manuscript revisions (1 pending)', { exact: true }).click();
  await page.getByRole('button', { name: 'Review manuscript', exact: true }).click();
  await expect(editor).toHaveValue('Browser workflow sample');
  await page.getByRole('dialog', { name: 'Story Editor', exact: true }).getByRole('button', { name: 'Reject revision', exact: true }).click();
  await expect(page.getByText('Proposed revisions (0 pending)', { exact: true })).toBeVisible();
});

test('tracks typing as an inline proposal until the change is accepted', async ({ page }) => {
  await importProject(page);
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  const dialog = page.getByRole('dialog', { name: 'Story Editor' });
  const editor = dialog.getByRole('textbox', { name: 'Story manuscript' });
  await expect(editor).toHaveValue('Browser workflow sample');
  await dialog.getByLabel('Track manuscript edits').check();
  await dialog.getByLabel('Reviewer', { exact: true }).fill('Editor');
  await editor.fill('Updated workflow sample');
  await expect(dialog.getByLabel('Tracked changes preview').locator('del')).toHaveText('Browser');
  await expect(dialog.getByLabel('Tracked changes preview').locator('ins')).toHaveText('Updated');
  await dialog.getByRole('button', { name: 'Save tracked edit for review' }).click();
  await expect(editor).toHaveValue('Browser workflow sample');
  await dialog.getByText('Proposed revisions (1 pending)', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Accept revision', exact: true }).click();
  await expect(editor).toHaveValue('Updated workflow sample');
});

test('fits table content, adds a continuation page, and edits source cells from that page', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.spreads[0].elements[0], { type: 'table', width: 140, height: 28, rows: 6, cols: 1,
    fontFamily: 'Georgia, serif', fontSizePt: 10,
    cells: ['Header', 'Row one', 'Row two', 'Row three', 'Row four', 'Row five'].map(text => [{ text }]),
    headerRowCount: 1, headerFillColor: '#222222', headerTextColor: '#ffffff', borderWidthMm: 0.2, cellPaddingMm: 1 });
  await importProject(page, project);
  await page.getByText('Table continuation', { exact: true }).click();
  await page.getByLabel('Table row sizing').selectOption('content');
  await expect(page.getByRole('status').filter({ hasText: 'rows need more space' })).toBeVisible();
  await page.getByRole('button', { name: 'Add continuation page', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'All body rows fit.' })).toBeVisible();
  const beforeEdit = await savedProject(page);
  expect(beforeEdit.spreads).toHaveLength(2);
  expect(beforeEdit.spreads[0].elements[0].nextFrameId).toBe(beforeEdit.spreads[1].elements[0].id);
  await page.getByTitle('Row 2, Col 1: Row one', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Selected table cell text', exact: true }).fill('Edited from continuation');
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].cells[1][0].text).toBe('Edited from continuation');
  expect(saved.spreads[1].elements[0].cells[1][0].text).toBe('Edited from continuation');
  await page.screenshot({ path: 'test-results/table-continuation.png', fullPage: true });
});
