import { expect, test } from '@playwright/test';
import { projectFixture } from './fixtures';

interface NativeSave {
  handle: string | null;
  suggestedName: string;
  bytes: number[];
}

test('desktop Save follows the open file and Save As changes the target only on success', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.addInitScript(project => {
    const native = { saves: [] as NativeSave[], conflict: false, cancel: false };
    Object.assign(window, {
      native,
      __TAURI_INTERNALS__: {
        async invoke(command: string, args?: NativeSave) {
          if (command === 'desktop_open_document') {
            return {
              name: 'original.recto', bytes: Array.from(new TextEncoder().encode(project)),
              project: { handle: 'opened', name: 'original.recto' },
            };
          }
          if (command !== 'desktop_save_project' || !args) throw new Error(`Unexpected native command: ${command}`);
          native.saves.push(args);
          if (native.conflict && args.handle) throw 'The project file changed on disk. Use Save As.';
          if (native.cancel && !args.handle) return null;
          return { handle: args.handle || 'saved-as', name: args.handle === 'opened' ? 'original.recto' : 'copy.recto' };
        },
      },
    });
  }, JSON.stringify(projectFixture()));

  const handles = () => page.evaluate(() => (window as unknown as { native: { saves: NativeSave[] } }).native.saves.map(save => save.handle));
  const fileMenu = () => page.getByTitle('File Management, Project IO, and Document Imports').click();
  const saveAs = async () => {
    await fileMenu();
    await page.getByRole('button', { name: /^Save Project As/ }).click();
  };
  await page.goto('/');
  await fileMenu();
  await page.getByRole('button', { name: /^Open Project/ }).click();
  const title = page.getByTitle('Click to rename document');
  await expect(title).toHaveValue('Browser QA document');

  await title.fill('Edited on desktop');
  await title.press('Control+s');
  await expect.poll(handles).toEqual(['opened']);
  const firstSave = await page.evaluate(() => (window as unknown as { native: { saves: NativeSave[] } }).native.saves[0]);
  expect(JSON.parse(Buffer.from(firstSave.bytes).toString('utf8')).settings.title).toBe('Edited on desktop');

  await page.evaluate(() => { (window as unknown as { native: { cancel: boolean } }).native.cancel = true; });
  await saveAs();
  await expect.poll(handles).toEqual(['opened', null]);
  await page.keyboard.press('Control+s');
  await expect.poll(handles).toEqual(['opened', null, 'opened']);

  await page.evaluate(() => {
    const bridge = (window as unknown as { native: { cancel: boolean; conflict: boolean } }).native;
    bridge.cancel = false;
    bridge.conflict = true;
  });
  const dialog = page.waitForEvent('dialog');
  const shortcut = page.keyboard.press('Control+s');
  const conflict = await dialog;
  expect(conflict.message()).toContain('changed on disk. Use Save As');
  await conflict.accept();
  await shortcut;

  await saveAs();
  await expect.poll(handles).toEqual(['opened', null, 'opened', 'opened', null]);
  await page.evaluate(() => { (window as unknown as { native: { conflict: boolean } }).native.conflict = false; });
  await page.keyboard.press('Control+s');
  await expect.poll(handles).toEqual(['opened', null, 'opened', 'opened', null, 'saved-as']);
});
