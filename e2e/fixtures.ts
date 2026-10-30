import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export function projectFixture() {
  return {
    settings: { title: 'Browser QA document', widthMm: 210, heightMm: 297 },
    activeSpreadIndex: 0,
    selectedElementId: 'text-qa', selectedElementIds: ['text-qa'],
    spreads: [{
      id: 'spread-qa', spreadIndex: 0, pages: [{ id: 'page-qa', pageNumber: 1, side: 'single' }],
      elements: [{
        id: 'text-qa', pageId: 'page-qa', type: 'text', x: 25, y: 35, width: 150, height: 80,
        rotation: 0, opacity: 1, zIndex: 1, locked: false,
        text: 'Browser workflow sample', fontFamily: 'Georgia, serif', fontSizePt: 20,
        lineHeight: 1.3, letterSpacingPt: 0, alignment: 'left', columns: 1,
        columnGutterMm: 4, paddingMm: 2, borderColor: 'transparent', borderWidthMm: 0,
        backgroundColor: 'transparent', color: '#111111',
      }],
    }],
    masterSpreads: [],
  };
}

export async function importProject(page: Page, project = projectFixture()) {
  await page.locator('input[accept=".recto,.papercut,.json,.idml,.indd"]').setInputFiles({
    name: 'browser-test.recto', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTitle('Click to rename document')).toHaveValue(project.settings.title);
}

export async function menuCommand(page: Page, title: string) {
  await page.getByTitle('File Management, Project IO, and Document Imports').click();
  await page.getByTitle(title, { exact: true }).click();
}

export async function savedProject(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByTitle('Save .recto project to disk (Ctrl+S)').click();
  const path = await (await download).path();
  return JSON.parse(await readFile(path!, 'utf8'));
}
