import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const assetFolder = new URL('../src/wasm/', import.meta.url);
mkdirSync(assetFolder, { recursive: true });
const result = spawnSync(process.env.RUSTC || 'rustc', [
  '--edition=2021', '--crate-type=cdylib', '--target=wasm32-unknown-unknown',
  '-C', 'opt-level=s', '-C', 'lto=fat', '-C', 'panic=abort', '-C', 'strip=symbols',
  '-C', 'link-arg=-z', '-C', 'link-arg=stack-size=65536', '-C', 'link-arg=--max-memory=3145728',
  fileURLToPath(new URL('../src-tauri/src/raster_wasm.rs', import.meta.url)),
  '-o', fileURLToPath(new URL('raster-kernels.wasm', assetFolder)),
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
