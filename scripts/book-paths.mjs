import fs from 'node:fs';
import path from 'node:path';

/** An untrusted manifest cannot use chapter entries to read/write outside its folder. */
export function resolveBookChapter(manifestPath, chapterPath) {
  if (typeof chapterPath !== 'string' || !chapterPath.trim() || chapterPath.includes('\0')) throw new Error('Invalid book chapter path.');
  const root = fs.realpathSync(path.dirname(path.resolve(manifestPath)));
  const candidate = fs.realpathSync(path.resolve(root, chapterPath));
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Book chapters must remain inside the manifest folder, including symbolic links.');
  if (!fs.statSync(candidate).isFile()) throw new Error('Book chapters must be publication files.');
  return candidate;
}
