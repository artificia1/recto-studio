import { readFileSync } from 'node:fs';

export function fontCollectionFixture() {
  const fonts = ['OpenSans-Regular.ttf', 'SourceSansPro-Regular.otf'].map(name => readFileSync('tests/fixtures/fonts/' + name));
  const headerSize = 12 + 4 * fonts.length;
  const aligned = (length: number) => Math.ceil(length / 4) * 4;
  const result = Buffer.alloc(headerSize + fonts.reduce((size, font) => size + aligned(font.length), 0));
  result.write('ttcf', 0);
  result.writeUInt32BE(0x10000, 4);
  result.writeUInt32BE(fonts.length, 8);
  let offset = headerSize;
  for (const [index, font] of fonts.entries()) {
    result.writeUInt32BE(offset, 12 + index * 4);
    font.copy(result, offset);
    for (let row = 0; row < font.readUInt16BE(4); row++) {
      const entry = 12 + row * 16 + 8;
      result.writeUInt32BE(offset + font.readUInt32BE(entry), offset + entry);
    }
    offset += aligned(font.length);
  }
  return result;
}
