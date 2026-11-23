import { test, expect } from '@playwright/test';
import { writePsdBuffer } from 'ag-psd';

test('opens the editor while the optional workspace font stylesheet is still loading', async ({ page }) => {
  let requested = false;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, async route => {
    const families = new URL(route.request().url()).searchParams.getAll('family');
    if (families.length < 2) { await route.abort(); return; }
    requested = true;
    await pending;
    await route.fulfill({ contentType: 'text/css', body: '/* Workspace font fixture */' });
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator('#spread-canvas')).toBeVisible();
    const title = page.getByTitle('Click to rename document');
    await title.fill('Edited before fonts load');
    await title.press('Enter');
    await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('recto_project_autosave')!).settings.title))
      .toBe('Edited before fonts load');
  } finally { release(); }
  await expect(page.locator('link[href*="JetBrains+Mono"]')).toHaveAttribute('media', 'all');
});

test('records cold startup resources and timings', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#spread-canvas')).toBeVisible({ timeout: 30000 });
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      canvasObservedMs: Math.round(performance.now()),
      javaScript: resources.filter(item => new URL(item.name).pathname.endsWith('.js')).map(item => ({
        file: new URL(item.name).pathname,
        decodedBytes: item.decodedBodySize,
      })),
    };
  });
  expect(metrics.javaScript.some(item => /jspdf|pdfExport|epubExport|idmlImport|psdParser|CoverSpineModal|BookletImpositionModal|CollaborationDialog|NewProjectMenu|ExportMenu/.test(item.file))).toBe(false);
  expect(metrics.javaScript.reduce((total, item) => total + item.decodedBytes, 0)).toBeLessThan(1_000_000);
  console.log('STARTUP_METRICS', JSON.stringify(metrics));
  await page.getByTitle('Live Peer-to-Peer Real-Time Collaboration').click();
  await expect(page.getByRole('heading', { name: 'Real-Time P2P WebRTC Collaboration' })).toBeVisible();
});

test('cold startup defers the Photoshop decoder until a PSD is placed', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const requests: string[] = [];
  page.on('request', request => { if (/\/psdParser-[^/]+\.js$/.test(request.url())) requests.push(request.url()); });
  await page.goto('/');
  await page.waitForFunction(() => 'recto' in window);
  expect(requests).toHaveLength(0);
  const bytes = Array.from(writePsdBuffer({ width: 27, height: 19,
    children: [{ name: 'Lettering', left: 0, top: 0, right: 27, bottom: 19 }] }));
  const result = await page.evaluate(async bytes => {
    const { stateManager: manager } = (window as any).recto;
    const id = 'psd-startup-check';
    manager.addElement({ id, type: 'image', pageId: manager.getActiveSpread().pages[0].id,
      x: 25, y: 30, width: 40, height: 30, src: '', fitMode: 'fit', borderColor: 'transparent',
      borderWidthMm: 0, locked: false, rotation: 0, opacity: 1, zIndex: 1 });
    const loaded = await manager.registerImageAsset(id, new File([Uint8Array.from(bytes)], 'lettering.psd'));
    const frame = manager.getElementById(id);
    return { loaded, width: frame.originalWidth, height: frame.originalHeight, layers: frame.psdLayers?.map((layer: { name: string }) => layer.name) };
  }, bytes);
  expect(result).toEqual({ loaded: true, width: 27, height: 19, layers: ['Lettering'] });
  expect(requests).toHaveLength(1);
});
