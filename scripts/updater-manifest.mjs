import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const TRUSTED_COMMENT = 'trusted comment: ';
const ED25519_PUBLIC_KEY_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function decodeBase64(value) {
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64') !== value) throw new Error('Invalid updater key or signature encoding.');
  return bytes;
}

export function verifyUpdaterSignature(installer, signature, publicKey, version) {
  const [, keyLine] = decodeBase64(publicKey.trim()).toString('utf8').split(/\r?\n/);
  const [, signatureLine, comment, globalLine] = decodeBase64(signature.trim()).toString('utf8').split(/\r?\n/);
  if (!keyLine || !signatureLine || !comment?.startsWith(TRUSTED_COMMENT) || !globalLine) {
    throw new Error('Invalid updater key or signature format.');
  }
  const key = decodeBase64(keyLine);
  const envelope = decodeBase64(signatureLine);
  const globalSignature = decodeBase64(globalLine);
  if (key.length !== 42 || key.toString('ascii', 0, 2) !== 'Ed' || envelope.length !== 74
    || envelope.toString('ascii', 0, 2) !== 'ED' || globalSignature.length !== 64) {
    throw new Error('Expected a prehashed Minisign updater signature.');
  }
  if (!key.subarray(2, 10).equals(envelope.subarray(2, 10))) {
    throw new Error('The installer signature uses a different key from the desktop app.');
  }

  const ed25519Key = createPublicKey({
    key: Buffer.concat([ED25519_PUBLIC_KEY_PREFIX, key.subarray(10)]), format: 'der', type: 'spki',
  });
  const installerSignature = envelope.subarray(10);
  const digest = createHash('blake2b512').update(installer).digest();
  const trustedComment = comment.slice(TRUSTED_COMMENT.length);
  if (!verify(null, digest, ed25519Key, installerSignature)
    || !verify(null, Buffer.concat([installerSignature, Buffer.from(trustedComment)]), ed25519Key, globalSignature)) {
    throw new Error('The updater signature does not verify against this installer and the desktop app key.');
  }

  const signedVersion = trustedComment.split('\t').find(field => field.startsWith('version:'))?.slice('version:'.length);
  if (!signedVersion || signedVersion.replace(/^v/, '') !== version) {
    throw new Error('The updater signature must authenticate the release version. Sign the installer with --app-version.');
  }
}

export function updaterManifest(version, signature, notes, repository = 'artificia1/recto-studio') {
  if (!STABLE_VERSION.test(version)) throw new Error('Expected a stable release version.');
  if (!signature.trim()) throw new Error('Missing updater signature.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Expected an owner/repository name.');
  return {
    version, notes, pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': {
      signature: signature.trim(),
      url: `https://github.com/${repository}/releases/download/v${version}/Recto-Studio-${version}-Windows-x64-setup.exe`,
    } },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const signaturePath = process.argv[2];
  if (!signaturePath?.endsWith('.sig')) throw new Error('Pass the installer signature file.');
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  if (version !== tauri.version) throw new Error('Package and desktop versions must match.');
  const signature = readFileSync(signaturePath, 'utf8');
  const installer = readFileSync(signaturePath.slice(0, -'.sig'.length));
  verifyUpdaterSignature(installer, signature, tauri.plugins.updater.pubkey, version);
  const manifest = updaterManifest(version, signature, readFileSync('RELEASE_NOTES.md', 'utf8'), process.env.GITHUB_REPOSITORY);
  writeFileSync('release-artifacts/latest.json', JSON.stringify(manifest, null, 2));
}
