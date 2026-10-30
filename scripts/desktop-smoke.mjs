import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the built Windows executable.');
await mkdir('test-results/desktop', { recursive: true });
const output = [];
const app = spawn(resolve(executable), [], {
  windowsHide: false,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223',
    WEBVIEW2_USER_DATA_FOLDER: resolve('test-results/desktop/webview-profile') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.on('data', data => output.push(data.toString()));
app.stderr.on('data', data => output.push(data.toString()));
app.on('error', error => output.push(error.message));
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (app.exitCode !== null) throw new Error(`Desktop app exited with code ${app.exitCode}.`);
    try {
      if ((await fetch('http://127.0.0.1:9223/json/version', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Desktop app did not expose a running WebView.');
  browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#spread-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTitle('Click to rename document').fill('Desktop release verification');
  await page.getByTitle('Click to rename document').press('Tab');
  const verification = await page.evaluate(async () => {
    const studio = window.recto;
    if (!window.__TAURI_INTERNALS__ || !studio) throw new Error('Native application bridge is missing.');
    const state = studio.stateManager.getState();
    await studio.stateManager.autosave.flush();
    let rejected = false;
    try { await window.__TAURI_INTERNALS__.invoke('desktop_save_file', { suggestedName: 'unsupported.exe', bytes: [] }); }
    catch (error) { rejected = String(error).includes('Unsupported export format'); }
    return { title: state.settings.title, nativeFileCommand: rejected };
  });
  if (verification.title !== 'Desktop release verification' || !verification.nativeFileCommand) {
    throw new Error(`Native desktop verification failed: ${JSON.stringify(verification)}`);
  }
  await page.reload();
  await page.getByTitle('Click to rename document').waitFor();
  if (await page.getByTitle('Click to rename document').inputValue() !== verification.title) throw new Error('Desktop autosave did not recover after reload.');
  await mkdir('test-results/desktop', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop/windows-app.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Windows app opened, rendered the editor, recovered autosave, and verified native file-command restrictions.');
} catch (error) {
  await writeFile('test-results/desktop/runtime-error.txt', `${error.stack}\n${output.join('').slice(-20000)}`);
  throw error;
} finally {
  await browser?.close();
  app.kill();
}
