import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { menuCommand, projectFileInput } from './fixtures';

test.skip(process.env.RECTO_MEASURE_PUBLICATIONS !== '1', 'Generate large-publication fixtures before taking browser measurements.');

for (const fixture of [
  { file: 'nonfiction.recto', title: 'Field notes', pages: 250 },
  { file: 'magazine.recto', title: 'Field journal', pages: 40 },
]) {
  test('measures editor navigation and typing in ' + fixture.title, async ({ page, context }) => {
    test.setTimeout(180_000);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto('/');
    const start = performance.now();
    await projectFileInput(page).setInputFiles('build/production-benchmark/' + fixture.file);
    await expect(page.getByTitle('Click to rename document')).toHaveValue(fixture.title, { timeout: 90_000 });
    const openMs = performance.now() - start;
    const { navigationMs, frameId } = await page.evaluate(async pages => {
      const { stateManager } = (window as unknown as { recto: { stateManager: {
        setActiveSpread(index: number): void;
        getActiveSpread(): { elements: { id: string; type: string; storyContent?: unknown }[] };
        selectElement(id: string): void;
      } } }).recto;
      const start = performance.now();
      for (const index of [Math.floor(pages / 2), pages - 1, 0]) {
        stateManager.setActiveSpread(index);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      const navigationMs = performance.now() - start;
      const frameId = stateManager.getActiveSpread().elements.find(item => item.type === 'text' && item.storyContent)!.id;
      stateManager.selectElement(frameId);
      return { navigationMs, frameId };
    }, fixture.pages);
    await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
    const dialog = page.getByRole('dialog', { name: 'Story Editor' });
    const manuscript = dialog.getByRole('textbox', { name: 'Story manuscript' });
    await expect(manuscript).toBeEditable();
    await manuscript.focus();
    await manuscript.press('Control+Home');
    const edit = performance.now();
    await page.keyboard.insertText('Revised. ');
    await expect(manuscript).toHaveValue(/^Revised\./);
    const typingMs = performance.now() - edit;
    await dialog.getByRole('button', { name: 'Close Story Editor' }).click();
    await expect(dialog).toBeHidden({ timeout: 75_000 });
    await expect.poll(() => page.evaluate(id => {
      const { stateManager } = (window as unknown as { recto: { stateManager: {
        getStoryContent(id: string): { paragraphs: { runs: { text: string }[] }[] };
      } } }).recto;
      return stateManager.getStoryContent(id).paragraphs[0].runs[0].text.slice(0, 9);
    }, frameId)).toBe('Revised. ');
    const commitMs = performance.now() - edit;
    const cdp = await context.newCDPSession(page);
    const memory = await cdp.send('Runtime.getHeapUsage');
    await cdp.detach();
    const report = { openMs, navigationMs, typingMs, commitMs, heapMiB: Math.round(memory.usedSize / 1024 ** 2) };
    await writeFile('build/production-benchmark/browser-' + fixture.pages + '.json', JSON.stringify(report, null, 2));
  });
}
