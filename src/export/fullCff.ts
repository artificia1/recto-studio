import type { Font } from 'fontkit';

interface TableStream { pos: number; readBuffer(length: number): Uint8Array }
type Charset = { version: 0; glyphs: number[] } | { version: 1 | 2; ranges: { offset: number; first: number; nLeft: number }[] };
interface CffFont {
  version: number;
  isCIDFont: boolean;
  postscriptName: string;
  string(sid: number): string;
  getGlyphName(id: number): string | null;
  topDict: { ROS?: [number, number, number]; charset: Charset };
}

export type FullCff = { bytes: Uint8Array; name: string } & (
  { kind: 'name'; glyphName(id: number): string | null } |
  { kind: 'cid'; glyphCid(id: number): number | undefined; registry: string; ordering: string; supplement: number }
);

/** Read the complete CFF table. Fontkit decompresses WOFF containers without changing the table. */
export function readFullCff(font: Font): FullCff | undefined {
  const source = font as Font & {
    'CFF '?: CffFont;
    directory?: { tables: Record<string, { length: number }> };
    _getTableStream(tag: string): TableStream;
    stream: TableStream;
  };
  const cff = source['CFF '], length = source.directory?.tables['CFF ']?.length;
  if (!cff || cff.version !== 1 || !length || length > 32 * 1024 * 1024) return;
  const originalPosition = source.stream.pos;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(source._getTableStream('CFF ').readBuffer(length));
  } finally { source.stream.pos = originalPosition; }
  if (bytes.length !== length || bytes[0] !== 1 || !cff.postscriptName) return;
  const base = { bytes, name: cff.postscriptName };
  if (!cff.isCIDFont) return { ...base, kind: 'name', glyphName: id => cff.getGlyphName(id) };
  const ros = cff.topDict.ROS;
  if (!ros) return;
  const registry = cff.string(ros[0]), ordering = cff.string(ros[1]), supplement = ros[2];
  if (!/^[A-Za-z0-9_.-]+$/.test(registry || '') || !/^[A-Za-z0-9_.-]+$/.test(ordering || '') || !Number.isSafeInteger(supplement) || supplement < 0) return;
  const charset = cff.topDict.charset;
  return { ...base, kind: 'cid', registry, ordering, supplement, glyphCid(id) {
    if (!id) return 0;
    if (charset.version === 0) return charset.glyphs[id - 1];
    const range = charset.ranges.find(range => range.offset <= id - 1 && id - 1 <= range.offset + range.nLeft);
    return range && range.first + id - 1 - range.offset;
  } };
}
