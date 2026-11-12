import { expect, test } from '@playwright/test';

interface TestStateManager {
  createBlankProject(preset: 'A4', title: string, facingPages: boolean): void;
  updateSettings(settings: { title: string }): void;
  autosave: { flush(): Promise<void> };
}

test('desktop recovery resumes the latest document and retains earlier unsaved work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {} });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => 'recto' in window);

  await page.evaluate(async () => {
    const { stateManager } = (window as Window & { recto?: { stateManager: TestStateManager } }).recto!;
    stateManager.createBlankProject('A4', 'Magazine draft', false);
    stateManager.updateSettings({ title: 'Magazine with unsaved edits' });
    // Switch before the normal autosave debounce to cover the outgoing flush.
    stateManager.createBlankProject('A4', 'Book draft', false);
    stateManager.updateSettings({ title: 'Book with unsaved edits' });
    await stateManager.autosave.flush();
  });
  await page.reload();
  const title = page.getByTitle('Click to rename document');
  await expect(title).toHaveValue('Book with unsaved edits');

  const openRecovery = async () => {
    await page.getByTitle('File Management, Project IO, and Document Imports').click();
    await page.getByRole('button', { name: /^Recover Unsaved Projects/ }).click();
  };
  const recovery = page.getByRole('dialog', { name: 'Project Recovery' });
  await openRecovery();
  await expect(recovery.getByRole('listitem')).toHaveCount(2);
  await recovery.getByRole('button', { name: 'Discard checkpoint for Book with unsaved edits' }).click();
  await recovery.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(recovery.getByRole('listitem')).toHaveCount(1);
  await recovery.getByRole('button', { name: 'Recover Magazine with unsaved edits' }).click();
  await expect(recovery).toBeHidden();
  await expect(title).toHaveValue('Magazine with unsaved edits');
});
