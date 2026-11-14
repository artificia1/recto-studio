import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

const label = process.argv[2];
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = path.join(root, 'src-tauri/target/release/bundle');
const output = path.join(root, 'release-artifacts');
const prefix = 'Recto-Studio-' + pkg.version + '-' + label;

async function collect(folder, extension, matches = () => true) {
  const directory = path.join(bundle, folder);
  const names = (await readdir(directory)).filter(name => /^recto[ -]studio[ -]mcp_/i.test(name) &&
    name.includes('_' + pkg.version + '_') && name.endsWith('.' + extension) && matches(name));
  if (names.length !== 1) throw new Error('Expected one ' + extension + ' package for ' + label + ', found ' + names.length + '.');
  const source = path.join(directory, names[0]);
  const suffix = extension === 'exe' ? '-setup_mcp.exe' : '_mcp.' + extension;
  await copyFile(source, path.join(output, prefix + suffix));
  return source;
}

function run(file, args, options = {}) {
  return execFileSync(file, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...options });
}

await mkdir(output, { recursive: true });
if (process.platform === 'win32' && label === 'Windows-x64') {
  await collect('nsis', 'exe', name => name.endsWith('-setup.exe'));
  const installed = await mkdtemp(path.join(tmpdir(), 'recto-mcp-'));
  const installer = path.join(output, prefix + '-setup_mcp.exe');
  run(installer, ['/S', '/D=' + installed]);
  const runtime = path.join(installed, 'mcp-runtime');
  const help = run(path.join(runtime, 'node.exe'), [path.join(runtime, 'bin/recto.js'), 'mcp', '--help']);
  if (!help.includes('--workspace')) throw new Error('The Windows installer is missing its working MCP server.');
  run(process.execPath, [path.join(root, 'scripts/desktop-smoke.mjs'), path.join(installed, 'recto-studio-mcp.exe')], { stdio: 'inherit' });
} else if (process.platform === 'darwin' && label === (process.arch === 'arm64' ? 'macOS-arm64' : 'macOS-x86_64')) {
  const image = await collect('dmg', 'dmg');
  const mount = await mkdtemp(path.join(tmpdir(), 'recto-mcp-'));
  let attached = false;
  try {
    run('hdiutil', ['verify', image, '-quiet']);
    run('hdiutil', ['attach', image, '-readonly', '-nobrowse', '-mountpoint', mount, '-quiet']);
    attached = true;
    const app = path.join(mount, 'Recto Studio MCP.app');
    const runtime = path.join(app, 'Contents/Resources/mcp-runtime');
    run('codesign', ['--verify', '--deep', '--strict', app]);
    run('lipo', [path.join(app, 'Contents/MacOS/recto-studio-mcp'), '-verify_arch', process.arch === 'arm64' ? 'arm64' : 'x86_64']);
    const help = run(path.join(runtime, 'node'), [path.join(runtime, 'bin/recto.js'), 'mcp', '--help']);
    if (!help.includes('--workspace')) throw new Error('The disk image is missing its working MCP server.');
  } finally {
    if (attached) run('hdiutil', ['detach', mount, '-quiet']);
    await rmdir(mount).catch(() => {});
  }
} else if (process.platform === 'linux' && label === 'Linux-x64') {
  const deb = await collect('deb', 'deb');
  await collect('appimage', 'AppImage');
  const files = run('dpkg-deb', ['--contents', deb], { maxBuffer: 32 * 1024 * 1024 });
  if (!files.includes('/mcp-runtime/node') || !files.includes('/mcp-runtime/bin/recto.js')) throw new Error('Debian bundle is missing the MCP runtime.');
  run('zip', ['-q', '-r', path.join(output, prefix + '-mcp-runtime.zip'), 'mcp-runtime'], { cwd: path.join(root, 'src-tauri') });
} else throw new Error('Unexpected platform label ' + label + '.');
