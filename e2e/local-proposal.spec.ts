import { expect, test } from '@playwright/test';
import { importProject } from './fixtures';

test('shares the canvas and applies a local proposal as one undoable edit', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.addInitScript(() => {
    const revision = 'a'.repeat(64);
    const key = '1234567890abcdefghij';
    const globals = window as unknown as { __TAURI_INTERNALS__: unknown; proposalPngBytes?: number };
    let draft: string | undefined;
    globals.__TAURI_INTERNALS__ = {
      invoke(command: string, args?: { snapshot: string; canvas: number[] | null }) {
        if (command === 'desktop_begin_proposal_review' && args) {
          globals.proposalPngBytes = args.canvas?.length;
          const next = JSON.parse(args.snapshot);
          next.settings.title = 'Reviewed publication';
          next.spreads[0].elements[0].x = 40;
          draft = JSON.stringify({ format: 'recto-proposal', version: 1, sourceRevision: revision, draft: next });
          return Promise.resolve({ source: `recto-review-${key}.recto`, proposal: `recto-proposal-${key}.rectoproposal`, canvas: `recto-canvas-${key}.png`, revision });
        }
        if (command === 'desktop_read_proposal') return Promise.resolve(draft ?? null);
        return Promise.resolve(null);
      },
      transformCallback() { return 1; },
    };
  });
  await page.goto('/');
  await importProject(page);
  await page.getByTitle('File Management, Project IO, and Document Imports').click();
  await page.getByRole('button', { name: 'Review Publishing Changes…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review publishing changes' });
  await dialog.getByRole('button', { name: 'Choose workspace…' }).click();
  await expect(dialog.getByRole('status')).toContainText('1 edited');
  expect(await page.evaluate(() => (window as unknown as { proposalPngBytes?: number }).proposalPngBytes)).toBeGreaterThan(8);
  const title = page.getByTitle('Click to rename document');
  await expect(title).toHaveValue('Browser QA document');
  await dialog.getByRole('button', { name: 'Apply to document' }).click();
  await expect(title).toHaveValue('Reviewed publication');
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  await expect(title).toHaveValue('Browser QA document');
});
