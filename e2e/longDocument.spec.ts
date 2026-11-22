import { test, expect } from '@playwright/test';
import { importProject, projectFileInput, projectFixture, savedProject } from './fixtures';

test('renders large spreads at 300 percent without allocating a spread-sized background', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  const project = Object.assign(projectFixture(), { showGuides: true, showBaselineGrid: true });
  Object.assign(project.settings, { title: 'Large proof', widthMm: 900, heightMm: 650,
    baselineGrid: { enabled: true, incrementPt: 12, startMm: 20 } });
  project.spreads[0].elements = [];
  await importProject(page, project);
  const renderAt = (zoom: number) => page.evaluate(zoom => {
    const { stateManager, spreadCanvas } = (window as any).recto;
    const canvas = document.querySelector<HTMLCanvasElement>('#spread-canvas')!;
    const rect = canvas.getBoundingClientRect();
    const { settings } = stateManager.getState();
    const scale = zoom * 96 / 25.4;
    stateManager.setZoomAndPan(zoom, 40 - (rect.width - settings.widthMm * scale) / 2,
      35 - (rect.height - settings.heightMm * scale) / 2);
    spreadCanvas.render();
    const origin = spreadCanvas.getSpreadScreenOrigin(stateManager.getState());
    const ctx = canvas.getContext('2d')!;
    const dpr = ctx.getTransform().a;
    const white = Array.from(ctx.getImageData(Math.round((origin.x + 14) * dpr), Math.round((origin.y + 14) * dpr), 1, 1).data);
    const gridX = origin.x + (settings.margins.insideMm + 8) * scale;
    const gridY = origin.y + (settings.baselineGrid.startMm + 12 * 25.4 / 72) * scale;
    const pixels = ctx.getImageData(Math.round(gridX * dpr), Math.round(gridY * dpr) - 1, 1, 3).data;
    return { cachedPixels: spreadCanvas.staticCanvas.width * spreadCanvas.staticCanvas.height,
      white, baseline: [0, 4, 8].some(index => pixels[index + 2] > pixels[index]) };
  }, zoom);

  expect((await renderAt(0.3)).cachedPixels).toBeGreaterThan(0);
  expect(await renderAt(3)).toEqual({ cachedPixels: 0, white: [255, 255, 255, 255], baseline: true });
  expect((await renderAt(0.3)).cachedPixels).toBeGreaterThan(0);
});

test('keeps decoded artwork bounded while paging and drops it when opening another project', async ({ page }) => {
  const project = projectFixture();
  const base = project.spreads[0].elements[0];
  const spreads = Array.from({ length: 20 }, (_, index) => ({
    id: `spread-${index}`, spreadIndex: index,
    pages: [{ id: `page-${index}`, pageNumber: index + 1, side: 'single' }],
    elements: [{ ...base, id: `art-${index}`, pageId: `page-${index}`, type: 'image', fitMode: 'fit',
      proxySrc: index === 0 ? 'data:image/png;base64,YmFk' : undefined,
      src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="rgb(${index},90,140)"/></svg>`)}` }],
  }));
  spreads[0].elements.push({ ...spreads[0].elements[0], id: 'offscreen-art',
    x: 5_000, src: spreads.at(-1)!.elements[0].src, proxySrc: undefined });
  project.spreads = spreads;
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page, project);
  const cache = () => page.evaluate(() => {
    const { stateManager: manager, spreadCanvas: canvas } = (window as unknown as {
      recto: { stateManager: { getActiveSpread(): { elements: { src?: string }[] } };
        spreadCanvas: { proxyCache: Map<string, HTMLCanvasElement>; fullResCache: Map<string, HTMLImageElement> } };
    }).recto;
    const source = manager.getActiveSpread().elements[0]?.src || '';
    const originalReady = Boolean(canvas.fullResCache.get(source)?.naturalWidth);
    return { proxyCount: canvas.proxyCache.size, originalCount: canvas.fullResCache.size,
      ready: canvas.proxyCache.has(source) || originalReady, originalReady };
  });
  const navigate = (index: number, quality?: 'typical' | 'high') => page.evaluate(({ index, quality }) => {
    const manager = (window as unknown as { recto: { stateManager: {
      setActiveSpread(index: number): void; setDisplayQuality(quality: 'typical' | 'high'): void;
    } } }).recto.stateManager;
    if (quality) manager.setDisplayQuality(quality);
    manager.setActiveSpread(index);
  }, { index, quality });

  for (let index = 0; index < project.spreads.length; index++) {
    await navigate(index);
    await expect.poll(async () => (await cache()).ready).toBe(true);
    if (index === 0) expect((await cache()).proxyCount).toBe(1);
  }
  expect((await cache()).proxyCount).toBeLessThanOrEqual(13);
  await navigate(1, 'high');
  await expect.poll(cache).toMatchObject({ originalCount: 1, originalReady: true });
  await navigate(2);
  await expect.poll(cache).toMatchObject({ originalCount: 1, originalReady: true });
  const blank = projectFixture();
  blank.settings.title = 'Another publication';
  await importProject(page, blank);
  await expect.poll(cache).toMatchObject({ proxyCount: 0, originalCount: 0, ready: false });
});

test('keeps a 256-page overview bounded and preserves editable text', async ({ page }) => {
  test.setTimeout(120000);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = projectFixture();
  project.settings.title = 'Long document navigation';
  const paragraph = 'The manuscript remains editable while its page preview is reused. '.repeat(70);
  project.spreads = Array.from({ length: 256 }, (_, index) => ({
    id: `spread-${index}`, spreadIndex: index,
    pages: [{ id: `page-${index}`, pageNumber: index + 1, side: 'single' }],
    elements: [{ ...project.spreads[0].elements[0], id: `text-${index}`, pageId: `page-${index}`,
      x: 20, y: 20, width: 170, height: 250, fontFamily: 'Times New Roman, serif', fontSizePt: 11,
      text: paragraph, storyContent: { version: 1, paragraphs: [{ runs: [{ text: paragraph }] }] } }],
  }));
  await page.goto('/');
  await projectFileInput(page).setInputFiles({ name: 'long.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByTitle('Click to rename document')).toHaveValue(project.settings.title);
  await page.getByRole('button', { name: 'All spreads', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Multi-spread workspace' });
  const firstPreview = workspace.locator('[data-workspace-object="text-0"] [data-text-preview]');
  await expect(firstPreview).toBeVisible();
  const path = await firstPreview.getAttribute('d');
  expect(path).toMatch(/^M/);
  const scroll = workspace.locator('.spatial-scroll');
  for (const top of [20, 40, 60]) {
    await scroll.evaluate((element, top) => { element.scrollTop = top; element.dispatchEvent(new Event('scroll')); }, top);
    await expect(firstPreview).toHaveAttribute('d', path!);
  }
  await workspace.getByLabel('Workspace zoom').selectOption('1');
  await expect(workspace.locator('[data-workspace-object] canvas, [data-workspace-object] text').first()).toHaveCount(0);
  await workspace.getByLabel('Workspace zoom').selectOption('0.15');
  expect(await workspace.locator('[data-workspace-object]').count()).toBeLessThan(128);
  expect(await workspace.locator('svg *').count()).toBeLessThan(3000);

  await scroll.evaluate(element => { element.scrollTop = 0; });
  const source = workspace.locator('[data-workspace-object="text-0"]');
  const target = workspace.locator('[data-workspace-page="page-1"]');
  const bounds = (await source.boundingBox())!;
  const destination = (await target.boundingBox())!;
  const dragLayer = workspace.locator('[data-workspace-drag-layer]');
  const preview = dragLayer.locator('[data-workspace-drag-object="text-0"]');
  await page.mouse.move(bounds.x + 15, bounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(destination.x + 25, destination.y + 25);
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(workspace).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(source).toBeVisible();

  await page.mouse.move(bounds.x + 15, bounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(destination.x + 25, destination.y + 25, { steps: 10 });
  await expect(source).toHaveAttribute('visibility', 'hidden');
  await expect(preview).toBeVisible();
  await expect.poll(async () => (await preview.boundingBox())?.x ?? 0).toBeGreaterThan(destination.x);
  expect(await dragLayer.evaluate(element => element.parentElement?.lastElementChild === element)).toBe(true);
  expect(await target.evaluate(element => element.closest('g')?.querySelector('[data-workspace-object="text-0"]'))).toBeNull();
  await page.mouse.up();
  await expect(workspace.getByRole('status')).toHaveText('Artwork moved to target page.');
  await expect(preview).toHaveCount(0);

  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(workspace.locator('[data-workspace-page="page-255"]')).toBeAttached();
  await page.getByRole('button', { name: 'Return to spread editor' }).click();
  const saved = await savedProject(page);
  expect(saved.spreads).toHaveLength(256);
  expect(saved.spreads[0].elements).toHaveLength(0);
  expect(saved.spreads[1].elements.find((element: { id: string }) => element.id === 'text-0')?.text).toBe(paragraph);
  expect(saved.spreads[255].elements[0].storyContent.paragraphs[0].runs[0].text).toBe(paragraph);
  expect(errors).toEqual([]);
});
