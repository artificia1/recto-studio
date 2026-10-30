import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const [executable, currentVersion, nextVersion] = process.argv.slice(2);
if (!executable || !currentVersion || !nextVersion) throw new Error('Pass executable, installed version, and offered version.');
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const modulePath = manifest['node_modules/@tauri-apps/plugin-updater/dist-js/index.js'].file;
await mkdir('test-results/updater', { recursive: true });
const app = spawn(resolve(executable), [], { windowsHide: false, stdio: 'ignore', env: {
  ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9225',
  WEBVIEW2_USER_DATA_FOLDER: resolve('test-results/updater/webview-profile'),
} });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (app.exitCode !== null) throw new Error('Updater test app exited before becoming ready.');
    try {
      if ((await fetch('http://127.0.0.1:9225/json/version', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Updater test WebView did not become ready.');
  browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  await page.locator('#spread-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByText(`Version ${nextVersion} is ready. Installation will close the app.`, { exact: true }).waitFor({ timeout: 30000 });
  const result = await page.evaluate(async ({ modulePath, currentVersion, nextVersion }) => {
    const { check } = await import(new URL(modulePath, location.href).href);
    const update = await check({ timeout: 30000 });
    if (!update || update.currentVersion !== currentVersion || update.version !== nextVersion) throw new Error('Unexpected installed or update version.');
    let bytes = 0;
    await update.download(event => { if (event.event === 'Progress') bytes += event.data.chunkLength; }, { timeout: 120000 });
    await update.close();
    return { currentVersion, nextVersion, bytes };
  }, { modulePath, currentVersion, nextVersion });
  if (!result.bytes) throw new Error('Updater downloaded no installer bytes.');
  await page.screenshot({ path: 'test-results/updater/update-offered.png', fullPage: true });
  console.log(`Native updater offered ${result.nextVersion} to ${result.currentVersion} and downloaded ${result.bytes} bytes. Installation was not started.`);
} finally {
  await browser?.close();
  app.kill();
}
