import type { ProjectState } from '../types';
import { variationCss } from '../engine/fontVariations';
import { fontManager } from '../fontManager';

export type FontAsset = NonNullable<ProjectState['embeddedFonts']>[number];

export function fontFamilyCss(family: string): string {
  return JSON.stringify(family).replace(/</g, '\\3c ').replace(/>/g, '\\3e ');
}

/** The OS/2 `fsType` licensing bits of a TrueType or OpenType file, or undefined when the file has no OS/2 table. */
export function sfntEmbeddingBits(bytes: Uint8Array): number | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = view.getUint32(0);
  // TrueType 1.0, 'OTTO' or 'true'; WOFF, WOFF2 and collections are not read here.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return undefined;
  const tables = view.getUint16(4);
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16;
    if (record + 16 > bytes.length) return undefined;
    if (view.getUint32(record) !== 0x4f532f32) continue;
    const offset = view.getUint32(record + 8);
    return offset + 10 <= bytes.length ? view.getUint16(offset + 8) : undefined;
  }
  return undefined;
}

function decodeFont(asset: FontAsset) {
  try { return Uint8Array.from(atob(asset.data), char => char.charCodeAt(0)); } catch { return new Uint8Array(); }
}

/**
 * Why a font's licence keeps it out of files that carry the font itself (EPUB, fixed EPUB, flipbook),
 * or undefined when embedding is allowed. Uses the same rule as PDF export: the "restricted licence"
 * and "bitmap embedding only" bits of OS/2 fsType.
 */
export function fontEmbeddingRestriction(asset: FontAsset, bytes = decodeFont(asset)): string | undefined {
  let restricted: boolean | undefined, bitmapOnly: boolean | undefined;
  const bits = sfntEmbeddingBits(bytes);
  if (bits !== undefined) {
    restricted = (bits & 0x0002) !== 0;
    bitmapOnly = (bits & 0x0200) !== 0;
  } else {
    // WOFF and WOFF2 tables are compressed; read them through the parsed font when it is loaded.
    const rights = fontManager.getFont(asset.family)?.['OS/2']?.fsType as { noEmbedding?: boolean; bitmapOnly?: boolean } | undefined;
    restricted = rights?.noEmbedding;
    bitmapOnly = rights?.bitmapOnly;
  }
  if (restricted) return `The licence of font “${asset.family}” does not allow embedding it in documents.`;
  if (bitmapOnly) return `Font “${asset.family}” only allows embedding bitmaps, not its outlines.`;
  return undefined;
}

/**
 * The fonts an export may copy into its own files, with a warning for each one left out.
 * Readers then show those passages in a fallback font.
 */
export function embeddableFonts(assets: FontAsset[] = [], onWarning?: (message: string) => void) {
  return assets.flatMap(asset => {
    const bytes = decodeFont(asset);
    const restriction = fontEmbeddingRestriction(asset, bytes);
    if (!restriction) return [{ asset, bytes }];
    onWarning?.(`${restriction} It was left out of this export, so readers see a fallback font instead.`);
    return [];
  });
}

export function embeddedFontCss(assets: FontAsset[] = [], onWarning?: (message: string) => void): string {
  return embeddableFonts(assets, onWarning).map(({ asset }) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) throw new Error('Invalid embedded font data');
    return `@font-face{font-family:${fontFamilyCss(asset.family)};src:url("data:application/octet-stream;base64,${asset.data}");font-variation-settings:${variationCss(asset.variations)};}`;
  }).join('\n');
}
