import { test, expect } from '@playwright/test';

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
  expect(metrics.javaScript.some(item => /jspdf|pdfExport|epubExport|idmlImport|CoverSpineModal|BookletImpositionModal/.test(item.file))).toBe(false);
  expect(metrics.javaScript.reduce((total, item) => total + item.decodedBytes, 0)).toBeLessThan(1_000_000);
  console.log('STARTUP_METRICS', JSON.stringify(metrics));
});
