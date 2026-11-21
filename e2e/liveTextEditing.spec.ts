import { expect, test, type Page } from '@playwright/test';
import { importProject, projectFixture } from './fixtures';

const FRAME = 'text-live';
const HEADING = 'Заголовок Heading';
const BODY = 'Первый абзац основного текста набран кеглем двенадцать пунктов, чтобы строки переносились несколько раз. The quick brown fox jumps over the lazy dog and keeps running.';
const QUOTE = 'Цитата справа, italic quote';

function styledProject() {
  const project = projectFixture();
  const [sample] = project.spreads[0].elements;
  return {
    ...project,
    selectedElementId: null, selectedElementIds: [],
    paragraphStyles: [
      { id: 'ps-head', name: 'Heading', fontFamily: 'Georgia, serif', fontSizePt: 26, lineHeight: 1.2, letterSpacingPt: 0, color: '#b00020', alignment: 'center', snapToBaseline: false, bold: true },
      { id: 'ps-body', name: 'Body', fontFamily: 'Georgia, serif', fontSizePt: 12, lineHeight: 1.4, letterSpacingPt: 0, color: '#111111', alignment: 'justify', snapToBaseline: false },
      { id: 'ps-quote', name: 'Quote', fontFamily: 'Arial, sans-serif', fontSizePt: 15, lineHeight: 1.3, letterSpacingPt: 0, color: '#1a4fd6', alignment: 'right', snapToBaseline: false, italic: true },
    ],
    spreads: [{
      ...project.spreads[0],
      elements: [{
        ...sample, id: FRAME, x: 25, y: 60, width: 150, height: 110, fontSizePt: 12, text: '',
        storyContent: { version: 1, paragraphs: [
          { styleId: 'ps-head', runs: [{ text: HEADING }] },
          { styleId: 'ps-body', runs: [{ text: BODY }] },
          { styleId: 'ps-quote', runs: [{ text: QUOTE }] },
        ] },
      }],
    }],
  };
}

async function openStyledProject(page: Page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page, styledProject() as unknown as ReturnType<typeof projectFixture>);
}

/** Client coordinates of a point given in millimetres from the frame's corner. */
function framePoint(page: Page, xMm: number, yMm: number) {
  return page.evaluate(([id, xMm, yMm]) => {
    const { stateManager } = (window as any).recto;
    const canvas = document.querySelector('#spread-canvas')!.getBoundingClientRect();
    const state = stateManager.getState();
    const frame = stateManager.getElementById(id);
    const scale = state.zoom * 96 / 25.4;
    return {
      x: canvas.left + (canvas.width - state.settings.widthMm * scale) / 2 + state.panX + (frame.x + xMm) * scale,
      y: canvas.top + (canvas.height - state.settings.heightMm * scale) / 2 + state.panY + (frame.y + yMm) * scale,
    };
  }, [FRAME, xMm, yMm] as const);
}

function frameState(page: Page) {
  return page.evaluate(id => {
    const frame = (window as any).recto.stateManager.getElementById(id);
    return { text: frame.text as string, styles: frame.textContent.paragraphs.map((paragraph: { styleId?: string }) => paragraph.styleId) as string[] };
  }, FRAME);
}

/** Caret of the in-place editor in client coordinates. */
function caret(page: Page) {
  return page.evaluate(() => {
    const box = (window as any).recto.spreadCanvas.getLiveTextCaret();
    const canvas = document.querySelector('#spread-canvas')!.getBoundingClientRect();
    return box ? { x: canvas.left + box.x, y: canvas.top + box.y, height: box.height as number } : null;
  });
}

const selection = (page: Page) => page.locator('.canvas-inline-editor').evaluate(element => {
  const editor = element as HTMLTextAreaElement;
  return { start: editor.selectionStart, end: editor.selectionEnd, text: editor.value.slice(editor.selectionStart, editor.selectionEnd) };
});

// The middle of the first body line, and a point on the pasteboard beside the page.
const bodyLine = (page: Page) => framePoint(page, 60, 17);
const outside = (page: Page) => framePoint(page, -60, 60);

test('edits a styled frame in place and keeps every paragraph style', async ({ page }) => {
  await openStyledProject(page);
  const point = await bodyLine(page);
  await page.mouse.dblclick(point.x, point.y);

  const editor = page.locator('.canvas-inline-editor');
  await expect(editor).toBeFocused();
  // The textarea only takes input; the page itself shows the text, so it must not cover it.
  await expect(editor).toHaveCSS('opacity', '0');
  await expect(editor).toHaveCSS('pointer-events', 'none');
  await expect.poll(async () => Math.abs((await caret(page))!.x - point.x)).toBeLessThan(6);
  const bodyCaret = (await caret(page))!;

  await page.keyboard.press('Home');
  await page.keyboard.type('Ёж and fox. ');
  await page.keyboard.press('Control+Home');
  await expect.poll(async () => (await caret(page))!.height).toBeGreaterThan(bodyCaret.height * 1.6);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Вторая строка');
  // Nothing reaches the document until the edit is committed.
  expect((await frameState(page)).text).toBe(`${HEADING}\n${BODY}\n${QUOTE}`);

  const away = await outside(page);
  await page.mouse.click(away.x, away.y);
  await expect(editor).toHaveCount(0);
  const committed = await frameState(page);
  expect(committed.text).toBe(`${HEADING}!\nВторая строка\nЁж and fox. ${BODY}\n${QUOTE}`);
  // Two separate edits: the paragraphs between and after them keep their own styles.
  expect(committed.styles).toEqual(['ps-head', 'ps-head', 'ps-body', 'ps-quote']);
});

test('moves and selects by composed lines, with the mouse and the keyboard', async ({ page }) => {
  await openStyledProject(page);
  const point = await bodyLine(page);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('.canvas-inline-editor')).toBeFocused();
  const start = (await caret(page))!;

  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await caret(page))!.y).toBeGreaterThan(start.y + 10);
  const lower = (await caret(page))!;
  expect(Math.abs(lower.x - start.x)).toBeLessThan(8);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => Math.abs((await caret(page))!.y - start.y)).toBeLessThan(1);

  await page.keyboard.press('Home');
  const lineStart = (await selection(page)).start;
  expect(lineStart).toBe(HEADING.length + 1);
  await page.keyboard.press('Shift+End');
  const line = await selection(page);
  expect(line.start).toBe(lineStart);
  expect(BODY.startsWith(line.text)).toBe(true);
  expect(line.text.length).toBeGreaterThan(40);
  expect(line.text.length).toBeLessThan(BODY.length);
  // A caret is not drawn while a range is selected.
  expect(await caret(page)).toBeNull();

  // Drag from the first body line to the line below it.
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, lower.y + lower.height / 2, { steps: 5 });
  await page.mouse.up();
  const dragged = await selection(page);
  expect(dragged.end - dragged.start).toBeGreaterThan(line.text.length - 20);
  await expect(page.locator('.canvas-inline-editor')).toBeFocused();

  // Double click a word, copy it and paste it at the end of the text.
  await page.keyboard.press('Control+End');
  const end = (await caret(page))!;
  await page.mouse.dblclick(end.x - 12, end.y + end.height / 2);
  expect((await selection(page)).text).toBe('quote');
  await page.keyboard.press('ControlOrMeta+C');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(() => page.locator('.canvas-inline-editor').inputValue()).toBe(`${HEADING}\n${BODY}\n${QUOTE}quote`);

  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-inline-editor')).toHaveCount(0);
  expect((await frameState(page)).text).toBe(`${HEADING}\n${BODY}\n${QUOTE}`);
});

test('applies a paragraph style under the caret and goes on editing', async ({ page }) => {
  await openStyledProject(page);
  const point = await bodyLine(page);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('.canvas-inline-editor')).toBeFocused();
  const before = (await caret(page))!;
  await page.keyboard.type('+');
  const typedAt = (await selection(page)).start;

  await page.getByText('Styles', { exact: true }).first().click();
  const quote = page.locator('.styles-list > *').filter({ hasText: 'Quote' }).first();
  await quote.getByRole('button', { name: 'Apply' }).click();

  // Only the paragraph under the caret changes, and the editor is back with the caret where it was.
  expect((await frameState(page)).styles).toEqual(['ps-head', 'ps-quote', 'ps-quote']);
  await expect(page.locator('.canvas-inline-editor')).toBeFocused();
  expect(await selection(page)).toMatchObject({ start: typedAt, end: typedAt });
  await expect.poll(async () => (await caret(page))?.height ?? 0).toBeGreaterThan(before.height * 1.15);

  await page.keyboard.type('+');
  await page.keyboard.press('Control+Enter');
  const committed = await frameState(page);
  expect(committed.text).toContain('++');
  expect(committed.styles).toEqual(['ps-head', 'ps-quote', 'ps-quote']);
});

// The in-place editor is loaded on demand, outside the startup bundle.
const EDITOR_MODULE = /\/liveTextCanvas[^/]*\.(js|ts)(\?|$)/;

test('opens the frame once the in-place editor has loaded when it is opened earlier', async ({ page }) => {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route(EDITOR_MODULE, async route => { await released; await route.continue(); });
  await openStyledProject(page);
  const point = await bodyLine(page);
  await page.mouse.dblclick(point.x, point.y);

  const editor = page.locator('.canvas-inline-editor');
  await expect(editor).toHaveCount(0);
  release();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS('opacity', '0');
  await expect.poll(async () => Math.abs((await caret(page))!.x - point.x)).toBeLessThan(6);
  await page.keyboard.type('Ёж ');
  const away = await outside(page);
  await page.mouse.click(away.x, away.y);
  await expect(editor).toHaveCount(0);
  expect((await frameState(page)).text).toContain('Ёж ');
});

test('does not open a frame when the user clicked elsewhere while the in-place editor was loading', async ({ page }) => {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route(EDITOR_MODULE, async route => { await released; await route.continue(); });
  await openStyledProject(page);
  const point = await bodyLine(page);
  await page.mouse.dblclick(point.x, point.y);
  // Beside the page, on the ruler: a press on the interface counts as well as one on the canvas.
  const away = await outside(page);
  await page.mouse.click(away.x, away.y);
  release();
  await page.waitForResponse(EDITOR_MODULE);
  await page.waitForTimeout(200);
  await expect(page.locator('.canvas-inline-editor')).toHaveCount(0);
});

test('opens frames in the textarea editor when the in-place editor cannot load', async ({ page }) => {
  await page.route(EDITOR_MODULE, route => route.abort());
  await openStyledProject(page);
  const point = await bodyLine(page);
  await page.mouse.dblclick(point.x, point.y);

  const editor = page.locator('.canvas-inline-editor');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS('opacity', '1');
  await expect(page.locator('.canvas-live-caret')).toHaveCount(0);
});

test('keeps the textarea editor as the fallback when in-place editing is off', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('recto.liveTextEditing', 'off'));
  await openStyledProject(page);
  const point = await bodyLine(page);
  await page.mouse.dblclick(point.x, point.y);

  const editor = page.locator('.canvas-inline-editor');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS('opacity', '1');
  await expect(page.locator('.canvas-live-caret')).toHaveCount(0);
  expect(await selection(page)).toMatchObject({ start: 0, end: `${HEADING}\n${BODY}\n${QUOTE}`.length });
  await page.keyboard.press('End');
  await page.keyboard.type(' (old editor)');
  await page.keyboard.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  expect((await frameState(page)).text).toBe(`${HEADING}\n${BODY}\n${QUOTE} (old editor)`);
});
