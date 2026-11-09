import type { Font, Glyph } from 'fontkit';
import { packSfnt } from '../engine/sfnt';

interface Point { x: number; y: number; onCurve: boolean }
const align4 = (length: number) => Math.ceil(length / 4) * 4;

function encodeGlyph(glyph: Glyph) {
  const points: Point[] = [];
  const ends: number[] = [];
  let open = false;
  const endContour = () => { if (open) ends.push(points.length - 1); open = false; };
  const addPoint = (x: number, y: number, onCurve: boolean) => {
    if (![x, y].every(value => Number.isFinite(value) && value >= -32768 && value <= 32767)) throw new Error('A variable font contains an out-of-range glyph coordinate.');
    points.push({ x: Math.round(x), y: Math.round(y), onCurve });
  };
  for (const { command, args } of glyph.path.commands) {
    if (command === 'moveTo') { endContour(); open = true; addPoint(args[0], args[1], true); }
    else if (command === 'lineTo') addPoint(args[0], args[1], true);
    else if (command === 'quadraticCurveTo') { addPoint(args[0], args[1], false); addPoint(args[2], args[3], true); }
    else if (command === 'closePath') endContour();
    else throw new Error('A variable TrueType glyph contains an unsupported curve.');
  }
  endContour();
  const bbox = [0, 0, 0, 0];
  if (!points.length) return { bytes: new Uint8Array(), bbox, points: 0, contours: 0 };
  if (points.length > 65535 || ends.length > 32767) throw new Error('A variable font glyph is too complex to embed.');
  bbox.splice(0, 4, points[0].x, points[0].y, points[0].x, points[0].y);
  for (const { x, y } of points) {
    bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
    bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
  }
  const flags = 12 + ends.length * 2;
  const bytes = new Uint8Array(align4(flags + points.length * 5));
  const view = new DataView(bytes.buffer);
  view.setInt16(0, ends.length);
  bbox.forEach((value, index) => view.setInt16(2 + index * 2, value));
  ends.forEach((point, index) => view.setUint16(10 + index * 2, point));
  // No original hints. Axis interpolation can change the point topology.
  let x = 0, y = 0;
  points.forEach((point, index) => {
    const dx = point.x - x, dy = point.y - y;
    if ([dx, dy].some(delta => delta < -32768 || delta > 32767)) throw new Error('A variable font glyph has an out-of-range point delta.');
    bytes[flags + index] = point.onCurve ? 1 : 0;
    view.setInt16(flags + points.length + index * 2, dx);
    view.setInt16(flags + points.length * 3 + index * 2, dy);
    x = point.x; y = point.y;
  });
  return { bytes, bbox, points: points.length, contours: ends.length };
}

/** Compile an unhinted PDF TrueType subset at the selected axis coordinates. */
export function compileVariableTrueType(font: Font, glyphIds: number[]) {
  const tables = new Map<string, Uint8Array>();
  const table = (tag: string, length: number) => {
    const bytes = new Uint8Array(length); tables.set(tag, bytes); return new DataView(bytes.buffer);
  };
  const glyphs = glyphIds.map(id => font.getGlyph(id));
  const encoded = glyphs.map(encodeGlyph);
  const loca = table('loca', (glyphs.length + 1) * 4);
  const metrics = table('hmtx', glyphs.length * 4);
  const head = table('head', 54);
  const hhea = table('hhea', 36);
  const maxp = table('maxp', 32);
  const post = table('post', 32);
  const glyf = new Uint8Array(encoded.reduce((sum, glyph) => sum + glyph.bytes.length, 0));
  tables.set('glyf', glyf);
  const bounds = [0, 0, 0, 0];
  let offset = 0, advanceMax = 0, leftMin = 0, rightMin = 0, extentMax = 0, maxPoints = 0, maxContours = 0;
  for (const [index, glyph] of encoded.entries()) {
    loca.setUint32(index * 4, offset);
    glyf.set(glyph.bytes, offset); offset += glyph.bytes.length;
    const advance = Math.round(glyphs[index].advanceWidth), [left, bottom, right, top] = glyph.bbox;
    if (!Number.isFinite(advance) || advance < 0 || advance > 65535) throw new Error('A variable font has an invalid advance width.');
    metrics.setUint16(index * 4, advance); metrics.setInt16(index * 4 + 2, left);
    bounds[0] = Math.min(bounds[0], left); bounds[1] = Math.min(bounds[1], bottom);
    bounds[2] = Math.max(bounds[2], right); bounds[3] = Math.max(bounds[3], top);
    advanceMax = Math.max(advanceMax, advance); leftMin = Math.min(leftMin, left);
    rightMin = Math.min(rightMin, advance - right); extentMax = Math.max(extentMax, right);
    maxPoints = Math.max(maxPoints, glyph.points); maxContours = Math.max(maxContours, glyph.contours);
  }
  loca.setUint32(glyphs.length * 4, offset);
  head.setUint32(0, 0x10000); head.setUint32(4, 0x10000); head.setUint32(12, 0x5f0f3cf5);
  head.setUint16(18, font.unitsPerEm);
  bounds.forEach((value, index) => head.setInt16(36 + index * 2, value));
  head.setUint16(46, 8); head.setInt16(48, 2); head.setInt16(50, 1);
  hhea.setUint32(0, 0x10000); hhea.setInt16(4, font.ascent); hhea.setInt16(6, font.descent); hhea.setInt16(8, font.lineGap);
  hhea.setUint16(10, advanceMax); hhea.setInt16(12, leftMin); hhea.setInt16(14, rightMin); hhea.setInt16(16, extentMax);
  hhea.setInt16(18, 1); hhea.setUint16(34, glyphs.length);
  maxp.setUint32(0, 0x10000); maxp.setUint16(4, glyphs.length); maxp.setUint16(6, maxPoints); maxp.setUint16(8, maxContours); maxp.setUint16(14, 1);
  post.setUint32(0, 0x30000); post.setInt32(4, (font.italicAngle || 0) * 65536);
  return packSfnt(tables);
}
