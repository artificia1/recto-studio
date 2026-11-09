import { create } from 'fontkit';
import { packSfnt } from './sfnt';

const TTC = 0x74746366;
const OTTO = 0x4f54544f;
const TTF = 0x00010000;
const MAC_TTF = 0x74727565;
const LIMIT = 32 * 1024 * 1024;

export function readFontCollection(bytes: Uint8Array, fileName: string) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || bytes.length > LIMIT || data.getUint32(0) !== TTC ||
    ![0x10000, 0x20000].includes(data.getUint32(4))) throw new Error('Choose a valid TTC or OTC font collection up to 32 MiB.');
  const count = data.getUint32(8);
  if (!count || count > 128 || 12 + count * 4 > bytes.length) throw new Error('The collection face directory is invalid.');
  const directories = Array.from({ length: count }, (_, index) => {
    const offset = data.getUint32(12 + index * 4);
    if (offset > bytes.length - 12) throw new Error('A collection face points outside the font file.');
    const signature = data.getUint32(offset);
    const numTables = data.getUint16(offset + 4);
    if (![OTTO, TTF, MAC_TTF].includes(signature) || !numTables || numTables > 128 ||
      offset + 12 + numTables * 16 > bytes.length) throw new Error('A collection face has an invalid table directory.');
    const tables = new Map<string, Uint8Array>();
    const decoder = new TextDecoder();
    let size = 12 + numTables * 16;
    for (let i = 0; i < numTables; i++) {
      const record = offset + 12 + 16 * i;
      const tag = decoder.decode(bytes.subarray(record, record + 4));
      const start = data.getUint32(record + 8), length = data.getUint32(record + 12);
      size += Math.ceil(length / 4) * 4;
      if (!/^[ -~]{4}$/.test(tag) || tables.has(tag) || start > bytes.length || length > bytes.length - start || size > LIMIT) {
        throw new Error('A collection face has an invalid or oversized font table.');
      }
      tables.set(tag, bytes.subarray(start, start + length));
    }
    if ((tables.get('head')?.length || 0) < 54 || !tables.has('name')) throw new Error('A collection face is missing its font header or name table.');
    return { signature: signature === MAC_TTF ? TTF : signature, tables };
  });
  const parsed = create(bytes as Parameters<typeof create>[0]);
  if (!('fonts' in parsed)) throw new Error('The collection could not be read.');
  const faces = parsed.fonts.map((font, index) => font.fullName || font.postscriptName || 'Face ' + (index + 1));
  return {
    faces,
    extract(index: number) {
      const face = directories[index];
      if (!face) throw new Error('Choose a face from this font collection.');
      const label = faces[index].replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'face-' + (index + 1);
      return {
        fileName: fileName.replace(/\.[^.]+$/, '') + '-' + label + (face.signature === OTTO ? '.otf' : '.ttf'),
        bytes: packSfnt(face.tables, face.signature),
      };
    },
  };
}
