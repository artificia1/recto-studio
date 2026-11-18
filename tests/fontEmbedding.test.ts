import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FontManager } from '../src/fontManager';
import { embeddableFonts, fontEmbeddingRestriction, sfntEmbeddingBits, type FontAsset } from '../src/export/fontAssets';
import { generateEpubPackage } from '../src/epubExport';
import { generateFixedEpubPackage } from '../src/export/fixedEpub';
import { generateFlipbookHtml } from '../src/flipbookExport';
import { INITIAL_STATE } from '../src/state/stateManager';

/** A copy of a TrueType/OpenType file with its OS/2 fsType licensing bits replaced. */
function withFsType(bytes: Uint8Array, fsType: number) {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  for (let index = 0; index < view.getUint16(4); index++) {
    const record = 12 + index * 16;
    if (view.getUint32(record) === 0x4f532f32) {
      view.setUint16(view.getUint32(record + 8) + 8, fsType);
      return copy;
    }
  }
  throw new Error('No OS/2 table');
}

const openSans = new Uint8Array(readFileSync('tests/fixtures/fonts/OpenSans-Regular.ttf'));
const sourceSans = new Uint8Array(readFileSync('tests/fixtures/fonts/SourceSansPro-Regular.otf'));
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const asset = (family: string, bytes: Uint8Array, fileName = `${family}.ttf`): FontAsset => ({ family, fileName, data: base64(bytes) });

const restricted = asset('Restricted Sans', withFsType(openSans, 0x0002));
const bitmapOnly = asset('Bitmap Sans', withFsType(openSans, 0x0200 | 0x0004));
const allowed = asset('Allowed Serif', withFsType(sourceSans, 0x0008), 'Allowed Serif.otf');

function project(fonts: FontAsset[]) {
  const state = structuredClone(INITIAL_STATE);
  state.embeddedFonts = fonts;
  const text = state.spreads[0].elements.find(element => element.type === 'text')!;
  if (text.type !== 'text') throw new Error('Missing text fixture');
  text.text = 'Licensed typography';
  state.spreads = [{ ...state.spreads[0], elements: [text], masterSpreadId: null }];
  state.masterSpreads = [];
  state.activeSpreadIndex = 0;
  return state;
}

describe('font embedding permissions', () => {
  it('reads the licensing bits of TrueType and OpenType files', () => {
    expect(sfntEmbeddingBits(withFsType(openSans, 0x0002))).toBe(0x0002);
    expect(sfntEmbeddingBits(withFsType(sourceSans, 0x0104))).toBe(0x0104);
    expect(sfntEmbeddingBits(new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeUndefined();
    expect(sfntEmbeddingBits(new Uint8Array(4))).toBeUndefined();
  });

  it('names the reason a font cannot be embedded', () => {
    expect(fontEmbeddingRestriction(restricted)).toMatch(/licence of font “Restricted Sans” does not allow embedding/);
    expect(fontEmbeddingRestriction(bitmapOnly)).toMatch(/only allows embedding bitmaps/);
    expect(fontEmbeddingRestriction(allowed)).toBeUndefined();
    // Preview & Print, Editable and No subsetting all still allow the font file to travel with the publication.
    expect(fontEmbeddingRestriction(asset('Print', withFsType(openSans, 0x0004)))).toBeUndefined();
    expect(fontEmbeddingRestriction(asset('Whole', withFsType(openSans, 0x0100)))).toBeUndefined();
  });

  it('reads WOFF and WOFF2 permissions through the loaded font', async () => {
    const manager = new FontManager();
    const family = await manager.registerFontBuffer('font.woff2', readFileSync('tests/fixtures/fonts/SourceSansPro-Regular.woff2'));
    const woff = manager.getFontAsset(family)!;
    expect(sfntEmbeddingBits(Uint8Array.from(atob(woff.data), char => char.charCodeAt(0)))).toBeUndefined();
    expect(fontEmbeddingRestriction(woff)).toBeUndefined();
  });

  it('keeps only fonts that may be embedded and warns about the rest', () => {
    const warnings: string[] = [];
    const kept = embeddableFonts([restricted, allowed, bitmapOnly], message => warnings.push(message));
    expect(kept.map(item => item.asset.family)).toEqual(['Allowed Serif']);
    expect(kept[0].bytes).toEqual(withFsType(sourceSans, 0x0008));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/Restricted Sans.*left out of this export.*fallback font/);
  });

  it('leaves a restricted font out of reflowable EPUB', () => {
    const warnings: string[] = [];
    const files = generateEpubPackage(project([restricted, allowed]), { onWarning: message => warnings.push(message) });
    const fonts = Object.keys(files).filter(path => path.startsWith('OEBPS/fonts/'));
    expect(fonts).toEqual(['OEBPS/fonts/font-0.otf']);
    expect(files['OEBPS/styles.css']).toContain('"Allowed Serif"');
    expect(files['OEBPS/styles.css']).not.toContain('Restricted Sans');
    expect(files['OEBPS/package.opf']).not.toContain('font/ttf');
    expect(warnings.filter(message => message.includes('Restricted Sans'))).toHaveLength(1);
  });

  it('leaves a restricted font out of fixed-layout EPUB', () => {
    const warnings: string[] = [];
    const files = generateFixedEpubPackage(project([restricted, allowed]), message => warnings.push(message));
    expect(Object.keys(files).filter(path => /OEBPS\/font-\d/.test(path))).toEqual(['OEBPS/font-1.otf']);
    expect(files['OEBPS/styles.css']).not.toContain('Restricted Sans');
    expect(warnings).toEqual([expect.stringMatching(/Restricted Sans/)]);
  });

  it('leaves a restricted font out of the flipbook', () => {
    const warnings: string[] = [];
    const html = generateFlipbookHtml(project([restricted, allowed]), message => warnings.push(message));
    expect(html).toContain(allowed.data);
    expect(html).not.toContain(restricted.data);
    expect(warnings).toEqual([expect.stringMatching(/Restricted Sans/)]);
  });
});
