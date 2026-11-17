import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const manifest = fileURLToPath(new URL('../native/Cargo.toml', import.meta.url));
const target = fileURLToPath(new URL('../build/recto-shaping/', import.meta.url));
const build = spawnSync(process.env.CARGO || 'cargo', [
  'rustc', '--manifest-path', manifest, '--target-dir', target, '--lib', '--release', '--locked',
  '--target', 'wasm32-unknown-unknown', '--', '-C', 'link-arg=--max-memory=16777216',
], { stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const assets = new URL('../src/wasm/', import.meta.url);
mkdirSync(assets, { recursive: true });
copyFileSync(new URL('../build/recto-shaping/wasm32-unknown-unknown/release/recto_shaper.wasm', import.meta.url),
  new URL('font-shaping.wasm', assets));
