import type { Font, Glyph } from 'fontkit';

const u16 = (value: number) => [value >>> 8 & 255, value & 255];
const i32 = (value: number) => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const ascii = (value: string) => Array.from(new TextEncoder().encode(value));

function index(entries: number[][]) {
  if (!entries.length) return [0, 0];
  const data = [...u16(entries.length), 4];
  let offset = 1;
  for (const entry of entries) { data.push(...i32(offset)); offset += entry.length; }
  data.push(...i32(offset));
  for (const entry of entries) for (const byte of entry) data.push(byte);
  return data;
}

// Fixed-width DICT integers keep absolute offsets stable when the top DICT is rebuilt.
const dictInt = (value: number) => [29, ...i32(value)];
function dictReal(value: number) {
  const nibbles = Array.from(String(value), digit => digit === '.' ? 10 : digit === '-' ? 14 : digit === 'e' ? 11 : digit === '+' ? -1 : Number(digit)).filter(nibble => nibble >= 0);
  nibbles.push(15);
  if (nibbles.length % 2) nibbles.push(15);
  return [30, ...nibbles.filter((_, i) => i % 2 === 0).map((high, i) => high * 16 + nibbles[i * 2 + 1])];
}

function operand(value: number) {
  if (!Number.isFinite(value) || value < -32768 || value > 32767.999) throw new Error('A CFF2 glyph has an out-of-range coordinate delta.');
  if (!Number.isInteger(value)) return [255, ...i32(Math.round(value * 65536))];
  if (value >= -107 && value <= 107) return [value + 139];
  if (value >= 108 && value <= 1131) return [247 + ((value - 108) >>> 8), (value - 108) & 255];
  if (value <= -108 && value >= -1131) return [251 + ((-value - 108) >>> 8), (-value - 108) & 255];
  return [28, ...u16(value)];
}

function charString(glyph: Glyph) {
  const data = operand(glyph.advanceWidth);
  let x = 0, y = 0;
  const point = (nextX: number, nextY: number) => {
    // Quantize absolute coordinates so rounding never accumulates across a contour.
    nextX = Math.round(nextX * 65536) / 65536; nextY = Math.round(nextY * 65536) / 65536;
    data.push(...operand(nextX - x), ...operand(nextY - y));
    x = nextX; y = nextY;
  };
  for (const { command, args } of glyph.path.commands) {
    switch (command) {
      case 'moveTo': point(args[0], args[1]); data.push(21); break;
      case 'lineTo': point(args[0], args[1]); data.push(5); break;
      case 'bezierCurveTo':
        point(args[0], args[1]); point(args[2], args[3]); point(args[4], args[5]); data.push(8); break;
      case 'closePath': break; // Type 2 closes contours at the next moveto or endchar.
      default: throw new Error('A CFF2 glyph contains an unsupported drawing command.');
    }
  }
  data.push(14);
  return data;
}

/** Compile the instantiated cubic outlines as a CID-keyed CFF 1 program for PDF. */
export function compileCff2(font: Font, glyphIds: number[], name: string) {
  const glyphs = glyphIds.map(id => font.getGlyph(id));
  const bounds = [0, 0, 0, 0];
  for (const glyph of glyphs) {
    const { minX, minY, maxX, maxY } = glyph.path.bbox;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;
    bounds[0] = Math.min(bounds[0], Math.floor(minX)); bounds[1] = Math.min(bounds[1], Math.floor(minY));
    bounds[2] = Math.max(bounds[2], Math.ceil(maxX)); bounds[3] = Math.max(bounds[3], Math.ceil(maxY));
  }
  const strings = index([ascii('Adobe'), ascii('Identity'), ascii(name)]);
  const programs = index(glyphs.map(charString));
  const charset = [2, ...u16(1), ...u16(glyphs.length - 2)];
  const fdSelect = [3, ...u16(1), ...u16(0), 0, ...u16(glyphs.length)];
  const fdArray = (privateOffset: number) => index([[...dictInt(393), 12, 38, ...dictInt(0), ...dictInt(privateOffset), 18]]);
  const names = index([ascii(name)]);
  const matrixScale = dictReal(1 / font.unitsPerEm);
  const top = (charsetOffset: number, programsOffset: number, fdSelectOffset: number, fdArrayOffset: number) => index([[
    ...operand(391), ...operand(392), ...operand(0), 12, 30,
    ...bounds.flatMap(dictInt), 5,
    ...matrixScale, 139, 139, ...matrixScale, 139, 139, 12, 7,
    ...dictInt(glyphs.length), 12, 34,
    ...dictInt(charsetOffset), 15, ...dictInt(programsOffset), 17,
    ...dictInt(fdSelectOffset), 12, 37, ...dictInt(fdArrayOffset), 12, 36,
  ]]);
  const header = [1, 0, 4, 4], globalSubrs = index([]);
  const charsetOffset = header.length + names.length + top(0, 0, 0, 0).length + strings.length + globalSubrs.length;
  const programsOffset = charsetOffset + charset.length;
  const fdSelectOffset = programsOffset + programs.length;
  const fdArrayOffset = fdSelectOffset + fdSelect.length;
  const sections = [header, names, top(charsetOffset, programsOffset, fdSelectOffset, fdArrayOffset), strings, globalSubrs,
    charset, programs, fdSelect, fdArray(fdArrayOffset + fdArray(0).length)];
  const bytes = new Uint8Array(sections.reduce((total, section) => total + section.length, 0));
  let offset = 0;
  for (const section of sections) { bytes.set(section, offset); offset += section.length; }
  return { bytes, bounds };
}
