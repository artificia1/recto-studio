import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function updaterManifest(version, signature, notes, repository = 'artificia1/recto-studio') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version.');
  if (!signature.trim()) throw new Error('Missing updater signature.');
  return {
    version, notes, pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': {
      signature: signature.trim(),
      url: `https://github.com/${repository}/releases/download/v${version}/Recto-Studio-${version}-Windows-x64-setup.exe`,
    } },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  writeFileSync('release-artifacts/latest.json', JSON.stringify(updaterManifest(version,
    readFileSync(process.argv[2], 'utf8'), readFileSync('RELEASE_NOTES.md', 'utf8')), null, 2));
}
