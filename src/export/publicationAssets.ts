import type { ImageElement, ProjectState } from '../types';
import { assetStore } from '../engine/assetStore';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../zip';
import { parseManuscriptXml, children, nodeText, type XmlNode } from '../import/manuscriptXml';
import { masterDependencies } from '../engine/masterInheritance';
import { hiddenEditionIds } from '../engine/publicationEditions';

export interface PublicationAsset { bytes: Uint8Array; mediaType: string; extension: string; dataUrl: string }
const LIMIT = 64 * 1024 * 1024;

export function embeddedAsset(source: string): PublicationAsset {
  const match = /^data:([^;,]+)([^,]*),([\s\S]*)$/.exec(source);
  if (!match) throw new Error('Embed or relink this image before exporting.');
  let content = match[3];
  if (!/(?:^|;)base64(?:;|$)/i.test(match[2])) { try { content = decodeURIComponent(content); } catch { /* Legacy SVG data URLs may contain literal percent signs. */ } }
  const bytes = /(?:^|;)base64(?:;|$)/i.test(match[2]) ? base64ToUint8Array(content) : new TextEncoder().encode(content);
  if (!bytes.length || bytes.length > LIMIT) throw new Error('Each export image must contain data and be smaller than 64 MB.');
  const prefix = new TextDecoder().decode(bytes.subarray(0, 500)).trim();
  let mediaType: string, extension: string;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) { mediaType = 'image/png'; extension = 'png'; }
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) { mediaType = 'image/jpeg'; extension = 'jpg'; }
  else if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) { mediaType = 'image/gif'; extension = 'gif'; }
  else if (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') { mediaType = 'image/webp'; extension = 'webp'; }
  else if (/<svg(?:\s|>)/i.test(prefix)) {
    const svg = new TextDecoder().decode(bytes);
    const document = parseManuscriptXml(svg);
    const roots = children(document);
    if (roots.length !== 1 || roots[0].name !== 'svg') throw new Error('Invalid SVG artwork.');
    const safeElements = new Set('svg g defs path use rect circle ellipse line polyline polygon text tspan textPath clipPath mask linearGradient radialGradient stop pattern marker title desc style image filter feGaussianBlur feOffset feBlend feColorMatrix feComponentTransfer feFuncR feFuncG feFuncB feFuncA feMerge feMergeNode feFlood feComposite'.toLowerCase().split(' '));
    const unsafeCss = (value: string) => /\\|@|expression\s*\(|behavior\s*:/i.test(value) || [...value.matchAll(/url\s*\(([^)]*)\)/gi)].some(match => !match[1].trim().replace(/^["']|["']$/g, '').startsWith('#'));
    const inspect = (node: XmlNode) => {
      if (!safeElements.has(node.name.toLowerCase())) throw new Error('SVG artwork contains active content or unsupported elements.');
      for (const [name, value] of Object.entries(node.attrs)) {
        if (/^on|^base$|^src$/i.test(name) || (/^href$/i.test(name) && !value.startsWith('#')) || unsafeCss(value)) throw new Error('SVG artwork contains active content or external resources.');
      }
      if (node.name.toLowerCase() === 'style' && unsafeCss(nodeText(node))) throw new Error('SVG artwork contains active content or external resources.');
      children(node).forEach(inspect);
    };
    inspect(roots[0]);
    const externalCss = [...svg.matchAll(/url\s*\(([^)]*)\)/gi)].some(match => !match[1].trim().replace(/^["']|["']$/g, '').startsWith('#'));
    const unsafeStyle = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].some(match => /\\|@import|expression\s*\(|behavior\s*:/i.test(match[1]));
    if (unsafeStyle || externalCss || /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|audio|video)\b|\bon\w+\s*=|\b(?:xlink:)?href\s*=\s*["'](?!#)|@import|\bstyle\s*=\s*["'][^"']*\\/i.test(svg)) {
      throw new Error('SVG artwork contains active content or external resources. Use a self-contained SVG or a raster image.');
    }
    mediaType = 'image/svg+xml'; extension = 'svg';
  } else throw new Error('Unsupported image data. Use PNG, JPEG, GIF, WebP or a self-contained SVG.');
  return { bytes, mediaType, extension, dataUrl: `data:${mediaType};base64,${uint8ArrayToBase64(bytes)}` };
}

export function fullImageSource(image: ImageElement): string {
  const source = assetStore.getFullResolution(image.assetId || image.src);
  if (source instanceof ArrayBuffer) return `data:application/octet-stream;base64,${uint8ArrayToBase64(new Uint8Array(source))}`;
  return typeof source === 'string' && source !== image.assetId ? source : image.src;
}

/** Snapshot and freeze external image bytes before export; no proxy or browser-local URL escapes. */
export async function prepareExportAssets(source: ProjectState, fetchExternal = false, includeHidden = false): Promise<ProjectState> {
  const state = structuredClone(source);
  const hiddenEditions = hiddenEditionIds(state);
  const masters = masterDependencies(state.masterSpreads, state.spreads.map(spread => spread.masterSpreadId));
  const images = [...state.spreads.flatMap(spread => spread.elements), ...state.masterSpreads.filter(master => masters.has(master.id)).flatMap(master => master.elements)]
    .filter((item): item is ImageElement => item.type === 'image' && (includeHidden ||
      (!item.pasteboard && !item.editorialOnly && !hiddenEditions.has(item.conditionId || '') && state.layers?.find(layer => layer.id === item.layerId)?.visible !== false)));
  const cache = new Map<string, PublicationAsset>();
  let total = 0;
  for (const image of images) {
    let src = fullImageSource(image);
    if (!src) continue; // Empty design placeholders are handled by target-specific preflight.
    let asset = cache.get(src);
    if (!asset) {
      const key = src;
      if (!src.startsWith('data:')) {
        if (!fetchExternal && !src.startsWith('blob:')) throw new Error(`Image “${image.name || image.id}” is linked externally. Embed or relink it before export.`);
        const url = new URL(src);
        if (!['https:', 'http:', 'blob:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported image location. Relink the image from a local file.');
        const response = await fetch(src, { signal: AbortSignal.timeout(20000), credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`Could not load image “${image.name || image.id}” (${response.status}). Relink it before export.`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Image download returned no data.');
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > LIMIT) throw new Error('Image download exceeds 64 MB.'); chunks.push(next.value); }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        src = `data:application/octet-stream;base64,${uint8ArrayToBase64(bytes)}`;
      }
      asset = embeddedAsset(src); total += asset.bytes.length;
      if (total > 256 * 1024 * 1024) throw new Error('Embedded export images exceed 256 MB. Export a smaller document or reduce image sizes.');
      cache.set(key, asset);
    }
    image.src = asset.dataUrl; delete image.proxySrc; delete image.assetId;
  }
  return state;
}
