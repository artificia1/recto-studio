import { embeddedAsset } from '../export/publicationAssets';

/** Read dimensions before native decoding or allocating a pixel surface. */
export function rasterDimensions(bytes: Uint8Array, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, cmyk = false;
  if (type === 'image/png' && bytes.length >= 24) { width = view.getUint32(16); height = view.getUint32(20); }
  else if (type === 'image/gif' && bytes.length >= 10) { width = view.getUint16(6, true); height = view.getUint16(8, true); }
  else if (type === 'image/jpeg') {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 255) throw new Error('Malformed JPEG marker.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd8) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG segment.');
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); cmyk = bytes[offset + 7] === 4; break;
      }
      offset += length;
    }
  } else if (type === 'image/webp' && bytes.length >= 30) {
    const subtype = String.fromCharCode(...bytes.subarray(12, 16));
    if (subtype === 'VP8X') { width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536; height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536; }
    else if (subtype === 'VP8 ') { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    else if (subtype === 'VP8L' && bytes[20] === 0x2f) { const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = (bits >>> 14 & 0x3fff) + 1; }
  }
  if (!width || !height || width * height > 40_000_000) throw new Error('Use a supported raster image up to 40 megapixels.');
  return { width, height, cmyk };
}

export async function decodeSrgbRaster(src: string, maxEdge?: number, allowCmyk = false) {
  const asset = embeddedAsset(src), original = rasterDimensions(asset.bytes, asset.mediaType);
  if (original.cmyk && !allowCmyk) throw new Error('CMYK JPEG conversion requires a known source profile. Supply an sRGB image or use PDF without ICC conversion.');
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(original.width, original.height)) : 1;
  const width = Math.max(1, Math.round(original.width * scale)), height = Math.max(1, Math.round(original.height * scale));
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(new Blob([new Uint8Array(asset.bytes)], { type: asset.mediaType }), { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    try {
      if (image.width !== width || image.height !== height) throw new Error('Image dimensions changed during decoding.');
      const context = new OffscreenCanvas(width, height).getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      if (!context) throw new Error('Could not create an sRGB image surface.');
      context.drawImage(image, 0, 0);
      return { width, height, originalWidth: original.width, originalHeight: original.height, data: new Uint8Array(context.getImageData(0, 0, width, height).data) };
    } finally { image.close(); }
  }
  const { Resvg } = await import('@resvg/resvg-js');
  const safeSource = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const rendered = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="${safeSource}"/></svg>`, { font: { loadSystemFonts: false } }).render();
  const data = new Uint8Array(rendered.pixels);
  // tiny-skia exposes premultiplied pixels; callers need straight RGB samples.
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha && alpha < 255) for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.min(255, Math.round(data[offset + channel] * 255 / alpha));
  }
  return { width, height, originalWidth: original.width, originalHeight: original.height, data };
}
