import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { assembleArchivedBook } from '../src/engine/bookArchive';
import { captureComposedLayout } from '../src/engine/layoutChanges';
import { publicationSnapshot } from '../src/engine/publicationReferences';
import { publicationPreflight } from '../src/engine/publicationPreflight';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { INITIAL_STATE } from '../src/state/defaults';
import { parseProject } from '../src/state/projectValidation';
import { StateManager } from '../src/state/stateManager';
import { editorialMagazineFixture, nonfictionBookFixture } from '../tests/fixtures/productionPublications';

const images = Array.from({ length: 18 }, (_, index) => {
  const canvas = createCanvas(640, 480), context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 640, 480);
  gradient.addColorStop(0, '#' + ((index * 711479 + 0x122638) % 0xffffff).toString(16).padStart(6, '0'));
  gradient.addColorStop(1, '#ede2c7');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 640, 480);
  for (let row = 0; row < 160; row++) {
    context.fillStyle = row % 2 ? '#23314522' : '#e7927933';
    context.fillRect((row * 71 + index * 171) % 640, (row * 29) % 480, 31 + row % 130, 8 + row % 50);
  }
  return canvas.toDataURL('image/png');
});

const output = 'build/production-benchmark';
await mkdir(output, { recursive: true });
const book = nonfictionBookFixture();
const magazine = editorialMagazineFixture(images);
const assembled = assembleArchivedBook(book);
assert.equal(assembled.pages.length, 250);
assert.equal(magazine.spreads.length, 40);
await writeFile(output + '/nonfiction.rectobook', JSON.stringify({ version: 2, ...book }));
await writeFile(output + '/nonfiction.recto', JSON.stringify(assembled.source));
await writeFile(output + '/magazine.recto', JSON.stringify(magazine));

const metrics: Record<string, number> = {};
async function measure<T>(name: string, fn: () => T | Promise<T>) {
  const start = performance.now();
  const result = await fn();
  metrics[name] = Math.round(performance.now() - start);
  console.log(name + ' ' + metrics[name] + ' ms');
  return result;
}

for (const [name, source, expected] of [['book', assembled.source, 250], ['magazine', magazine, 40]] as const) {
  const serialized = JSON.stringify(source);
  const parsed = await measure(name + '.parse', () => parseProject(serialized, INITIAL_STATE));
  const state = await measure(name + '.compose', () => publicationSnapshot(parsed));
  const layout = await measure(name + '.layout-report', () => captureComposedLayout(state));
  assert.equal(layout.pageCount, expected);
  const issues = await measure(name + '.preflight', () => publicationPreflight(state, 'print'));
  metrics[name + '.findings'] = issues.length;
  const manager = new StateManager();
  await measure(name + '.open', () => manager.loadFromJson(serialized));
  await measure(name + '.spread-navigation', () => {
    for (let index = 0; index < source.spreads.length; index++) manager.setActiveSpread(index);
    assert.equal(manager.getActiveSpread().id, source.spreads.at(-1)?.id);
    manager.setActiveSpread(0);
  });
  const text = manager.getActiveSpread().elements.find(element => element.type === 'text' && element.storyContent);
  assert(text?.type === 'text');
  const originalStory = manager.getStoryContent(text.id);
  const first = originalStory.paragraphs[0].runs[0].text;
  const edited = structuredClone(originalStory);
  edited.paragraphs[0].runs[0].text = first + ' Revised.';
  await measure(name + '.edit-reflow', () => manager.setStoryContent(text.id, edited));
  assert.equal(manager.getStoryContent(text.id).paragraphs[0].runs[0].text, first + ' Revised.');
  const pdf = await measure(name + '.pdf-export', () => exportDocumentToPdf(state, { download: false, fetchExternalAssets: false }));
  assert.equal(pdf.getNumberOfPages(), expected);
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  assert(bytes.subarray(0, 5).toString() === '%PDF-');
  await writeFile(output + '/' + name + '.pdf', bytes);
}
const peakRssMiB = Math.round(process.resourceUsage().maxRSS / 1024);
const report = { node: process.version, platform: process.platform, arch: process.arch, peakRssMiB, metrics };
await writeFile(output + '/metrics.json', JSON.stringify(report, null, 2));
console.log('Peak resident memory ' + peakRssMiB + ' MiB');
if (process.argv.includes('--ci')) {
  assert(Object.entries(metrics).every(([name, value]) => name.endsWith('.findings') || value < 180_000), 'A production operation exceeded three minutes.');
  assert(peakRssMiB < 2304, 'Production benchmark exceeded 2.25 GiB resident memory.');
}
