import { describe, expect, it } from 'vitest';
// @ts-expect-error The release utility is a standalone Node module.
import { updaterManifest } from '../scripts/updater-manifest.mjs';

describe('Signed update manifest', () => {
  it('addresses the exact versioned installer and embeds its signature', () => {
    const manifest = updaterManifest('1.3.0', 'signed-content\n', 'Release notes');
    expect(manifest.platforms['windows-x86_64']).toEqual({ signature: 'signed-content',
      url: 'https://github.com/artificia1/recto-studio/releases/download/v1.3.0/Recto-Studio-1.3.0-Windows-x64-setup.exe' });
    expect(manifest.notes).toBe('Release notes');
  });
  it('refuses unsigned or malformed releases', () => {
    expect(() => updaterManifest('1.3.0', ' ', '')).toThrow('signature');
    expect(() => updaterManifest('../latest', 'signature', '')).toThrow('version');
  });
});
