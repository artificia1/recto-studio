import { expect, test } from '@playwright/test';

interface UpdaterTestBridge {
  finishDownload?: () => void;
  downloads: number;
  installs: { updateRid: number; bytesRid: number; restartAfterInstall: boolean }[];
  closed: number[];
}

test('desktop updater checks the native plugin and preserves edits through a verified install retry', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.addInitScript(() => {
    const updater: UpdaterTestBridge = { downloads: 0, installs: [], closed: [] };
    const callbacks = new Map<number, (event: unknown) => void>();
    let nextId = 0;
    let checks = 0;
    Object.assign(window, {
      updater,
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void) {
          const id = ++nextId;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args?: {
          rid: number;
          onEvent: { id: number };
          updateRid: number;
          bytesRid: number;
          restartAfterInstall: boolean;
        }) {
          if (command === 'plugin:app|version') return '1.4.0';
          if (command === 'plugin:updater|check') {
            checks++;
            if (checks === 1) throw 'Connection unavailable';
            if (checks === 2) return null;
            return { rid: checks, currentVersion: '1.4.0', version: '1.4.1', rawJson: {} };
          }
          if (command === 'plugin:resources|close' && args) {
            updater.closed.push(args.rid);
            return;
          }
          if (command === 'plugin:updater|download' && args) {
            updater.downloads++;
            const callback = callbacks.get(args.onEvent.id)!;
            callback({ index: 0, message: { event: 'Started', data: { contentLength: 2048 } } });
            callback({ index: 1, message: { event: 'Progress', data: { chunkLength: 1024 } } });
            if (updater.downloads === 1) {
              callback({ index: 2, end: true });
              throw 'Invalid signature';
            }
            await new Promise<void>(resolve => { updater.finishDownload = resolve; });
            callback({ index: 2, message: { event: 'Finished' } });
            callback({ index: 3, end: true });
            return 42;
          }
          if (command === 'plugin:updater|install' && args) {
            updater.installs.push({
              updateRid: args.updateRid, bytesRid: args.bytesRid, restartAfterInstall: args.restartAfterInstall,
            });
            if (updater.installs.length === 1) throw 'Installer busy';
            return;
          }
          throw new Error(`Unexpected native command: ${command}`);
        },
      },
    });
  });

  await page.goto('/');
  const check = page.getByRole('button', { name: 'Check for updates', exact: true });
  const install = page.getByRole('button', { name: 'Install update', exact: true });
  const status = page.locator('.app-updater').getByRole('status');
  const title = page.getByTitle('Click to rename document');
  const nativeState = () => page.evaluate(() => {
    const { downloads, installs, closed } = (window as unknown as { updater: UpdaterTestBridge }).updater;
    return { downloads, installs, closed };
  });

  await check.click();
  await expect(status).toHaveText('Could not check for updates. Connection unavailable');
  await check.click();
  await expect(status).toHaveText('Recto Studio 1.4.0 is up to date.');
  await check.click();
  await expect(status).toContainText('Version 1.4.1 is ready.');
  await expect(page.getByText('Installed version 1.4.0', { exact: true })).toBeVisible();
  await page.locator('.app-updater').getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect.poll(async () => (await nativeState()).closed).toEqual([3]);

  await check.click();
  await install.click();
  await expect(status).toHaveText('Could not download or verify the update. Invalid signature');
  expect((await nativeState()).installs).toEqual([]);
  await install.click();
  await expect(status).toHaveText('Downloading version 1.4.1… 50%');
  await title.fill('Edits typed during download');
  await page.evaluate(() => (window as unknown as { updater: UpdaterTestBridge }).updater.finishDownload!());
  await expect(status).toHaveText('Could not start the installer. Installer busy');
  await install.click();
  await expect(status).toHaveText('Update installed. Reopen Recto Studio to continue.');
  await expect.poll(nativeState).toEqual({
    downloads: 2,
    installs: [
      { updateRid: 4, bytesRid: 42, restartAfterInstall: true },
      { updateRid: 4, bytesRid: 42, restartAfterInstall: true },
    ],
    closed: [3, 4],
  });
  await page.reload();
  await expect(title).toHaveValue('Edits typed during download');
});
