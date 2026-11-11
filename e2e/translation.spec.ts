import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importProject, projectFixture, savedProject } from './fixtures';

async function openTranslation(page: Page) {
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByText('Production & books', { exact: true }).click();
  await page.getByRole('button', { name: 'Translation workspace', exact: true }).click();
  return page.getByRole('dialog', { name: 'Translation workspace' });
}

async function downloadSource(page: Page, dialog: ReturnType<Page['getByRole']>) {
  await dialog.getByLabel('Target language tag').fill('fr-FR');
  await dialog.getByRole('button', { name: 'Select matching groups' }).click();
  const waiting = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download XLIFF' }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/\.xlf$/);
  return readFile((await download.path())!, 'utf8');
}

async function returnedCopy(page: Page, source: string, mode: 'translated' | 'stale') {
  return page.evaluate(({ xml, mode }) => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = document.documentElement.namespaceURI;
    const segments = [...document.getElementsByTagNameNS(ns, 'segment')];
    const segment = segments.find(element => element.textContent?.includes('Browser workflow sample'))!;
    const original = segment.getElementsByTagNameNS(ns, 'source')[0];
    if (mode === 'stale') original.firstChild!.nodeValue = 'Different version of the manuscript';
    const target = document.createElementNS(ns, 'target');
    target.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    for (const child of original.childNodes) {
      const translated = child.cloneNode(true);
      if (translated.nodeType === Node.TEXT_NODE) translated.nodeValue = translated.nodeValue?.replace('Browser ', 'Exemple ') || '';
      else if (translated.nodeType === Node.ELEMENT_NODE && (translated as Element).localName === 'pc') translated.textContent = 'du document';
      target.appendChild(translated);
    }
    segment.appendChild(target);
    segment.setAttribute('state', 'translated');
    return new XMLSerializer().serializeToString(document);
  }, { xml: source, mode });
}

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#spread-canvas')).toBeVisible();
});

test('round-trips XLIFF with formatting, proofing and a separate editable edition', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.settings, { language: 'en-US' });
  Object.assign(project.spreads[0].elements[0], { storyContent: { version: 1, paragraphs: [{ id: 'opening',
    runs: [{ text: 'Browser ' }, { text: 'workflow sample', bold: true }] }] } });
  await importProject(page, project);
  const dialog = await openTranslation(page);
  const source = await downloadSource(page, dialog);
  expect(source).toContain('canResegment="no"');
  expect(source).toContain('canDelete="no"');
  const translated = await returnedCopy(page, source, 'translated');
  await dialog.getByRole('button', { name: 'Review returned translations' }).click();
  await dialog.getByLabel('Returned XLIFF file').setInputFiles({
    name: 'returned.xlf', mimeType: 'application/xliff+xml', buffer: Buffer.from(translated),
  });
  await expect(dialog.getByText('Exemple du document', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Edit translated wording' }).click();
  await dialog.getByLabel('Formatted passage 2').fill('de la revue');
  await dialog.getByRole('button', { name: 'Save unit edit' }).click();
  await expect(dialog.getByText('Exemple de la revue', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Select ready matches' }).click();
  await dialog.getByRole('button', { name: 'Preview translated edition' }).click();
  await expect(dialog.getByRole('region', { name: 'Translated edition proof' })).toBeVisible();
  await dialog.getByText('Compare composed text frames', { exact: true }).click();
  await expect(dialog.getByRole('img', { name: /Translated frame, page 1/ })).toBeVisible();
  const waiting = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save translated edition' }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/fr-FR\.recto$/);
  const edition = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(edition.settings.language).toBe('fr-FR');
  expect(edition.spreads[0].elements[0]).toMatchObject({ id: 'text-qa', pageId: 'page-qa', width: 150,
    text: 'Exemple de la revue', storyContent: { paragraphs: [{ id: 'opening',
      runs: [{ text: 'Exemple ' }, { text: 'de la revue', bold: true }] }] } });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await savedProject(page)).spreads[0].elements[0].text).toBe('Browser workflow sample');
  await importProject(page, edition);
  expect((await savedProject(page)).spreads[0].elements[0].text).toBe('Exemple de la revue');
});

test('chooses between memory alternatives and exports a bilingual review', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.settings, { language: 'en-US' });
  await importProject(page, project);
  const dialog = await openTranslation(page);
  await dialog.getByRole('button', { name: 'Select matching groups' }).click();
  await dialog.getByText('Translation memory', { exact: true }).click();
  await dialog.getByLabel('Open or merge a translation memory').setInputFiles({
    name: 'french.rectotm', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      version: 1, sourceLanguage: 'en-US', targetLanguage: 'fr-FR',
      entries: [{ source: 'Browser workflow sample', targets: ['Exemple de flux', 'Exemple de procédure'] }],
    })),
  });
  await expect(dialog.getByText('Translation memory loaded.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review memory matches' })).toBeDisabled();
  await dialog.getByLabel('Choose a translation').selectOption('Exemple de procédure');
  await dialog.getByRole('button', { name: 'Review memory matches' }).click();
  await expect(dialog.getByText('Exemple de procédure', { exact: true })).toBeVisible();
  await dialog.getByText('Terminology and numeric checks', { exact: true }).click();
  const glossaryFile = dialog.getByLabel('Open glossary', { exact: true });
  await glossaryFile.setInputFiles({
    name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('missing delimiter'),
  });
  await expect(dialog.getByRole('alert')).toContainText('Glossary line 1');
  await glossaryFile.setInputFiles({
    name: 'terminology.txt', mimeType: 'text/plain', buffer: Buffer.from('\uFEFFsample\téchantillon\n'),
  });
  await expect(dialog.getByText('Glossary loaded.', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Preferred translations')).toHaveValue('sample\téchantillon\n');
  await dialog.getByRole('button', { name: 'Check translation quality' }).click();
  await expect(dialog.getByText('Review “sample”. The glossary prefers “échantillon”.', { exact: true })).toBeVisible();
  const glossaryDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save glossary' }).click();
  const savedGlossary = await glossaryDownload;
  expect(savedGlossary.suggestedFilename()).toMatch(/glossary\.txt$/);
  expect(await readFile((await savedGlossary.path())!, 'utf8')).toBe('sample\téchantillon\n');
  await dialog.getByRole('button', { name: 'Select ready matches' }).click();
  const waiting = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download bilingual review' }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/bilingual-review\.html$/);
  const html = await readFile((await download.path())!, 'utf8');
  expect(html).toContain('Content-Security-Policy');
  expect(html).toContain('Browser workflow sample');
  expect(html).toContain('Exemple de procédure');
  expect(html).toContain('Selected for edition');
  expect(html).toContain('échantillon');
});

test('rejects unsafe XML declarations and marks stale source units for review', async ({ page }) => {
  await importProject(page);
  const dialog = await openTranslation(page);
  const source = await downloadSource(page, dialog);
  await dialog.getByRole('button', { name: 'Review returned translations' }).click();
  const picker = dialog.getByLabel('Returned XLIFF file');
  await picker.setInputFiles({ name: 'unsafe.xlf', mimeType: 'application/xml',
    buffer: Buffer.from(source.replace('<xliff ', '<!DOCTYPE xliff [<!ENTITY x "expanded">]><xliff ')) });
  await expect(dialog.getByRole('alert')).toContainText('entity declarations');
  await picker.setInputFiles({ name: 'stale.xlf', mimeType: 'application/xml', buffer: Buffer.from(await returnedCopy(page, source, 'stale')) });
  await expect(dialog.getByText('Source text or inline codes changed since export.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Preview translated edition' })).toBeDisabled();
});

test('keeps valid units available when another target uses unsupported inline codes', async ({ page }) => {
  await importProject(page);
  const dialog = await openTranslation(page);
  const source = await downloadSource(page, dialog);
  const returned = await page.evaluate(xml => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = document.documentElement.namespaceURI;
    for (const segment of document.getElementsByTagNameNS(ns, 'segment')) {
      const source = segment.getElementsByTagNameNS(ns, 'source')[0].textContent;
      const target = document.createElementNS(ns, 'target');
      if (source === 'Browser workflow sample') {
        const unsupported = document.createElementNS(ns, 'mrk');
        unsupported.textContent = 'Le texte annoté';
        target.appendChild(unsupported);
      } else {
        target.textContent = 'Titre français';
      }
      segment.setAttribute('state', 'translated');
      segment.appendChild(target);
    }
    return new XMLSerializer().serializeToString(document);
  }, source);
  await dialog.getByRole('button', { name: 'Review returned translations' }).click();
  await dialog.getByLabel('Returned XLIFF file').setInputFiles({
    name: 'mixed-return.xlf', mimeType: 'application/xml', buffer: Buffer.from(returned),
  });
  await expect(dialog.getByText('Invalid inline codes', { exact: false }).filter({ visible: true })).toBeVisible();
  await expect(dialog.getByText('Titre français', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Select ready matches' }).click();
  await expect(dialog.getByText('1 selected', { exact: true })).toBeVisible();
});

test('imports namespace-prefixed XLIFF and keeps a live field in the translated story', async ({ page }) => {
  const project = projectFixture();
  Object.assign(project.settings, { language: 'en-US' });
  Object.assign(project.spreads[0].elements[0], { text: 'Page {{page}} & editorial', storyContent: { version: 1, paragraphs: [{
    id: 'live-field', runs: [{ text: 'Page ' }, { text: '{{page}}' }, { text: ' & editorial', italic: true }],
  }] } });
  await importProject(page, project);
  const dialog = await openTranslation(page);
  const source = await downloadSource(page, dialog);
  expect(source).toContain('disp="Publication field"');
  expect(source).toContain(' &amp; editorial');

  const returned = await page.evaluate(xml => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = document.documentElement.namespaceURI;
    const segment = [...document.getElementsByTagNameNS(ns, 'segment')]
      .find(item => item.getElementsByTagNameNS(ns, 'ph').length)!;
    const source = segment.getElementsByTagNameNS(ns, 'source')[0];
    const target = document.createElementNS(ns, 'target');
    const marker = source.getElementsByTagNameNS(ns, 'ph')[0].cloneNode(true);
    const format = source.getElementsByTagNameNS(ns, 'pc')[0].cloneNode(true);
    format.textContent = '<revue>';
    target.append(format, document.createTextNode(' au feuillet '), marker);
    segment.append(target);
    segment.setAttribute('state', 'translated');
    const serialized = new XMLSerializer().serializeToString(document);
    return serialized.replace(/<(\/?)(xliff|file|group|unit|notes|note|segment|source|target|ph|pc)\b/g, '<$1x:$2')
      .replace('xmlns=', 'xmlns:x=');
  }, source);

  await dialog.getByRole('button', { name: 'Review returned translations' }).click();
  await dialog.getByLabel('Returned XLIFF file').setInputFiles({
    name: 'qualified.xlf', mimeType: 'application/xml', buffer: Buffer.from(returned),
  });
  await expect(dialog.getByText('<revue> au feuillet {{page}}', { exact: true })).toBeVisible();
  await expect(dialog.locator('revue')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Select ready matches' }).click();
  await dialog.getByRole('button', { name: 'Preview translated edition' }).click();
  const waiting = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save translated edition' }).click();
  const edition = JSON.parse(await readFile((await (await waiting).path())!, 'utf8'));
  const paragraph = edition.spreads[0].elements[0].storyContent.paragraphs[0];
  expect(paragraph).toMatchObject({ id: 'live-field', language: 'fr-FR',
    runs: [{ text: '<revue>', italic: true }, { text: ' au feuillet ' }, { text: '{{page}}' }] });
});
