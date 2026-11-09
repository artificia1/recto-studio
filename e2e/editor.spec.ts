import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importProject, menuCommand, savedProject, projectFixture } from './fixtures';
import { createZipArchive, readZip } from '../src/zip';
import { fontCollectionFixture } from '../tests/fixtures/fontCollection';
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

test('persists paragraph keep rules, hyphenation language and font emphasis', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Styles', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel('Keep with next paragraph', { exact: true }).check();
  await page.getByLabel('Keep paragraph together', { exact: true }).check();
  await page.getByLabel('Automatic hyphenation', { exact: true }).check();
  await page.getByLabel('Bold', { exact: true }).check();
  await page.getByLabel('Minimum lines at column bottom', { exact: true }).selectOption('2');
  await page.getByLabel('Minimum lines at column top', { exact: true }).selectOption('2');
  await page.getByLabel('Hyphenation language', { exact: true }).selectOption('de');
  const saved = await savedProject(page);
  expect(saved.paragraphStyles[0]).toMatchObject({ keepWithNext: true, keepTogether: true, hyphenate: true, bold: true, orphanLines: 2, widowLines: 2, language: 'de' });
  await page.reload();
  await page.getByRole('button', { name: 'Styles', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByLabel('Automatic hyphenation', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Hyphenation language', { exact: true })).toHaveValue('de');
  await page.screenshot({ path: 'test-results/paragraph-flow-controls.png', fullPage: true });
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
  await page.getByLabel('Import font file').setInputFiles('tests/fixtures/fonts/SourceSansPro-Regular.woff2');
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
  await page.getByLabel('Import font file').setInputFiles({ name: 'bad.ttf', mimeType: 'font/ttf', buffer: Buffer.from('not a font') });
  await expect(page.getByRole('alert')).toContainText('could not be read');
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].fontFamily).toBe('Georgia, serif');
});

test('imports only the chosen face from a font collection', async ({ page }) => {
  await importProject(page);
  await page.getByLabel('Import font file').setInputFiles({ name: 'Publication.ttc', mimeType: 'font/collection', buffer: fontCollectionFixture() });
  const face = page.getByLabel('Collection face');
  await expect(face.locator('option')).toHaveCount(2);
  await face.selectOption('1');
  await page.getByRole('button', { name: 'Import selected face' }).click();
  await expect(face).toHaveCount(0);
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements[0].fontFamily).toContain('Source Sans Pro');
  expect(saved.embeddedFonts).toHaveLength(1);
  expect(saved.embeddedFonts[0].fileName).toMatch(/\.otf$/);
});

test('downloads the IDML and native validator together from the export menu', async ({ page }) => {
  await importProject(page);
  await page.getByTitle('Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /InDesign Validation Kit/ }).click();
  const path = await (await download).path();
  const kit = await readZip(await readFile(path!));
  expect(kit.has('Recto-Validate-IDML.jsx')).toBe(true);
  const packagedIdml = [...kit.entries()].find(([name]) => name.endsWith('.idml'));
  expect(packagedIdml).toBeDefined();
  const document = await readZip(packagedIdml![1]);
  expect(document.has('designmap.xml')).toBe(true);
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

test('inserts an anchored note through the Story Editor and preserves it on save', async ({ page }) => {
  await importProject(page);
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  const story = page.getByPlaceholder('Write manuscript story here... Canvas updates in real time.');
  await story.click();
  await story.press('Control+End');
  await page.getByText('Notes, references & index markers', { exact: true }).click();
  await page.getByLabel('Note text', { exact: true }).fill('A browser-authored citation.');
  await page.getByRole('button', { name: 'Insert note at cursor', exact: true }).click();
  await expect(story).toHaveValue('Browser workflow sample¹');
  await page.getByTitle('Close Story Editor (Esc)').click();
  const saved = await savedProject(page);
  expect(saved.settings.footnotes).toHaveLength(1);
  expect(saved.settings.footnotes[0].text).toBe('A browser-authored citation.');
  const frame = saved.spreads[0].elements.find((element: { id: string }) => element.id === 'text-qa');
  expect(frame.storyContent.paragraphs.flatMap((paragraph: { runs: { noteId?: string }[] }) => paragraph.runs).some((run: { noteId?: string }) => run.noteId === saved.settings.footnotes[0].id)).toBe(true);
});

test('adds a publication starter, navigates its outline and manages persistent review notes', async ({ page }) => {
  test.setTimeout(120000);
  await importProject(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByLabel('Chapter or article title', { exact: true }).fill('A Working Chapter');
  await page.getByRole('button', { name: 'Add publication starter', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Starter added' })).toBeVisible();
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByLabel('Search publication', { exact: true }).fill('A Working');
  await page.getByRole('list', { name: 'Publication outline', exact: true }).getByRole('button', { name: /A Working Chapter/ }).click();
  await page.getByText('Review notes (0 open)', { exact: true }).click();
  await page.getByLabel('Reviewer', { exact: true }).fill('Copy editor');
  await page.getByLabel('New review note', { exact: true }).fill('Check the chapter opening.');
  await page.getByRole('button', { name: 'Add review note to active spread', exact: true }).click();
  await expect(page.locator('.review-text')).toHaveText('Check the chapter opening.');
  await page.getByRole('button', { name: 'Move spread 2 earlier', exact: true }).click();
  await expect(page.locator('.review-heading')).toContainText('Spread 1');
  const saved = await savedProject(page);
  expect(saved.comments[0]).toMatchObject({ author: 'Copy editor', text: 'Check the chapter opening.', spreadIndex: 0, spreadId: saved.spreads[0].id });
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.locator('.review-text')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Show review notes', exact: true }).selectOption('resolved');
  await expect(page.locator('.review-text')).toHaveText('Check the chapter opening.');
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.getByRole('combobox', { name: 'Show review notes', exact: true }).selectOption('open');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit review note', { exact: true }).fill('Opening checked; verify the source citation.');
  await page.getByRole('button', { name: 'Save review note', exact: true }).click();
  await expect(page.locator('.review-text')).toHaveText('Opening checked; verify the source citation.');
  await page.screenshot({ path: 'test-results/editorial-navigator-review.png', fullPage: true });
});

test('adds a reusable layout with unique pages and restores the document with one undo', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('combobox', { name: 'Layout category', exact: true }).selectOption('Magazine');
  await page.getByRole('button', { name: '+ New Spread', exact: true }).first().click();
  const saved = await savedProject(page);
  expect(saved.spreads).toHaveLength(2);
  expect(saved.spreads[1].elements.every((element: { pageId: string }) => saved.spreads[1].pages.some((p: { id: string }) => p.id === element.pageId))).toBe(true);
  await page.getByTitle('Selection Tool (V)').focus();
  await page.keyboard.press('Control+z');
  expect((await savedProject(page)).spreads).toHaveLength(1);
  await page.getByTitle('Selection Tool (V)').focus();
  await page.keyboard.press('Control+y');
  expect((await savedProject(page)).spreads).toHaveLength(2);
});

test('saves an honest print readiness report from Pages', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Print production readiness', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save production report', exact: true }).click();
  const file = await (await download).path();
  const report = JSON.parse(await readFile(file!, 'utf8'));
  expect(report.certifiedPdfX).toBe(false);
  expect(report.automaticTrapping).toBe(false);
  expect(report.items.some((item: { code: string }) => item.code === 'font')).toBe(true);
});

test('downloads a bounded rectangular sheet plan from Templates', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByText('Rectangular sheet planning', { exact: true }).click();
  await page.getByLabel('Piece width (mm)', { exact: true }).fill('200');
  await page.getByLabel('Piece height (mm)', { exact: true }).fill('150');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save sheet plan', exact: true }).click();
  const file = await (await download).path();
  const plan = JSON.parse(await readFile(file!, 'utf8'));
  expect(plan.capacity).toBe(16); expect(plan.sheetsRequired).toBe(2);
  expect(plan.placements).toHaveLength(16);
});

test('persists horizontal CJK style controls without enabling dictionary hyphenation', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Styles', exact: true }).click();
  await page.getByRole('button', { name: '+ New Style', exact: true }).click();
  await page.getByLabel('Horizontal CJK punctuation rules', { exact: true }).check();
  await page.getByRole('combobox', { name: 'Hyphenation language', exact: true }).selectOption('ja');
  const saved = await savedProject(page);
  expect(saved.paragraphStyles.at(-1)).toMatchObject({ cjkLineBreak: true, language: 'ja' });
  expect(saved.paragraphStyles.at(-1).hyphenate).not.toBe(true);
});

test('applies real variable font axes and restores them after reload', async ({ page }) => {
  await importProject(page);
  await page.getByLabel('Import font file').setInputFiles('tests/fixtures/fonts/Roboto-Variable.ttf');
  await page.getByText('Variable font axes', { exact: true }).click();
  await page.getByRole('slider', { name: 'Font axis wght', exact: true }).press('End');
  await page.getByRole('slider', { name: 'Font axis wdth', exact: true }).press('Home');
  await page.getByRole('button', { name: 'Apply font axes', exact: true }).click();
  await expect.poll(async () => (await savedProject(page)).spreads[0].elements[0].fontFamily).toContain('_Var_');
  const saved = await savedProject(page);
  const family = saved.spreads[0].elements[0].fontFamily;
  expect(saved.embeddedFonts.find((font: { family: string }) => font.family === family).variations).toEqual({ wdth: 75, wght: 900 });
  await page.reload();
  await expect.poll(() => page.evaluate(name => Array.from(document.fonts).some(font => font.family.replace(/"/g, '') === name && font.status === 'loaded'), family)).toBe(true);
  expect(await page.evaluate(name => {
    const font = Array.from(document.fonts).find(font => font.family.replace(/"/g, '') === name);
    return (font as unknown as { variationSettings: string }).variationSettings;
  }, family)).toContain('900');
});

test('creates a reviewed Table of Authorities from a citation suggestion', async ({ page }) => {
  await importProject(page);
  await page.locator('.inspector-panel textarea').first().fill('Brown v. Board of Educ., 347 U.S. 483 (1954)');
  await menuCommand(page, 'Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)');
  await page.getByText('Notes, references & index markers', { exact: true }).click();
  await page.getByRole('button', { name: 'Find citation suggestions in this story', exact: true }).click();
  await page.getByRole('button', { name: 'Mark reviewed suggestion', exact: true }).click();
  await page.getByTitle('Close Story Editor (Esc)').click();
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Contents, notes & references', { exact: true }).click();
  await page.getByRole('button', { name: 'Create or update authorities', exact: true }).click();
  const saved = await savedProject(page);
  const table = saved.spreads.flatMap((spread: { elements: { generated?: { kind: string }; rawStoryText?: string }[] }) => spread.elements).find((element: { generated?: { kind: string } }) => element.generated?.kind === 'authorities');
  expect(table.rawStoryText).toContain('Cases'); expect(table.rawStoryText).toContain('Brown v. Board');
  expect(saved.indexEntries[0].authorityCategory).toBe('cases');
  await page.getByText('Marked text references', { exact: true }).click();
  await page.getByLabel('Search marked text references', { exact: true }).fill('Brown');
  await page.getByRole('button', { name: 'Unmark citation', exact: true }).click();
  const unmarked = await savedProject(page);
  expect(unmarked.indexEntries).toHaveLength(0);
  expect(unmarked.spreads[0].elements[0].text).toContain('Brown v. Board');
});

test('previews and applies bound text data with one undo', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Links', exact: true }).click();
  await page.getByText('Bound text data', { exact: true }).click();
  await page.getByLabel('Record key value', { exact: true }).fill('a');
  await page.getByRole('button', { name: 'Bind selected text frame', exact: true }).click();
  await page.getByLabel('JSON data snapshot', { exact: true }).setInputFiles({ name: 'prices.json', mimeType: 'application/json', buffer: Buffer.from('[{"sku":"a","price":"$129.00"}]') });
  await expect(page.getByRole('button', { name: 'Apply reviewed data changes', exact: true })).toBeEnabled();
  expect((await savedProject(page)).spreads[0].elements[0].text).toBe('Browser workflow sample');
  await page.getByRole('button', { name: 'Apply reviewed data changes', exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].text).toBe('$129.00');
  await page.getByTitle('Selection Tool (V)').focus(); await page.keyboard.press('Control+z');
  expect((await savedProject(page)).spreads[0].elements[0].text).toBe('Browser workflow sample');
});

test('inserts an editable repeating rosette and undoes it', async ({ page }) => {
  await importProject(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByText('Rosette ornaments', { exact: true }).click();
  await expect(page.getByRole('img', { name: 'Rosette preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insert editable rosette', exact: true }).click();
  const saved = await savedProject(page);
  expect(saved.spreads[0].elements.some((element: { type: string; nodes?: unknown[] }) => element.type === 'path' && element.nodes!.length >= 360)).toBe(true);
  await page.getByTitle('Selection Tool (V)').focus(); await page.keyboard.press('Control+z');
  expect((await savedProject(page)).spreads[0].elements).toHaveLength(1);
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
