import { expect, test } from '@playwright/test';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importProject, projectFixture } from './fixtures';

test('keeps the approved proof and comments with a book chapter after repagination', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await importProject(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  const upload = page.getByLabel('Add .recto chapters or open a saved .rectobook');
  const first = projectFixture();
  first.settings.title = 'Opening chapter';
  const insert = (state: typeof first, index: number) => {
    const addition = structuredClone(first.spreads[0]);
    addition.id = 'inserted-spread-' + index;
    addition.spreadIndex = index;
    addition.pages[0].id = 'inserted-page-' + index;
    addition.pages[0].pageNumber = index + 1;
    addition.elements = [];
    state.spreads.push(addition);
  };
  for (let index = 1; index < 31; index++) insert(first, index);
  const second = projectFixture();
  second.settings.title = 'Sources chapter';
  second.spreads[0].elements[0].text = 'Sources and bibliography';
  const json = (name: string, value: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await upload.setInputFiles([json('opening.recto', first), json('sources.recto', second)]);
  const dialog = page.getByRole('dialog', { name: 'Book proof review' });
  await page.getByRole('button', { name: 'Review book proof', exact: true }).click();
  await dialog.getByRole('button', { name: 'Prepare book proof' }).click();
  await expect(dialog.getByRole('status')).toContainText('Current proof ready');
  const pdfDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download current proof' }).click();
  const pdf = await PDFDocument.load(await readFile((await (await pdfDownload).path())!));
  expect(pdf.getPageCount()).toBe(33);
  const note = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [65, 600, 80, 620],
    T: PDFHexString.fromText('Editor'), Contents: PDFHexString.fromText('Check this citation before printing') });
  pdf.getPage(32).node.addAnnot(pdf.context.register(note));
  const duplicatePageNote = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [65, 600, 80, 620],
    T: PDFHexString.fromText('Editor'), Contents: PDFHexString.fromText('Place this blank-page note manually') });
  pdf.getPage(2).node.addAnnot(pdf.context.register(duplicatePageNote));
  await dialog.getByRole('button', { name: 'Approve current proof' }).click();
  await expect(dialog.getByRole('status')).toContainText('Proof approved');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const save = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save book archive' }).click();
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  const approved = await save();
  expect(approved.proof.pages[32].chapterTitle).toBe('Sources chapter');
  insert(approved.chapters[0].state, 31); insert(approved.chapters[0].state, 32);
  await upload.setInputFiles(json('revised.rectobook', approved));
  await expect(page.getByRole('status').filter({ hasText: '2 chapters loaded locally.' })).toBeVisible();
  await page.getByRole('button', { name: 'Review book proof', exact: true }).click();
  await dialog.getByRole('button', { name: 'Compare against approved proof' }).click();
  await expect(dialog.getByRole('button', { name: 'Page 33 → 35 · Moved', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole('alert')).toContainText('Cover dimensions changed');
  await dialog.getByLabel('Show pages').selectOption('moved');
  await expect(dialog.getByRole('button', { name: 'Page 32 · Added', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Show pages').selectOption('all');
  await expect(dialog.getByRole('button', { name: 'Page 32 · Added', exact: true })).toBeVisible();
  await dialog.getByLabel('Import comments from annotated approved proof').setInputFiles({
    name: 'annotated.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await expect(dialog.getByRole('status')).toContainText('1 notes imported.', { timeout: 60_000 });
  await dialog.getByText('Comments to place manually (1)', { exact: true }).click();
  await expect(dialog.getByText('Place this blank-page note manually', { exact: false })).toBeVisible();
  const revisedPdf = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download current proof' }).click();
  const revisedHash = createHash('sha256').update(await readFile((await (await revisedPdf).path())!)).digest('hex');
  const reportDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save revision report' }).click();
  const report = JSON.parse(await readFile((await (await reportDownload).path())!, 'utf8'));
  expect(report).toMatchObject({ approvedSha256: approved.proof.sha256, currentSha256: revisedHash, coverReview: true,
    pendingComments: [{ pageNumber: 3, author: 'Editor', text: 'Place this blank-page note manually' }] });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const saved = await save();
  expect(saved.chapters[1].state.comments).toContainEqual(expect.objectContaining({
    pageId: 'page-qa', spreadId: 'spread-qa', text: 'Check this citation before printing',
  }));
});
