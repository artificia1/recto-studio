import { embeddedAsset } from '../export/publicationAssets';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../zip';
import { assetStore } from './assetStore';

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

function checkImageSize(size: number) {
  if (size > MAX_IMAGE_BYTES) throw new Error('Choose an image smaller than 64 MB.');
}

/** Decode artwork before it becomes part of the document. */
export async function readPlacedImage(data: File | ArrayBuffer | string, name?: string) {
  if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) {
    const file = data;
    checkImageSize(file.size);
    name = file.name;
    data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  } else if (data instanceof ArrayBuffer) {
    checkImageSize(data.byteLength);
    data = `data:application/octet-stream;base64,${uint8ArrayToBase64(new Uint8Array(data))}`;
  }

  // Keep browser-supported formats available for editing, even where a press
  // export needs an image converted to one of its own supported formats.
  const raster = /^data:image\/(bmp|avif|x-icon|vnd\.microsoft\.icon);base64,(.+)$/i.exec(data);
  const image = raster
    ? { dataUrl: data, bytes: base64ToUint8Array(raster[2]), extension: /icon/i.test(raster[1]) ? 'ico' : raster[1] }
    : embeddedAsset(data);
  checkImageSize(image.bytes.length);
  const { proxyDataUrl, originalWidth, originalHeight } = await assetStore.generateScreenProxy(image.dataUrl);
  return {
    src: image.dataUrl,
    name,
    fileSize: image.bytes.length,
    format: image.extension.toUpperCase(),
    originalWidth,
    originalHeight,
    proxySrc: proxyDataUrl !== image.dataUrl ? proxyDataUrl : undefined,
  };
}
