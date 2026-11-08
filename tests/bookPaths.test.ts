import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBookChapter } from '../scripts/book-paths.mjs';

describe('book manifest file boundary', () => {
  it('permits nested chapters and refuses parent/absolute paths outside the book', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'recto-book-security-'));
    try {
      const book = path.join(folder, 'book'); mkdirSync(book);
      const chapters = path.join(book, 'chapters'); mkdirSync(chapters);
      writeFileSync(path.join(chapters, 'one.recto'), '{}');
      writeFileSync(path.join(folder, 'private.recto'), 'private');
      const manifest = path.join(book, 'manifest.rectobook');
      expect(resolveBookChapter(manifest, 'chapters/one.recto')).toBe(path.join(chapters, 'one.recto'));
      expect(() => resolveBookChapter(manifest, '../private.recto')).toThrow('manifest folder');
      expect(() => resolveBookChapter(manifest, path.join(folder, 'private.recto'))).toThrow('manifest folder');
      expect(() => resolveBookChapter(manifest, 'chapters')).toThrow('publication files');
    } finally {
      if (path.dirname(path.resolve(folder)) !== path.resolve(tmpdir()) || !path.basename(folder).startsWith('recto-book-security-')) throw new Error('Unexpected cleanup path');
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
