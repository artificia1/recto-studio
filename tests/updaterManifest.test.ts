import { describe, expect, it } from 'vitest';
// @ts-expect-error The release utility is a standalone Node module.
import { updaterManifest, verifyUpdaterSignature } from '../scripts/updater-manifest.mjs';

// Public test vector from the Tauri updater's offline tests (payload "test", version 2.0.0).
const publicKey = Buffer.from([
  'untrusted comment: minisign public key: A49EF4746FA6E6D7',
  'RWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe',
].join('\n')).toString('base64');
const signatureLines = [
  'untrusted comment: signature from tauri secret key',
  'RUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=',
  'trusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0',
  'DDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==',
];
const signature = Buffer.from(signatureLines.join('\n')).toString('base64');

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
    expect(() => updaterManifest('1.03.0', 'signature', '')).toThrow('version');
  });
  it('authenticates Tauri installer bytes with the app key', () => {
    expect(() => verifyUpdaterSignature(Buffer.from('test'), signature, publicKey, '2.0.0')).not.toThrow();
    expect(() => verifyUpdaterSignature(Buffer.from('modified installer'), signature, publicKey, '2.0.0')).toThrow('does not verify');
    const wrongKey = Buffer.from(Buffer.from(publicKey, 'base64').toString().replace('RWTX', 'RWTY')).toString('base64');
    expect(() => verifyUpdaterSignature(Buffer.from('test'), signature, wrongKey, '2.0.0')).toThrow('different key');
  });
  it('refuses a signature belonging to another release version or an edited version comment', () => {
    expect(() => verifyUpdaterSignature(Buffer.from('test'), signature, publicKey, '3.0.0')).toThrow('release version');
    const changed = Buffer.from(signatureLines.join('\n').replace('version:2.0.0', 'version:3.0.0')).toString('base64');
    expect(() => verifyUpdaterSignature(Buffer.from('test'), changed, publicKey, '3.0.0')).toThrow('does not verify');
  });
});
