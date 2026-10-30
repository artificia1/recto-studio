import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importProject, menuCommand, savedProject, projectFixture } from './fixtures';
import { createZipArchive } from '../src/zip';
const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  // Keep tests deterministic and exercise the editor without remote Google fonts.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#spread-canvas')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
});

test('loads and opens the editor without uncaught errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#spread-canvas')).toBeVisible();
  await expect(page.getByTitle('Click to rename document')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-initial.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('keeps footer tool and display controls separate at desktop and narrow widths', async ({ page }) => {
  for (const width of [1440, 1366, 1024, 750]) {
    await page.setViewportSize({ width, height: 900 });
    const tool = page.locator('.status-active-tool');
    const display = page.locator('.status-display-group').first();
    await expect(tool).toBeVisible();
    await expect(display).toBeVisible();
    const a = (await tool.boundingBox())!;
    const b = (await display.boundingBox())!;
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    expect(await tool.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator('.status-bar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const footer = (await page.locator('.status-bar').boundingBox())!;
    for (const selector of ['.mobile-canvas-zoom-pill', '.mobile-inspector-toggle-btn']) {
      const control = page.locator(selector);
      if (await control.isVisible()) {
        const box = (await control.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(footer.y);
      }
    }
  }
  await page.screenshot({ path: 'test-results/footer-responsive.png', fullPage: true });
});

test('automatically extends an opted-in story into facing spreads and undoes the edit', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Story pagination', { exact: true }).click();
  await page.getByLabel('Automatically add pages for selected story').check();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const text = 'New manuscript content flows to linked pages. '.repeat(150);
  await page.locator('.inspector-panel textarea').first().fill(text);
  const saved = await savedProject(page);
  expect(saved.spreads.length).toBeGreaterThan(1);
  expect(saved.spreads[0].elements[0].autoExtendStory).toBe(true);
  for (const spread of saved.spreads.slice(1)) {
    expect(spread.pages.map((page: any) => page.side)).toEqual(['left', 'right']);
  }
  expect(saved.spreads.flatMap((spread: any) => spread.elements).map((frame: any) => frame.text).join('')).toBe(text);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  const restored = await savedProject(page);
  expect(restored.spreads.length).toBe(1);
  expect(restored.spreads[0].elements[0].text).toBe('Browser workflow sample');
});

test('configures publication sections, chapter openings and running headers through Pages', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Sections & numbering', { exact: true }).click();
  await page.getByLabel('Section title', { exact: true }).fill('Front matter');
  await page.getByLabel('Numbering', { exact: true }).selectOption('roman-lower');
  await page.getByRole('button', { name: 'Apply section', exact: true }).click();
  let saved = await savedProject(page);
  expect(saved.spreads[0].pages[0].section.title).toBe('Front matter');
  expect(saved.spreads[0].pages[0].section.numbering).toBe('roman-lower');
  await page.getByText('Running header & page number', { exact: true }).click();
  await page.getByRole('button', { name: 'Apply to this spread', exact: true }).click();
  saved = await savedProject(page);
  const master = saved.masterSpreads.find((master: any) => master.id === saved.spreads[0].masterSpreadId);
  expect(master.elements.some((element: any) => element.text === '{{chapterTitle}}')).toBe(true);
  await page.getByText('New chapter opening', { exact: true }).click();
  await page.getByLabel('Chapter title', { exact: true }).fill('The next chapter');
  await page.getByRole('button', { name: 'Add chapter', exact: true }).click();
  saved = await savedProject(page);
  expect(saved.spreads.at(-1).elements[0].storyContent.paragraphs[0].runs[0].text).toBe('The next chapter');
  await page.reload();
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Browser QA document');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByText('Sections & numbering', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/publication-pages.png', fullPage: true });
});

test('paginates a manuscript through the menu and undoes the generated pages', async ({ page }) => {
  const project = projectFixture();
  project.spreads[0].elements[0].text = 'A long manuscript for automatic pagination. '.repeat(500);
  await importProject(page, project);
  await page.getByTitle('File Management, Project IO, and Document Imports').click();
  const dialog = page.waitForEvent('dialog');
  const paginate = page.getByRole('button', { name: 'Auto-paginate selected story', exact: true }).click();
  const message = await dialog;
  expect(message.message()).toContain('Added');
  await message.accept();
  await paginate;
  const saved = await savedProject(page);
  expect(saved.spreads.length).toBeGreaterThan(1);
  const frames = saved.spreads.flatMap((spread: any) => spread.elements);
  expect(frames.map((frame: any) => frame.text).join('')).toBe(project.spreads[0].elements[0].text);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  const restored = await savedProject(page);
  expect(restored.spreads.length).toBe(1);
  expect(restored.spreads[0].elements[0].text).toBe(project.spreads[0].elements[0].text);
});

test('imports, edits, undoes and redoes a real project through the UI', async ({ page }) => {
  await importProject(page);
  const editor = page.locator('.inspector-panel textarea').first();
  await expect(editor).toHaveValue('Browser workflow sample');
  await editor.fill('Edited in the browser');
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  await expect(editor).toHaveValue('Browser workflow sample');
  await page.getByTitle('Redo (Ctrl+Y)', { exact: true }).click();
  await expect(editor).toHaveValue('Edited in the browser');
});

test('autosaves an edit and restores it after reload', async ({ page }) => {
  await importProject(page);
  await page.locator('.inspector-panel textarea').first().fill('Persisted browser edit');
  await expect(page.locator('.status-left [role="status"]')).toHaveText('Saved locally');
  await page.reload();
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Persisted browser edit');
});

test('flushes a pending edit when reloading immediately', async ({ page }) => {
  await importProject(page);
  await page.locator('.inspector-panel textarea').first().fill('Immediate reload edit');
  await page.reload();
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Immediate reload edit');
});

test('exports a project and rejects malformed input without replacing it', async ({ page }) => {
  await importProject(page);
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].text).toBe('Browser workflow sample');
  const dialog = page.waitForEvent('dialog');
  const upload = page.locator('input[accept=".recto,.papercut,.json,.idml,.indd"]').setInputFiles({
    name: 'invalid.recto', mimeType: 'application/json', buffer: Buffer.from('{"settings":{}}'),
  });
  const error = await dialog;
  expect(error.message()).toContain('Could not open this project');
  await error.accept();
  await upload;
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Browser QA document');
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Browser workflow sample');
});

test('reopens Quick Apply with its input focused', async ({ page }) => {
  await page.getByTitle('Quick Apply Styles & Commands (Ctrl+/ or Ctrl+Enter)').click();
  const input = page.getByPlaceholder('Quick Apply... (type a style or command, e.g. \'h1\', \'fit\', \'grid\')');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await page.getByTitle('Quick Apply Styles & Commands (Ctrl+/ or Ctrl+Enter)').click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
});

test('reopens Find/Change ready for typing and replaces document text', async ({ page }) => {
  await importProject(page);
  await page.getByTitle('Find / Change (GREP) (Ctrl+F)').click();
  const input = page.getByPlaceholder('Text to find...');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await page.getByTitle('Find / Change (GREP) (Ctrl+F)').click();
  await expect(input).toBeFocused();
  await input.fill('sample');
  await page.getByPlaceholder('Replacement text...').fill('changed');
  await page.getByRole('button', { name: 'Change All', exact: true }).click();
  await input.press('Escape');
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Browser workflow changed');
});

test('imports a real custom font, keeps it in the saved project and activates it after reload', async ({ page }) => {
  await importProject(page);
  await page.locator('input[accept=".woff2,.ttf,.otf,.woff"]').setInputFiles('tests/fixtures/fonts/SourceSansPro-Regular.woff2');
  await expect.poll(() => page.evaluate(() => Array.from(document.fonts).some(font => font.family.includes('Source Sans Pro') && font.status === 'loaded'))).toBe(true);
  await expect(page.locator('.status-left [role="status"]')).toHaveText('Saved locally');
  const saved = await savedProject(page);
  expect(saved.embeddedFonts[0].data.length).toBeGreaterThan(1000);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Array.from(document.fonts).some(font => font.family.includes('Source Sans Pro') && font.status === 'loaded'))).toBe(true);
  await expect(page.locator('#spread-canvas')).toBeVisible();
  await page.screenshot({ path: 'test-results/custom-font-restored.png', fullPage: true });
});

test('reports a corrupt font without changing the selected font', async ({ page }) => {
  await importProject(page);
  await page.locator('input[accept=".woff2,.ttf,.otf,.woff"]').setInputFiles({ name: 'bad.ttf', mimeType: 'font/ttf', buffer: Buffer.from('not a font') });
  await expect(page.getByRole('alert')).toContainText('could not be read');
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].fontFamily).toBe('Georgia, serif');
});

test('runs a restricted script and rejects network access without changing the document', async ({ page }) => {
  await importProject(page);
  await menuCommand(page, 'InDesign-style publishing automation & JavaScript scripts (Alt+F11)');
  await page.getByRole('button', { name: 'Restricted JavaScript', exact: true }).click();
  const script = page.locator('.modal-overlay textarea');
  await script.fill('stateManager.updateElement("text-qa", { text: "Scripted text" });');
  await page.getByRole('button', { name: 'Execute Script', exact: true }).click();
  await expect(page.getByText('Applied 1 updates.', { exact: true })).toBeVisible();
  await script.fill('fetch("https://example.com/");');
  await page.getByRole('button', { name: 'Execute Script', exact: true }).click();
  await expect(page.getByText(/No changes applied/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Scripted text');
});

test('downloads a PDF with a valid header', async ({ page }) => {
  await importProject(page);
  const download = page.waitForEvent('download');
  await page.getByTitle('Export Clean Digital PDF (Exact Trim Dimensions)').click();
  const path = await (await download).path();
  expect((await readFile(path!)).subarray(0, 5).toString()).toBe('%PDF-');
});

test('draws a rectangle on the canvas and preserves it in the saved project', async ({ page }) => {
  await importProject(page);
  await page.getByTitle('Canvas Zoom', { exact: true }).selectOption('fit');
  await page.getByTitle('Rectangle Tool (M)', { exact: true }).click();
  const canvas = await page.locator('#spread-canvas').boundingBox();
  if (!canvas) throw new Error('Canvas was not laid out');
  const x = canvas.x + canvas.width / 2;
  const y = canvas.y + canvas.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 60, { steps: 8 });
  await page.mouse.up();
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements.some((element: { type: string; width: number }) => element.type === 'shape' && element.width > 0)).toBe(true);
});

test('keyboard redo does not open the story editor', async ({ page }) => {
  await importProject(page);
  const editor = page.locator('.inspector-panel textarea').first();
  await editor.fill('Keyboard redo edit');
  await page.getByTitle('Selection Tool (V)').focus();
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue('Browser workflow sample');
  await page.keyboard.press('Control+y');
  await expect(page.getByPlaceholder('Write manuscript story here... Canvas updates in real time.')).not.toBeVisible();
  await expect(editor).toHaveValue('Keyboard redo edit');
});

test('reopening the story editor reflects external text changes', async ({ page }) => {
  await importProject(page);
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  const story = page.getByPlaceholder('Write manuscript story here... Canvas updates in real time.');
  await expect(story).toHaveValue('Browser workflow sample');
  await page.getByTitle('Close Story Editor (Esc)').click();
  await page.locator('.inspector-panel textarea').first().fill('Changed while story editor closed');
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  await expect(story).toHaveValue('Changed while story editor closed');
  await story.press('Escape');
  await expect(story).not.toBeVisible();
  await page.getByTitle('Selection Tool (V)').focus();
  await page.keyboard.press('Control+Alt+y');
  await expect(story).toHaveValue('Changed while story editor closed');
});

test('opens and closes the inspector at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTitle('Save .recto project to disk (Ctrl+S)')).toBeInViewport();
  await expect(page.getByTitle('File Management, Project IO, and Document Imports')).toBeInViewport();
  const inspector = page.locator('.inspector-panel');
  await expect(inspector).not.toBeInViewport();
  await page.getByRole('button', { name: 'Toggle Inspector', exact: true }).click();
  await expect(inspector).toBeInViewport();
  await page.screenshot({ path: 'test-results/mobile-inspector.png', fullPage: true });
  await page.getByRole('button', { name: 'Close Inspector', exact: true }).click();
  await expect(inspector).not.toBeInViewport();
});

test('recovers from IndexedDB when localStorage writes fail', async ({ page }) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
  });
  await importProject(page);
  await page.locator('.inspector-panel textarea').first().fill('Recovered from database backup');
  await expect(page.locator('.status-left [role="status"]')).toHaveText('Saved locally');
  expect(await page.evaluate(() => localStorage.getItem('recto_project_autosave'))).toBeNull();
  await page.reload();
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Recovered from database backup');
});

test('imports an IDML package using the file picker', async ({ page }) => {
  const bytes = createZipArchive({
    'designmap.xml': '<Document/>',
    'Spreads/Spread_test.xml': '<Spread><Page Self="p" GeometricBounds="0 0 800 600"/><TextFrame Self="f" ParentStory="s" ItemTransform="1 0 0 1 0 0" GeometricBounds="0 0 200 400"/></Spread>',
    'Stories/Story_test.xml': '<Story Self="s"><ParagraphStyleRange><CharacterStyleRange><Content>IDML browser import</Content></CharacterStyleRange></ParagraphStyleRange></Story>',
  });
  await page.locator('input[accept=".recto,.papercut,.json,.idml,.indd"]').setInputFiles({
    name: 'browser-idml.idml', mimeType: 'application/zip', buffer: Buffer.from(bytes),
  });
  await expect(page.getByTitle('Click to rename document')).toHaveValue('Imported InDesign Project');
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements.some((element: { text?: string }) => element.text?.includes('IDML browser import'))).toBe(true);
});

test('downloads an EPUB package through the export menu', async ({ page }) => {
  await importProject(page);
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  const download = page.waitForEvent('download');
  await page.getByText('Export EPUB 3', { exact: true }).click();
  const path = await (await download).path();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.includes(Buffer.from('application/epub+zip'))).toBe(true);
});

test('loads print tools on demand and returns to editing', async ({ page }) => {
  await importProject(page);
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  await page.getByText('Export Imposed Booklet PDF...', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Booklet Signature & Imposition Engine' })).toBeVisible();
  await page.getByTitle('Close', { exact: true }).click();
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  await page.getByText('Export Full Wrap Cover PDF...', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wrap Cover Designer & Spine Calculator' })).toBeVisible();
  await page.getByTitle('Close', { exact: true }).click();
  await page.locator('.inspector-panel textarea').first().fill('Editing after loading print tools');
  expect((await savedProject(page)).spreads[0].elements.find((element: { id: string }) => element.id === 'text-qa').text).toBe('Editing after loading print tools');
});

test('loads manuscript tools on demand and places text', async ({ page }) => {
  await importProject(page);
  await page.locator('input[accept=".md,.markdown,.txt,.docx"]').setInputFiles({
    name: 'manuscript.txt', mimeType: 'text/plain', buffer: Buffer.from('Manuscript loaded on demand'),
  });
  await expect(page.getByRole('dialog', { name: 'Import manuscript' })).toBeVisible();
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Browser workflow sample');
  await page.getByRole('button', { name: 'Place manuscript', exact: true }).click();
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Manuscript loaded on demand');
});

test('clicking empty canvas clears a selected text frame with selection or text tool', async ({ page }) => {
  await importProject(page);
  const canvas = page.locator('#spread-canvas');
  const box = (await canvas.boundingBox())!;
  for (const tool of ['Selection Tool (V)', 'Type Tool (T)']) {
    await page.evaluate(() => (window as any).recto.stateManager.selectElement('text-qa'));
    await page.getByTitle(tool, { exact: true }).click();
    await page.mouse.click(box.x + 15, box.y + 15);
    await expect.poll(() => page.evaluate(() => (window as any).recto.stateManager.getState().selectedElementId)).toBeNull();
  }
});

test('fitting a long frame leaves its text visible in the canvas renderer', async ({ page }) => {
  await importProject(page);
  await page.evaluate(() => {
    const { stateManager, spreadCanvas } = (window as any).recto;
    stateManager.updateElement('text-qa', { text: ('For three decades desktop publishing has been held hostage behind proprietary walls. ' +
      'A designer arranges long text into carefully shaped lines.\n\n').repeat(5), height: 180, fontSizePt: 10, lineHeight: 1.5 });
    stateManager.fitFrameToContent('text-qa');
    spreadCanvas.render();
  });
  const overset = await page.evaluate(() => (window as any).recto.spreadCanvas.overflownTextFrameIds.has('text-qa'));
  expect(overset).toBe(false);
  await page.evaluate(() => {
    const { stateManager, spreadCanvas } = (window as any).recto;
    stateManager.copyfitTextFrame('text-qa');
    spreadCanvas.render();
  });
  expect(await page.evaluate(() => (window as any).recto.spreadCanvas.overflownTextFrameIds.has('text-qa'))).toBe(false);
});

test('previews mixed manuscript styles, cancels safely and preserves rich formatting through editing and reopen', async ({ page }) => {
  await importProject(page);
  const upload = () => page.locator('input[accept=".md,.markdown,.txt,.docx"]').setInputFiles({
    name: 'novel.md', mimeType: 'text/markdown', buffer: Buffer.from('# Chapter one\n\nA **bold** and *italic* paragraph.\n\n## Section two\n\nFinal paragraph.'),
  });
  await upload();
  let modal = page.getByRole('dialog', { name: 'Import manuscript' });
  await expect(modal.getByLabel('Map Heading 1')).toHaveValue('style-h1');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Browser workflow sample');
  await upload();
  modal = page.getByRole('dialog', { name: 'Import manuscript' });
  await modal.getByLabel('Map Heading 2').selectOption('style-body');
  await page.screenshot({ path: 'test-results/manuscript-import-preview.png', fullPage: true });
  await modal.getByRole('button', { name: 'Place manuscript', exact: true }).click();
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  const editor = page.getByRole('textbox', { name: 'Story manuscript', exact: true });
  await expect(editor).toHaveValue('Chapter one\nA bold and italic paragraph.\nSection two\nFinal paragraph.');
  await expect(page.locator('.manuscript-preview span').filter({ hasText: /^bold$/ })).toHaveCSS('font-weight', '700');
  await editor.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(14, 18); element.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  await page.getByRole('textbox', { name: 'New character style name' }).fill('Book emphasis');
  await page.getByRole('button', { name: 'Save style', exact: true }).click();
  await editor.press('Control+End');
  await editor.pressSequentially(' Appended.');
  await expect(editor).toHaveValue(/Final paragraph\. Appended\.$/);
  await page.screenshot({ path: 'test-results/manuscript-story-editor.png', fullPage: true });
  await editor.press('Escape');
  const saved = await savedProject(page);
  const frame = saved.spreads[0].elements[0];
  expect(frame.storyContent.paragraphs[2].styleId).toBe('style-body');
  expect(frame.storyContent.paragraphs[1].runs.some((run: { bold?: boolean; characterStyleId?: string }) => run.bold ||
    saved.characterStyles.find((style: { id: string; bold?: boolean }) => style.id === run.characterStyleId)?.bold)).toBe(true);
  expect(saved.characterStyles.some((style: { name: string }) => style.name === 'Book emphasis')).toBe(true);
  await importProject(page, saved);
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  await expect(editor).toHaveValue(/Final paragraph\. Appended\.$/);
});

test('imports a Word manuscript with source style mapping and explicit warnings', async ({ page }) => {
  await importProject(page);
  const buffer = createZipArchive({
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A Word chapter</w:t></w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Italic Word body &amp; text.</w:t></w:r></w:p></w:body></w:document>',
  });
  await page.locator('input[accept=".md,.markdown,.txt,.docx"]').setInputFiles({ name: 'chapter.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(buffer) });
  const modal = page.getByRole('dialog', { name: 'Import manuscript' });
  await expect(modal.getByLabel('Map Heading1')).toHaveValue('style-h1');
  await expect(modal.getByText('Review after import', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Place manuscript', exact: true }).click();
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].storyContent.paragraphs[1].runs[0]).toMatchObject({ italic: true, text: 'Italic Word body & text.' });
});

test('reports an unavailable export module and preserves the document', async ({ page }) => {
  await importProject(page);
  await page.route(/\/assets\/epubExport-[^/]+\.js$/, route => route.abort());
  const message = new Promise<string>((resolve, reject) => {
    page.once('dialog', async dialog => {
      const text = dialog.message();
      try {
        await dialog.accept();
        resolve(text);
      } catch (error) {
        reject(error);
      }
    });
  });
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  await page.getByText('Export EPUB 3', { exact: true }).click();
  expect(await message).toContain('Export failed.');
  await expect(page.locator('.inspector-panel textarea').first()).toHaveValue('Browser workflow sample');
});
