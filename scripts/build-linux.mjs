import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux') {
  console.error('Linux packages must be built on Linux. Use the manual Linux artifacts workflow or a Linux checkout.');
  process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'build', '--config', 'src-tauri/tauri.linux.conf.json', '--bundles', 'deb,appimage', '--', '--locked'], { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
