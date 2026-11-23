import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FontManager, fontManager } from '../src/fontManager';
import { documentUsesFontFamilies } from '../src/engine/documentFonts';
import { fontTextWidth, drawFontText, wrapFontText } from '../src/export/fontOutlines';
import { jsPDF } from 'jspdf';
import { generateEpubPackage } from '../src/epubExport';
import { generateFlipbookHtml } from '../src/flipbookExport';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { INITIAL_STATE } from '../src/state/stateManager';

describe('Real custom font files', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['OpenSans-Regular.ttf', 'SourceSansPro-Regular.otf', 'SourceSansPro-Regular.woff', 'SourceSansPro-Regular.woff2'])('reads, shapes, saves and restores %s', async fileName => {
    const manager = new FontManager();
    const family = await manager.registerFontBuffer(fileName, readFileSync(`tests/fixtures/fonts/${fileName}`));
    expect(family).not.toBe(fileName);
    const font = manager.getFont(family)!;
    expect(font.layout('Typography').glyphs.length).toBeGreaterThan(0);
    expect(fontTextWidth(font, 'Typography', 12)).toBeGreaterThan(0);
    const restored = new FontManager();
    await restored.restoreFonts(manager.getFontAssets());
    expect(restored.getFont(family)?.numGlyphs).toBe(font.numGlyphs);
    const doc = new jsPDF({ compress: false });
    drawFontText(doc, font, 'Typography', 20, 20, 12);
    expect(doc.output()).toMatch(/\sc\s/);
    expect(wrapFontText(font, 'A very long line of typography', 12, 15).length).toBeGreaterThan(1);
  });

  it('does not register malformed font files', async () => {
    const manager = new FontManager();
    await expect(manager.registerFontBuffer('bad.ttf', new Uint8Array([0, 1, 0, 0]))).rejects.toThrow('could not be read');
    expect(manager.getCustomFonts()).toEqual([]);
  });

  it('retries a failed Google font download instead of caching success', async () => {
    const appendChild = vi.fn((link: { onerror: () => void }) => {
      queueMicrotask(() => link.onerror());
    });
    vi.stubGlobal('document', {
      getElementById: () => null,
      createElement: () => ({ remove: vi.fn() }),
      head: { appendChild },
      fonts: { load: vi.fn() },
    });
    const manager = new FontManager();
    expect(await manager.loadGoogleFont('Inter')).toBe(false);
    expect(await manager.loadGoogleFont('Inter')).toBe(false);
    expect(appendChild).toHaveBeenCalledTimes(2);
  });

  it('publishes one activation event for a burst of Google fonts', async () => {
    vi.stubGlobal('document', { getElementById: () => ({}), fonts: { load: vi.fn().mockResolvedValue([]) } });
    vi.useFakeTimers();
    try {
      const manager = new FontManager();
      const notify = vi.fn();
      manager.subscribe(notify);
      await expect(Promise.all([manager.loadGoogleFont('Inter'), manager.loadGoogleFont('Merriweather')])).resolves.toEqual([true, true]);
      expect(manager.generation).toBe(2);
      expect(notify).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(32);
      expect(notify).toHaveBeenCalledExactlyOnceWith(['Inter', 'Merriweather']);
    } finally { vi.useRealTimers(); }
  });

  it('reports all restored fonts in one event and skips already active faces', async () => {
    const source = new FontManager();
    for (const file of ['OpenSans-Regular.ttf', 'SourceSansPro-Regular.otf']) {
      await source.registerFontBuffer(file, readFileSync(`tests/fixtures/fonts/${file}`));
    }
    const manager = new FontManager();
    const notify = vi.fn();
    manager.subscribe(notify);
    const assets = source.getFontAssets();
    await manager.restoreFonts(assets);
    expect(manager.generation).toBe(2);
    expect(notify).toHaveBeenCalledExactlyOnceWith(assets.map(asset => asset.family));
    await manager.restoreFonts(assets);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('detects a newly activated font anywhere in a document fallback list', () => {
    const state = structuredClone(INITIAL_STATE);
    const frame = state.spreads[0].elements.find(element => element.type === 'text')!;
    frame.fontFamily = 'Unavailable Face, "Fallback Face", serif';
    expect(documentUsesFontFamilies(state, ['fallback face'])).toBe(true);
    expect(documentUsesFontFamilies(state, ['Unrelated Face'])).toBe(false);
  });

  it('does not report success when browser activation fails', async () => {
    vi.stubGlobal('document', { fonts: { add: vi.fn() } });
    vi.stubGlobal('FontFace', class { load() { return Promise.reject(new Error('bad font')); } });
    const manager = new FontManager();
    await expect(manager.registerFontBuffer('valid.ttf', readFileSync('tests/fixtures/fonts/OpenSans-Regular.ttf'))).rejects.toThrow('could not activate');
    expect(manager.getFontAssets()).toEqual([]);
  });

  it('preserves Uint8Array slice boundaries', async () => {
    const bytes = readFileSync('tests/fixtures/fonts/OpenSans-Regular.ttf');
    const padded = new Uint8Array(bytes.length + 32);
    padded.set(bytes, 16);
    const name = await fontManager.registerFontBuffer('sliced.ttf', padded.subarray(16, 16 + bytes.length));
    expect(fontManager.getFont(name)?.numGlyphs).toBeGreaterThan(0);
  });

  it('carries a font from a saved project into PDF, EPUB and flipbook exports', async () => {
    const manager = new FontManager();
    const family = await manager.registerFontBuffer('font.otf', readFileSync('tests/fixtures/fonts/SourceSansPro-Regular.otf'));
    const state = structuredClone(INITIAL_STATE);
    state.embeddedFonts = manager.getFontAssets();
    const text = state.spreads[0].elements.find(element => element.type === 'text')!;
    if (text.type !== 'text') throw new Error('Missing text fixture');
    text.fontFamily = family;
    text.text = 'Custom Typography';
    state.spreads = [{ ...state.spreads[0], elements: [text], masterSpreadId: null }];
    state.masterSpreads = [];
    state.activeSpreadIndex = 0;
    const pdf = await exportDocumentToPdf(state, { compress: false });
    expect(pdf.output()).toContain('/CIDFontType0C');
    expect(pdf.output()).toContain('/ToUnicode');
    expect(pdf.output()).toContain('> Tj');
    const epub = generateEpubPackage(state);
    expect(epub['OEBPS/fonts/font-0.otf']).toBeInstanceOf(Uint8Array);
    expect(epub['OEBPS/package.opf']).toContain('font/otf');
    expect(epub['OEBPS/styles.css']).toContain('@font-face');
    expect(generateFlipbookHtml(state)).toContain(state.embeddedFonts[0].data);
  });
});
