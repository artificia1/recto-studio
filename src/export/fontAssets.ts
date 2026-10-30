import type { ProjectState } from '../types';

export type FontAsset = NonNullable<ProjectState['embeddedFonts']>[number];

export function fontFamilyCss(family: string): string {
  return JSON.stringify(family).replace(/</g, '\\3c ').replace(/>/g, '\\3e ');
}

export function embeddedFontCss(assets: FontAsset[] = []): string {
  return assets.map(asset => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) throw new Error('Invalid embedded font data');
    return `@font-face{font-family:${fontFamilyCss(asset.family)};src:url("data:application/octet-stream;base64,${asset.data}");}`;
  }).join('\n');
}
