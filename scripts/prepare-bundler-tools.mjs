import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Fetch public packaging helpers through the release asset API when direct
// github.com release downloads are unavailable. Never log the job credential.
const headers = { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
const cache = resolve(process.platform === 'win32' ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local') : process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tauri');
mkdirSync(cache, { recursive: true });

async function fetchChecked(url, options) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Packaging helper request returned HTTP ${response.status}`);
      return response;
    } catch (reason) { error = reason; if (attempt < 2) await new Promise(done => setTimeout(done, 5000)); }
  }
  throw error;
}

async function download(repository, tag, name, target, sha1) {
  const release = await (await fetchChecked(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, { headers })).json();
  const asset = release.assets.find(item => item.name === name);
  if (!asset) throw new Error(`Missing upstream helper ${repository}/${tag}/${name}`);
  const bytes = Buffer.from(await (await fetchChecked(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' } })).arrayBuffer());
  if (asset.digest?.startsWith('sha256:') && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) throw new Error(`Invalid upstream digest: ${name}`);
  if (sha1 && createHash('sha1').update(bytes).digest('hex').toUpperCase() !== sha1) throw new Error(`Invalid Tauri toolchain hash: ${name}`);
  writeFileSync(target, bytes);
  if (process.platform !== 'win32') chmodSync(target, 0o755);
  console.log(`Prepared packaging helper: ${name}`);
}

if (process.platform === 'win32') {
  const nsis = join(cache, 'NSIS');
  if (!existsSync(join(nsis, 'makensis.exe'))) {
    const zip = join(cache, 'nsis-3.13.zip');
    await download('tauri-apps/binary-releases', 'nsis-3.13', 'nsis-3.13.zip', zip, 'DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E');
    const extracted = spawnSync('tar', ['-xf', zip, '-C', cache], { stdio: 'inherit', windowsHide: true });
    if (extracted.status !== 0) throw new Error('Could not extract NSIS helpers.');
    renameSync(join(cache, 'nsis-3.13'), nsis);
  }
  const plugins = join(nsis, 'Plugins', 'x86-unicode', 'additional');
  mkdirSync(plugins, { recursive: true });
  await download('tauri-apps/nsis-tauri-utils', 'nsis_tauri_utils-v0.5.3', 'nsis_tauri_utils.dll', join(plugins, 'nsis_tauri_utils.dll'), '75197FEE3C6A814FE035788D1C34EAD39349B860');
} else if (process.platform === 'linux') {
  await download('tauri-apps/binary-releases', 'apprun-old', 'AppRun-x86_64', join(cache, 'AppRun-x86_64'));
  await download('tauri-apps/binary-releases', 'linuxdeploy-07333c6', 'linuxdeploy-x86_64.AppImage', join(cache, 'linuxdeploy-07333c6-x86_64.AppImage'));
  await download('linuxdeploy/linuxdeploy-plugin-appimage', 'continuous', 'linuxdeploy-plugin-appimage-x86_64.AppImage', join(cache, 'linuxdeploy-plugin-appimage.AppImage'));
} else throw new Error('Packaging helpers support Windows and Linux runners.');
