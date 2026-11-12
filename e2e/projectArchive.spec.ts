import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importProject, projectFileInput, projectFixture, savedProject } from './fixtures';

test('reopens an editable project archive and rejects a truncated archive', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  const fixture = projectFixture();
  fixture.settings.title = 'Archive source';
  const main = fixture.spreads[0].elements[0];
  const teacherFrame = { ...main, id: 'teacher-text', text: 'Teacher notes', conditionId: 'cond-teacher' };
  const privateFrame = { ...main, id: 'private-text', text: 'Print exclusion', nonprinting: true };
  await importProject(page, {
    ...fixture,
    spreads: [{ ...fixture.spreads[0], elements: [main, teacherFrame, privateFrame] }],
  });

  await page.getByTitle(/^Export Clean PDF, Print PDF/).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Editable Project Archive', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.rectoarchive$/);
  const archive = await readFile((await download.path())!);

  await importProject(page);
  await page.getByTitle('File Management, Project IO, and Document Imports').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Open Project/ }).click();
  const chooser = await chooserPromise;
  expect((await chooser.element().getAttribute('accept'))?.split(',')).toContain('.rectoarchive');
  await chooser.setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: archive });
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Archive source');

  const dialogPromise = page.waitForEvent('dialog');
  const invalidUpload = projectFileInput(page).setInputFiles({
    name: 'truncated.rectoarchive', mimeType: 'application/zip', buffer: archive.subarray(0, 20),
  });
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Could not open this project');
  await dialog.accept();
  await invalidUpload;
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Archive source');

  const restored = await savedProject(page);
  expect(restored.conditions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cond-teacher', visible: false })]));
  expect(restored.spreads[0].elements).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: main.id, text: main.text }),
    expect.objectContaining({ id: teacherFrame.id, text: teacherFrame.text, conditionId: teacherFrame.conditionId }),
    expect.objectContaining({ id: privateFrame.id, text: privateFrame.text, nonprinting: true }),
  ]));
});
