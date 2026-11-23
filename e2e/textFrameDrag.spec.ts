import { test, expect, type Page } from '@playwright/test';
import { projectFileInput, projectFixture } from './fixtures';
import type { CanvasElement, ProjectState, TextElement, VectorPathElement } from '../src/types';

interface DragTestWindow extends Window {
  recto: {
    stateManager: {
      getState(): ProjectState;
      getElementById(id: string): CanvasElement | null;
      getDocumentRevision(): number;
      setActiveSpread(index: number): void;
      selectElement(id: string): void;
      selectElements(ids: string[]): void;
      setZoom(zoom: number): void;
      setPan(x: number, y: number): void;
      updateSettings(settings: Partial<ProjectState['settings']>): void;
      reflowStory(id: string, resume?: unknown): void;
      runPreflightCheck(): unknown;
      autosave: { schedule(): void };
      onMutation?: (...args: unknown[]) => void;
    };
    spreadCanvas: {
      getSpreadScreenOrigin(state: ProjectState): { x: number; y: number };
      dragPreview: Map<string, CanvasElement>;
      render(...args: unknown[]): void;
    };
  };
  dragCounts: { reflow: number; preflight: number; autosave: number; mutations: number };
}

const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

test('moves ruler cursors independently of the marks and updates marks after panning', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  const cursor = page.locator('.ruler-cursor-top');
  await expect(cursor).toBeVisible();
  const initialTransform = await cursor.evaluate(element => (element as HTMLElement).style.transform);
  const initialMarks = await page.locator('#ruler-top').evaluate(element => (element as HTMLCanvasElement).toDataURL());
  const canvas = (await page.locator('#spread-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.3, { steps: 8 });
  await expect.poll(() => cursor.evaluate(element => (element as HTMLElement).style.transform)).not.toBe(initialTransform);
  expect(await page.locator('#ruler-top').evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(initialMarks);

  await page.evaluate(() => (window as unknown as DragTestWindow).recto.stateManager.setPan(43, 0));
  await expect.poll(() => page.locator('#ruler-top').evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(initialMarks);
});

async function openBook(page: Page, baselineGrid = false, includeVector = false) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const base = projectFixture();
  const frames: TextElement[] = Array.from({ length: 256 }, (_, index) => ({
    ...base.spreads[0].elements[0], type: 'text', id: `drag-${index}`, pageId: `page-${index}`,
    x: 25, y: 35, width: 150, height: 100, text: '', fontSizePt: 11, fontFamily: 'Times New Roman, serif', alignment: 'left',
    prevFrameId: index ? `drag-${index - 1}` : undefined,
    nextFrameId: index < 255 ? `drag-${index + 1}` : undefined,
  }));
  frames[0].storyContent = { version: 1, paragraphs: frames.map((_, index) => ({ id: `paragraph-${index}`,
    runs: [{ text: `Section ${index + 1}. ` + 'The long manuscript keeps its editable text while the frame is moved. '.repeat(20) }] })) };
  const path: VectorPathElement = { id: 'drag-path', type: 'path', pageId: frames[25].pageId, x: 52, y: 76,
    width: 42, height: 32, zIndex: 5, opacity: 1, rotation: 0, locked: false, closed: false,
    nodes: [{ x: 0, y: 0 }, { x: 42, y: 32 }], fillColor: 'transparent', strokeColor: '#111111',
    strokeWidthMm: 0.5, strokeCap: 'round', strokeJoin: 'round', strokeDash: 'solid' };
  const project = { ...base, settings: { ...base.settings, title: 'Linked book drag test',
    baselineGrid: { enabled: baselineGrid, incrementPt: 12, startMm: 25 } },
    spreads: frames.map((frame, index) => ({ id: `spread-${index}`, spreadIndex: index,
      pages: [{ id: frame.pageId, pageNumber: index + 1, side: 'single' }], elements: includeVector && index === 25 ? [frame, path] : [frame] })) };
  await page.goto('/');
  await projectFileInput(page).setInputFiles({ name: 'drag-book.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByTitle('Click to rename document')).toHaveValue(project.settings.title);
  return page.evaluate(async () => {
    const { stateManager: manager, spreadCanvas: canvas } = (window as unknown as DragTestWindow).recto;
    manager.setActiveSpread(25);
    manager.selectElement('drag-25');
    manager.setZoom(1);
    manager.setPan(0, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = manager.getState();
    const frame = manager.getElementById('drag-25')!;
    const origin = canvas.getSpreadScreenOrigin(state);
    const box = document.querySelector('#spread-canvas')!.getBoundingClientRect();
    return { right: box.left + origin.x + (frame.x + frame.width) * 96 / 25.4,
      middle: box.top + origin.y + (frame.y + frame.height / 2) * 96 / 25.4,
      x: box.left + origin.x + (frame.x + frame.width / 2) * 96 / 25.4,
      y: box.top + origin.y + (frame.y + frame.height / 3) * 96 / 25.4 };
  });
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const manager = (window as unknown as DragTestWindow).recto.stateManager;
    const frame = manager.getElementById('drag-25')!;
    return { x: frame.x, y: frame.y, revision: manager.getDocumentRevision(),
      story: (manager.getElementById('drag-0') as TextElement).rawStoryText };
  });
}

test('drafts typography and frame dimensions, then applies one undoable change each', async ({ page }) => {
  test.setTimeout(120000);
  await openBook(page);
  await page.evaluate(() => {
    const app = window as unknown as DragTestWindow;
    app.dragCounts = { reflow: 0, preflight: 0, autosave: 0, mutations: 0 };
    const manager = app.recto.stateManager;
    const reflow = manager.reflowStory.bind(manager);
    manager.reflowStory = (...args) => { app.dragCounts.reflow++; reflow(...args); };
    const WorkerConstructor = window.Worker;
    window.Worker = class extends WorkerConstructor {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes('storyCompositionWorker')) return;
        const send = this.postMessage.bind(this);
        this.postMessage = message => {
          document.body.dataset.typographyWorker = 'pending';
          setTimeout(() => send(message), 400);
        };
        this.addEventListener('message', event => {
          document.body.dataset.typographyWorker = event.data?.frames?.length ? 'composed' : 'fallback';
        });
      }
    };
  });
  const values = () => page.evaluate(() => {
    const app = window as unknown as DragTestWindow;
    const manager = app.recto.stateManager;
    const frame = manager.getElementById('drag-25') as TextElement;
    return { revision: manager.getDocumentRevision(), reflow: app.dragCounts.reflow, size: frame.fontSizePt,
      gutter: frame.columnGutterMm, width: frame.width, height: frame.height };
  });
  const before = await values();
  const toolbar = page.getByRole('toolbar', { name: 'Contextual Text Controls' });
  const size = toolbar.getByRole('spinbutton', { name: 'Font size' });
  await size.fill('9');
  await size.fill('18');
  expect(await values()).toEqual(before);
  await size.press('Escape');
  await expect(size).toHaveValue(String(before.size));
  expect(await values()).toEqual(before);

  await size.fill('18');
  await size.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-typography-worker', 'pending');
  expect((await values()).size).toBe(before.size);
  await page.evaluate(() => (window as unknown as DragTestWindow).recto.stateManager.setPan(5, 0));
  await expect(page.locator('body')).toHaveAttribute('data-typography-worker', 'composed');
  await expect.poll(async () => (await values()).size).toBe(18);
  const gutter = toolbar.getByRole('spinbutton', { name: 'Column gutter' });
  await gutter.fill('7');
  expect((await values()).gutter).toBe(before.gutter);
  await gutter.press('Tab');
  await expect.poll(async () => (await values()).gutter).toBe(7);

  const width = page.getByRole('textbox', { name: 'Frame width' });
  await width.fill('280/2');
  expect((await values()).width).toBe(before.width);
  await width.press('Enter');
  await expect.poll(async () => (await values()).width).toBe(140);
  const height = page.getByRole('textbox', { name: 'Frame height' });
  await height.focus();
  await height.press('ArrowUp');
  await height.press('ArrowUp');
  expect((await values()).height).toBe(before.height);
  await height.press('Enter');

  await expect.poll(values).toEqual({ revision: before.revision + 4, reflow: 0,
    size: 18, gutter: 7, width: 140, height: before.height + 2 });
  await page.keyboard.press('Control+z');
  expect((await values()).height).toBe(before.height);
  expect((await values()).width).toBe(140);

  await size.fill('20');
  await size.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-typography-worker', 'pending');
  await page.evaluate(() => (window as unknown as DragTestWindow).recto.stateManager.updateSettings({ title: 'Edited while laying out text' }));
  await expect(toolbar.getByRole('alert')).toContainText('The document changed during layout');
  expect((await values()).size).toBe(18);
});

test('drags a linked frame without reflowing or saving the book until release, then undoes once', async ({ page }) => {
  test.setTimeout(120000);
  const point = await openBook(page);
  await expect(page.getByRole('button', { name: /^Preflight: / })).toHaveAttribute('aria-busy', 'false');
  const before = await snapshot(page);
  await page.evaluate(() => {
    const current = window as unknown as DragTestWindow;
    const manager = current.recto.stateManager;
    const counts = current.dragCounts = { reflow: 0, preflight: 0, autosave: 0, mutations: 0 };
    const reflow = manager.reflowStory.bind(manager);
    manager.reflowStory = id => { counts.reflow++; reflow(id); };
    const preflight = manager.runPreflightCheck.bind(manager);
    manager.runPreflightCheck = () => { counts.preflight++; return preflight(); };
    const save = manager.autosave.schedule.bind(manager.autosave);
    manager.autosave.schedule = () => { counts.autosave++; save(); };
    const mutation = manager.onMutation;
    manager.onMutation = (...args) => { counts.mutations++; mutation?.(...args); };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 30, { steps: 16 });
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as DragTestWindow).dragCounts))
    .toEqual({ reflow: 0, preflight: 0, autosave: 0, mutations: 0 });
  const duplicatePaints = await page.evaluate(async ({ x, y }) => {
    const canvas = (window as unknown as DragTestWindow).recto.spreadCanvas;
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const repeat = () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1 }));
    repeat();
    await nextFrame();
    let paints = 0;
    const render = canvas.render;
    canvas.render = function (...args) { paints++; return render.apply(this, args); };
    try {
      for (let step = 0; step < 3; step++) { repeat(); await nextFrame(); }
    } finally {
      canvas.render = render;
    }
    return paints;
  }, { x: point.x + 80, y: point.y + 30 });
  expect(duplicatePaints).toBe(0);
  await page.mouse.up();
  const after = await snapshot(page);
  expect(after.x).not.toBe(before.x);
  expect(after.story).toBe(before.story);
  expect(after.revision).toBe(before.revision + 1);
  await expect.poll(() => page.evaluate(() => (window as unknown as DragTestWindow).dragCounts))
    .toEqual({ reflow: 0, preflight: 1, autosave: 1, mutations: 1 });
  await page.keyboard.press('Control+z');
  const undone = await snapshot(page);
  expect([undone.x, undone.y, undone.story]).toEqual([before.x, before.y, before.story]);
  await page.keyboard.press('Control+Shift+z');
  const redone = await snapshot(page);
  expect([redone.x, redone.y, redone.story]).toEqual([after.x, after.y, after.story]);
});

test('cancels a frame drag on Escape, pointer cancellation, focus loss, or a document edit', async ({ page }) => {
  test.setTimeout(120000);
  const point = await openBook(page);
  const before = await snapshot(page);
  for (const cancel of ['Escape', 'pointercancel', 'blur', 'edit']) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y + 20, { steps: 4 });
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else if (cancel === 'edit') await page.evaluate(() => (window as unknown as DragTestWindow).recto.stateManager.updateSettings({ title: 'Edited during drag' }));
    else await page.evaluate(event => window.dispatchEvent(event === 'pointercancel'
      ? new PointerEvent(event, { pointerId: 1 }) : new Event(event)), cancel);
    await page.mouse.up();
    const after = await snapshot(page);
    expect([after.x, after.y, after.story]).toEqual([before.x, before.y, before.story]);
    expect(after.revision).toBe(before.revision + (cancel === 'edit' ? 1 : 0));
  }
});

test('previews a vector node without revising a 256-page book and commits one undo step', async ({ page }) => {
  await openBook(page, false, true);
  const start = await page.evaluate(() => {
    const browser = window as unknown as DragTestWindow;
    const { stateManager: manager, spreadCanvas: canvas } = browser.recto;
    manager.selectElement('drag-path');
    browser.dragCounts = { reflow: 0, preflight: 0, autosave: 0, mutations: 0 };
    const reflow = manager.reflowStory.bind(manager);
    manager.reflowStory = (id, resume) => { browser.dragCounts.reflow++; reflow(id, resume); };
    const path = manager.getElementById('drag-path') as VectorPathElement;
    const origin = canvas.getSpreadScreenOrigin(manager.getState());
    const box = document.querySelector('#spread-canvas')!.getBoundingClientRect();
    return { x: box.left + origin.x + path.x * 96 / 25.4,
      y: box.top + origin.y + path.y * 96 / 25.4, revision: manager.getDocumentRevision() };
  });
  const read = () => page.evaluate(() => {
    const { stateManager: manager, spreadCanvas: canvas } = (window as unknown as DragTestWindow).recto;
    const path = manager.getElementById('drag-path') as VectorPathElement;
    const preview = canvas.dragPreview.get(path.id) as VectorPathElement | undefined;
    return { revision: manager.getDocumentRevision(), current: path.nodes[0], draft: preview?.nodes[0] };
  });
  const drag = async () => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 34, start.y + 20, { steps: 12 });
  };

  await drag();
  await expect.poll(async () => (await read()).draft?.x ?? 0).toBeGreaterThan(7);
  expect(await read()).toMatchObject({ revision: start.revision, current: { x: 0, y: 0 } });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual({ revision: start.revision, current: { x: 0, y: 0 }, draft: undefined });

  await drag();
  await page.mouse.up();
  expect((await read()).current.x).toBeGreaterThan(7);
  expect((await read()).revision).toBe(start.revision + 1);
  expect(await page.evaluate(() => (window as unknown as DragTestWindow).dragCounts.reflow)).toBe(0);
  await page.keyboard.press('Control+z');
  expect((await read()).current).toEqual({ x: 0, y: 0 });
});

test('draws a pen handle as a preview before saving a mirrored pair', async ({ page }) => {
  const start = await openBook(page);
  await page.getByTitle('Pen Tool (P)').click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const read = () => page.evaluate(() => {
    const { stateManager: manager, spreadCanvas: canvas } = (window as unknown as DragTestWindow).recto;
    const state = manager.getState();
    const path = state.spreads[state.activeSpreadIndex].elements.find((element): element is VectorPathElement => element.type === 'path')!;
    const preview = canvas.dragPreview.get(path.id) as VectorPathElement | undefined;
    return { revision: manager.getDocumentRevision(), saved: path.nodes[0], draft: preview?.nodes[0] };
  });
  const created = await read();
  await page.mouse.move(start.x + 32, start.y + 19, { steps: 8 });
  await expect.poll(async () => (await read()).draft?.handleOut?.x ?? 0).toBeGreaterThan(7);
  expect(await read()).toMatchObject({ revision: created.revision, saved: { x: 0, y: 0 } });
  await page.mouse.up();
  const after = await read();
  expect(after.revision).toBe(created.revision + 1);
  expect(after.saved.handleIn).toEqual({ x: -after.saved.handleOut!.x, y: -after.saved.handleOut!.y });
  await page.keyboard.press('Control+z');
  expect((await read()).saved).toEqual({ x: 0, y: 0 });
});

test('reflows a grid-dependent story once after a drag is released', async ({ page }) => {
  test.setTimeout(120000);
  const point = await openBook(page, true);
  await page.evaluate(() => {
    const current = window as unknown as DragTestWindow;
    current.dragCounts = { reflow: 0, preflight: 0, autosave: 0, mutations: 0 };
    const manager = current.recto.stateManager;
    const original = manager.reflowStory.bind(manager);
    manager.reflowStory = id => { current.dragCounts.reflow++; original(id); };
  });
  const before = await snapshot(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 25, { steps: 12 });
  expect(await page.evaluate(() => (window as unknown as DragTestWindow).dragCounts.reflow)).toBe(0);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as DragTestWindow).dragCounts.reflow)).toBe(1);
  const after = await snapshot(page);
  expect(after.x).not.toBe(before.x);
  expect(after.story).toBe(before.story);
});

test('moves a selected group together, leaves locked artwork fixed, and undoes once', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const base = projectFixture();
  const original = base.spreads[0].elements[0];
  const project = { ...base, spreads: [{ ...base.spreads[0], elements: [
    { ...original, groupId: 'group' },
    { ...original, id: 'second', y: 140, height: 40, groupId: 'group' },
    { ...original, id: 'locked', x: 50, y: 220, height: 40, locked: true },
  ] }] };
  await page.goto('/');
  await projectFileInput(page).setInputFiles({ name: 'group.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByTitle('Click to rename document')).toHaveValue(project.settings.title);
  const point = await page.evaluate(async () => {
    const { stateManager: manager, spreadCanvas: canvas } = (window as unknown as DragTestWindow).recto;
    manager.selectElements(['text-qa', 'second', 'locked']);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = manager.getState(), origin = canvas.getSpreadScreenOrigin(state);
    const box = document.querySelector('#spread-canvas')!.getBoundingClientRect();
    return { x: box.left + origin.x + 90 * 96 / 25.4 * state.zoom,
      y: box.top + origin.y + 60 * 96 / 25.4 * state.zoom };
  });
  const positions = () => page.evaluate(() => {
    const manager = (window as unknown as DragTestWindow).recto.stateManager;
    return ['text-qa', 'second', 'locked'].map(id => {
      const element = manager.getElementById(id)!;
      return { x: element.x, y: element.y };
    });
  });
  const before = await positions();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 25, { steps: 10 });
  expect(await positions()).toEqual(before);
  await page.mouse.up();
  const after = await positions();
  expect(after[0].x).not.toBe(before[0].x);
  expect(after[1].x - before[1].x).toBeCloseTo(after[0].x - before[0].x, 5);
  expect(after[2]).toEqual(before[2]);
  await page.keyboard.press('Control+z');
  expect(await positions()).toEqual(before);
});

test('opens a linked frame and adjusts opacity without recomposing the book', async ({ page }) => {
  test.setTimeout(120000);
  const point = await openBook(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const app = (window as unknown as DragTestWindow);
    app.dragCounts = { reflow: 0, preflight: 0, autosave: 0, mutations: 0 };
    const manager = app.recto.stateManager;
    const reflow = manager.reflowStory.bind(manager);
    manager.reflowStory = id => { app.dragCounts.reflow++; reflow(id); };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('.canvas-inline-editor')).toBeFocused();
  const slider = page.getByRole('slider', { name: /Opacity/ });
  await slider.evaluate(element => {
    const input = element as HTMLInputElement;
    for (const value of ['0.9', '0.8', '0.7', '0.6']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  expect(await snapshot(page)).toEqual(before);
  await slider.dispatchEvent('change');
  const opacity = () => page.evaluate(() => (window as unknown as DragTestWindow).recto.stateManager.getElementById('drag-25')!.opacity);
  expect(await opacity()).toBe(0.6);
  expect(await snapshot(page)).toEqual({ ...before, revision: before.revision + 1 });
  expect(await page.evaluate(() => (window as unknown as DragTestWindow).dragCounts.reflow)).toBe(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  expect(await opacity()).toBe(1);
});

test('resizes a linked text frame with a preview and commits once on release', async ({ page }) => {
  test.setTimeout(120000);
  const point = await openBook(page);
  const width = () => page.evaluate(() =>
    (window as unknown as DragTestWindow).recto.stateManager.getElementById('drag-25')!.width);
  const before = await snapshot(page);
  const originalWidth = await width();
  await page.mouse.move(point.right, point.middle);
  await page.mouse.down();
  await page.mouse.move(point.right - 45, point.middle, { steps: 12 });
  expect(await width()).toBe(originalWidth);
  expect((await snapshot(page)).revision).toBe(before.revision);
  await page.mouse.up();
  expect(await width()).toBeLessThan(originalWidth);
  const after = await snapshot(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.story).toBe(before.story);
  await page.keyboard.press('Control+z');
  expect(await width()).toBe(originalWidth);
});
