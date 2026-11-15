import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { exportDocumentToIdml } from '../src/export/idmlExport';
import { idmlHandoffFindings } from '../src/export/idmlHandoff';
import { parseIdmlPackage } from '../src/idmlImport';
import { plainStory, storyText } from '../src/engine/storyContent';
import type { ImageElement, TextElement } from '../src/types';
import { emptyProductionProject, productionSpread, textFixture } from './fixtures/productionPublications';

it('round-trips a production IDML sample with a threaded story, parent, style and relinkable images', async () => {
  const project = emptyProductionProject('Editorial interchange');
  const [first, second] = [productionSpread(0, 'layout'), productionSpread(1, 'layout')];
  const parent = productionSpread(0, 'parent');
  const style = { ...project.paragraphStyles[0], id: 'body-copy', name: 'Body & notes', fontSizePt: 12 };
  project.paragraphStyles = [style];
  project.masterSpreads = [{ id: 'base-parent', name: 'Editorial parent', prefix: 'A', pages: parent.pages,
    elements: [textFixture('running', parent.pages[0].id, 'Field journal', { height: 8 })] }];
  const body = 'Opening paragraph. '.repeat(85) + '\nLast paragraph of the thread.';
  first.masterSpreadId = second.masterSpreadId = 'base-parent';
  first.elements.push({ ...textFixture('first', first.pages[0].id, '', { height: 40 }), nextFrameId: 'last',
    paragraphStyleId: style.id, storyContent: plainStory(body, style.id) });
  second.elements.push({ ...textFixture('last', second.pages[0].id, ''), prevFrameId: 'first', paragraphStyleId: style.id });
  const png = await readFile('tests/fixtures/icc/alpha-sample.png');
  const image: ImageElement = { id: 'placed-image', type: 'image', pageId: first.pages[0].id, name: 'Sample image.png',
    x: 25, y: 125, width: 90, height: 60, src: 'data:image/png;base64,' + png.toString('base64'), fitMode: 'fill',
    borderColor: 'transparent', borderWidthMm: 0, opacity: 1, rotation: 0, zIndex: 2, locked: false };
  first.elements.push(image);
  second.elements.push({ ...image, id: 'unresolved-image', pageId: second.pages[0].id, src: 'https://example.invalid/missing.png', name: 'missing.png' });
  project.spreads = [first, second];
  expect(idmlHandoffFindings(project)).toContainEqual(expect.objectContaining({ elementId: 'unresolved-image', severity: 'warning' }));
  const bytes = exportDocumentToIdml(project);
  const imported = await parseIdmlPackage(bytes);
  expect(imported.spreads).toHaveLength(2);
  expect(imported.masterSpreads.some(master => master.name === 'Editorial parent' &&
    imported.spreads.every(spread => spread.masterSpreadId === master.id))).toBe(true);
  expect(imported.paragraphStyles).toContainEqual(expect.objectContaining({ fontSizePt: 12 }));
  const frames = imported.spreads.flatMap(spread => spread.elements).filter((element): element is TextElement => element.type === 'text');
  const importedHead = frames.find(frame => frame.nextFrameId);
  expect(storyText(importedHead!.storyContent!)).toBe(body);
  expect(frames.some(frame => frame.prevFrameId === importedHead!.id)).toBe(true);
  expect(imported.spreads[0].elements.find(element => element.type === 'image')).toMatchObject({ src: image.src });
  expect(imported.spreads[1].elements.find(element => element.type === 'image')).toMatchObject({ src: '' });
  await mkdir('build/production-benchmark', { recursive: true });
  await writeFile('build/production-benchmark/editorial-interchange.idml', bytes);
});
