import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const [executable, currentVersion, nextVersion] = process.argv.slice(2);
if (!executable || !currentVersion || !nextVersion) throw new Error('Pass executable, installed version, and offered version.');
await mkdir('test-results/updater', { recursive: true });
const profile = await mkdtemp(resolve('test-results/updater/webview-profile-'));
const port = Number(process.env.RECTO_UPDATER_TEST_PORT || 9225);
const endpoint = `http://127.0.0.1:${port}`;
if (await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok, () => false)) {
  throw new Error('The updater test debugging port is in use.');
}
const app = spawn(resolve(executable), [], { windowsHide: true, stdio: 'ignore', env: {
  ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`,
  WEBVIEW2_USER_DATA_FOLDER: profile,
} });
let launchError;
app.on('error', error => { launchError = error; });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (launchError) throw launchError;
    if (app.exitCode !== null) throw new Error('Updater test app exited before becoming ready.');
    try {
      if ((await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Updater test WebView did not become ready.');
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  await page.locator('#spread-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('button', { name: /^Install update\b/i }).waitFor({ timeout: 35000 });
  // Use the tested executable's native bridge so this can test an older build without its JS bundles.
  const result = await page.evaluate(async ({ currentVersion, nextVersion }) => {
    const native = window.__TAURI_INTERNALS__;
    const update = await native.invoke('plugin:updater|check', { timeout: 30000 });
    if (!update || update.currentVersion !== currentVersion || update.version !== nextVersion) throw new Error('Unexpected installed or update version.');
    let bytes = 0;
    const callback = native.transformCallback(({ message }) => {
      if (message?.event === 'Progress') bytes += message.data.chunkLength;
    });
    let downloaded;
    try {
      downloaded = await native.invoke('plugin:updater|download', {
        rid: update.rid, onEvent: `__CHANNEL__:${callback}`, timeout: 120000,
      });
    } finally {
      native.unregisterCallback(callback);
      const resources = [update.rid, downloaded].filter(Number.isInteger);
      await Promise.allSettled(resources.map(rid => native.invoke('plugin:resources|close', { rid })));
    }
    return { currentVersion, nextVersion, bytes };
  }, { currentVersion, nextVersion });
  if (!result.bytes) throw new Error('Updater downloaded no installer bytes.');
  await page.screenshot({ path: 'test-results/updater/update-offered.png', fullPage: true });
  console.log(`Native updater offered ${result.nextVersion} to ${result.currentVersion} and verified the ${result.bytes}-byte download.`);
} finally {
  await browser?.close();
  app.kill();
}
