import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import type { TextElement } from '../src/types';

it('renders each stdin record through a trusted importer with every template page', async () => {
  await mkdir('test-results/headless', { recursive: true });
  const root = await mkdtemp(path.resolve('test-results/headless/render-'));
  const template = path.join(root, 'template.recto');
  const plugin = path.join(root, 'importer.mjs');
  const output = path.join(root, 'catalogs');
  const manager = new StateManager(); manager.createBlankProject('A4', 'Catalog for {{name}}', false);
  const state = manager.getState();
  const body: TextElement = { id: 'first', pageId: state.spreads[0].pages[0].id, type: 'text', text: 'Hello {{name}}', x: 20, y: 20,
    width: 130, height: 35, rotation: 0, opacity: 1, locked: false, zIndex: 1, fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.3,
    letterSpacingPt: 0, color: '#111', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0,
    backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
  state.spreads[0].elements.push(body);
  state.spreads.push({ id: 'second-spread', spreadIndex: 1, pages: [{ id: 'second-page', pageNumber: 2, side: 'single' }],
    elements: [{ ...body, id: 'second', pageId: 'second-page', text: 'Product {{product}}' }] });
  await writeFile(template, JSON.stringify(state));
  await writeFile(plugin, 'export default { apiVersion: 1, parseRecords({ bytes }) { return JSON.parse(new TextDecoder().decode(bytes)); } };');
  const run = promisify(execFile)(process.execPath, ['bin/recto.js', 'render', template, '--data=-', `--output=${output}`, `--importer=${plugin}`], { timeout: 45000 });
  run.child.stdin!.end(JSON.stringify([{ name: 'Ada', product: 'Paper' }, { name: 'Lin', product: 'Ink' }]));
  await run;
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  expect(manifest.files).toEqual(['record-00001.pdf', 'record-00002.pdf']);
  for (const [index, name] of manifest.files.entries()) {
    const pdf = await PDFDocument.load(await readFile(path.join(output, name)));
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe(`Catalog for ${index === 0 ? 'Ada' : 'Lin'}`);
  }
}, 60000);
