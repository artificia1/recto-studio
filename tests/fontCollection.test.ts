import { expect, it } from 'vitest';
import { create } from 'fontkit';
import { readFontCollection } from '../src/engine/fontCollection';
import { fontCollectionFixture } from './fixtures/fontCollection';

it('extracts independently usable TrueType and CFF faces from a collection', () => {
  const bytes = fontCollectionFixture();
  const original = create(bytes);
  if (!('fonts' in original)) throw new Error('Expected a collection');
  const collection = readFontCollection(bytes, 'Test.ttc');
  expect(collection.faces).toEqual(original.fonts.map(face => face.fullName));
  for (const [index, face] of original.fonts.entries()) {
    const standalone = collection.extract(index);
    const parsed = create(standalone.bytes as Parameters<typeof create>[0]);
    if ('fonts' in parsed) throw new Error('Expected a standalone font');
    expect(standalone.fileName.endsWith(index === 0 ? '.ttf' : '.otf')).toBe(true);
    expect(parsed.fullName).toBe(face.fullName);
    expect(parsed.numGlyphs).toBe(face.numGlyphs);
    expect(parsed['OS/2'].fsType).toEqual(face['OS/2'].fsType);
    expect(parsed.glyphForCodePoint(65).path.toSVG()).toBe(face.glyphForCodePoint(65).path.toSVG());
  }
});

it('rejects out-of-bounds face offsets before parsing collection tables', () => {
  const bytes = fontCollectionFixture();
  bytes.writeUInt32BE(bytes.length, 16);
  expect(() => readFontCollection(bytes, 'Broken.otc')).toThrow('outside');
});
