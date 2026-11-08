import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { StateManager } from '../src/state/stateManager';
import { fontManager } from '../src/fontManager';
import { generateEpubPackage, exportDocumentToEpub } from '../src/epubExport';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { embeddedAsset, prepareExportAssets } from '../src/export/publicationAssets';
import { publicationId } from '../src/engine/publicationReferences';
import { readZip } from '../src/zip';
import { packageDocument } from '../src/packageExport';
import type { ImageElement, TextElement } from '../src/types';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function fixture() {
  const manager = new StateManager(); manager.createBlankProject('A4', 'Editorial export', false);
  manager.getState().masterSpreads = [];
  const body: TextElement = { id: 'body', type: 'text', pageId: manager.getActiveSpread().pages[0].id,
    x: 25, y: 25, width: 160, height: 200, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    text: '', fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.4, letterSpacingPt: 0,
    color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 0,
    backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
  manager.addElement(body);
  manager.setStoryContent(body.id, { version: 1, paragraphs: [{ styleId: 'style-h1', runs: [{ text: 'A chapter & its notes' }] }, { runs: [{ text: 'The manuscript body.' }] }] });
  return { manager, body };
}
function image(manager: StateManager, id: string, src: string): ImageElement {
  const image: ImageElement = { id, pageId: manager.getActiveSpread().pages[0].id, type: 'image', x: 25, y: 240,
    width: 20, height: 20, rotation: 0, opacity: 1, zIndex: 2, locked: false,
    src, altText: 'A small test image', fitMode: 'fit', borderColor: 'transparent', borderWidthMm: 0 };
  manager.addElement(image); return image;
}

describe('portable and accessible publication output', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('writes packaged images, language, heading navigation and note backlinks', () => {
    const { manager } = fixture();
    manager.updateSettings({ language: 'de', author: 'A & B' });
    const note = manager.insertFootnote('body', 'A citation & explanation.');
    image(manager, 'one', png); image(manager, 'two', png);
    const files = generateEpubPackage(manager.getState(), { strict: true });
    expect(Object.keys(files).filter(name => name.startsWith('OEBPS/images/'))).toHaveLength(1);
    expect(files['OEBPS/page_1.xhtml']).toContain('role="doc-noteref"');
    expect(files['OEBPS/page_1.xhtml']).toContain(`notes.xhtml#${publicationId('note', note.id)}`);
    expect(files['OEBPS/notes.xhtml']).toContain(`page_1.xhtml#${publicationId('noteref', note.id)}`);
    expect(files['OEBPS/package.opf']).toContain('<dc:language>de</dc:language>');
    expect(files['OEBPS/package.opf']).toContain('A &amp; B');
    expect(files['OEBPS/nav.xhtml']).toContain('A chapter &amp; its notes');
    expect(files['OEBPS/page_1.xhtml']).not.toContain('data:image');
    const folder = 'test-results/editorial-publication'; mkdirSync(folder, { recursive: true });
    writeFileSync(`${folder}/notes-and-images.epub`, exportDocumentToEpub(manager.getState(), { strict: true, download: false }).buffer);
  });

  it('uses empty alternative text for decorative artwork', () => {
    const { manager } = fixture(); image(manager, 'decorative', png);
    manager.updateElement('decorative', { decorative: true });
    const files = generateEpubPackage(manager.getState());
    expect(files['OEBPS/page_1.xhtml']).toContain('alt="" role="presentation"');
  });

  it('freezes external image bytes without altering the live publication', async () => {
    const { manager } = fixture(); image(manager, 'linked', 'https://example.test/photo.png');
    const saved = manager.exportJson();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(embeddedAsset(png).bytes as BodyInit, { status: 200 })));
    const prepared = await prepareExportAssets(manager.getState(), true);
    expect((prepared.spreads[0].elements.find(item => item.id === 'linked') as ImageElement).src).toBe(png);
    expect(manager.exportJson()).toBe(saved);
    const files = generateEpubPackage(prepared);
    expect(files['OEBPS/page_1.xhtml']).not.toContain('example.test');
  });

  it('rejects unavailable image links instead of creating a broken ebook', async () => {
    const { manager } = fixture(); image(manager, 'missing', 'https://example.test/missing.png');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(prepareExportAssets(manager.getState(), true)).rejects.toThrow('404');
    expect(() => generateEpubPackage(manager.getState())).toThrow(/Embed or relink/);
  });

  it('preserves legacy SVG data URL forms and rejects active SVG content', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    expect(embeddedAsset(`data:image/svg+xml;utf8,${encodeURIComponent(source)}`).mediaType).toBe('image/svg+xml');
    expect(() => embeddedAsset('data:image/svg+xml;utf8,<svg onload="bad()"/>')).toThrow(/active content/);
    expect(() => embeddedAsset('data:image/svg+xml;utf8,<svg><image href="file:///private.png"/></svg>')).toThrow(/active content/);
  });

  it('provides searchable Unicode text for an embedded static TTF', async () => {
    const { manager } = fixture();
    const family = await fontManager.registerFontBuffer('OpenSans-Regular.ttf', readFileSync('tests/fixtures/fonts/OpenSans-Regular.ttf'));
    manager.getState().embeddedFonts = fontManager.getFontAssets().filter(asset => asset.family === family);
    manager.updateElement('body', { fontFamily: family, paragraphStyleId: undefined });
    manager.setStoryContent('body', { version: 1, paragraphs: [{ runs: [{ text: 'Searchable publication café Ω', fontFamily: family }] }] });
    const doc = await exportDocumentToPdf(manager.getState(), { download: false, compress: false });
    expect(doc.output()).toContain('/FontFile2');
    expect(doc.output()).toContain('/ToUnicode');
    mkdirSync('test-results/editorial-publication', { recursive: true });
    writeFileSync('test-results/editorial-publication/searchable-font.pdf', new Uint8Array(doc.output('arraybuffer')));
  });

  it('strict print export refuses overset copy and unsupported spread output', async () => {
    const { manager } = fixture(); manager.setStoryText('body', 'Long overflowing manuscript. '.repeat(2000));
    await expect(exportDocumentToPdf(manager.getState(), { strict: true, download: false })).rejects.toThrow(/overset|exceeds/i);
    await expect(exportDocumentToPdf(manager.getState(), { exportFormat: 'spreads', download: false })).rejects.toThrow(/Spread PDF/);
  });

  it('packages original image bytes under safe unique paths and a portable project', async () => {
    const { manager } = fixture();
    image(manager, 'one', png); image(manager, 'two', png);
    manager.updateElement('one', { name: '../../outside.png' });
    manager.updateElement('two', { name: '../../outside.png' });
    const result = await packageDocument(manager.getState(), { download: false });
    const files = await readZip(result.buffer);
    expect([...files.keys()].filter(path => path.startsWith('Assets/'))).toHaveLength(2);
    expect([...files.keys()].some(path => path.includes('..'))).toBe(false);
    const project = JSON.parse(new TextDecoder().decode(files.get('editorial-export.recto')));
    expect(project.spreads[0].elements.filter((item: { type: string }) => item.type === 'image').every((item: { src: string }) => item.src.startsWith('data:image/'))).toBe(true);
  });
});
