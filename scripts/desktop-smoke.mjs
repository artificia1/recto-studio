import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const executable = process.argv[2];
const expectedVersion = process.argv[3] || JSON.parse(await readFile('package.json', 'utf8')).version;
const port = Number(process.env.RECTO_SMOKE_PORT || 9223);
if (!executable) throw new Error('Pass the built Windows executable.');
await mkdir('test-results/desktop', { recursive: true });
const output = [];
const app = spawn(resolve(executable), [], {
  windowsHide: false,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: resolve(process.env.RECTO_SMOKE_PROFILE || 'test-results/desktop/webview-profile') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.on('data', data => output.push(data.toString()));
app.stderr.on('data', data => output.push(data.toString()));
app.on('error', error => output.push(error.message));
let browser;
let page;
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (app.exitCode !== null) throw new Error(`Desktop app exited with code ${app.exitCode}.`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Desktop app did not expose a running WebView.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page = context.pages()[0] || await context.waitForEvent('page');
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
    const version = await window.__TAURI_INTERNALS__.invoke('plugin:app|version');
    return { title: state.settings.title, nativeFileCommand: rejected, version };
  });
  if (verification.title !== 'Desktop release verification' || !verification.nativeFileCommand || verification.version !== expectedVersion) {
    throw new Error(`Native desktop verification failed: ${JSON.stringify(verification)}`);
  }
  await page.reload();
  await page.getByTitle('Click to rename document').waitFor();
  if (await page.getByTitle('Click to rename document').inputValue() !== verification.title) throw new Error('Desktop autosave did not recover after reload.');
  if (expectedVersion.localeCompare('1.2.4', undefined, { numeric: true }) >= 0) {
    await page.getByTitle('File Management, Project IO, and Document Imports').click();
    await page.getByTitle('Insert an editable LaTeX equation', { exact: true }).click();
    const equation = page.getByRole('dialog', { name: 'Insert equation' });
    await equation.getByLabel('LaTeX source').fill(String.raw`\frac{1}{2} + \sqrt{x}`);
    await equation.getByRole('button', { name: 'Insert equation', exact: true }).click();
    const source = await page.evaluate(() => window.recto.stateManager.getActiveSpread().elements.find(element => element.equation)?.equation.latex);
    if (source !== String.raw`\frac{1}{2} + \sqrt{x}`) throw new Error('Native equation editor did not retain its source.');
  }
  await mkdir('test-results/desktop', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop/windows-app.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Windows app opened, rendered the editor, recovered autosave, and verified native file-command restrictions.');
} catch (error) {
  if (page) {
    output.push(`Page URL: ${page.url()}`);
    await page.screenshot({ path: 'test-results/desktop/runtime-failure.png' }).catch(() => {});
  }
  await writeFile('test-results/desktop/runtime-error.txt', `${error.stack}\n${output.join('').slice(-20000)}`);
  throw error;
} finally {
  await browser?.close();
  app.kill();
}
