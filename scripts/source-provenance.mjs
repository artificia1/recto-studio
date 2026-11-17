import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const ref = process.argv[2] ?? 'HEAD';
const commit = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
const files = git('ls-tree', '-r', '-z', '--full-tree', commit).split('\0').filter(Boolean).map(row => {
  const tab = row.indexOf('\t');
  const [mode, type, object] = row.slice(0, tab).split(' ');
  return { path: row.slice(tab + 1), mode, type, object };
});
process.stdout.write(JSON.stringify({
  format: 'recto-source-provenance-v1',
  repository: 'https://github.com/artificia1/recto-studio',
  projectCredit: 'Abhinav Sidhu and Recto Studio Contributors',
  copyrightNotice: 'LICENSE',
  commit,
  objectFormat: git('rev-parse', '--show-object-format').trim(),
  files,
}, null, 2) + '\n');
