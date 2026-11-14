import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = path.join(root, 'src-tauri', 'mcp-runtime');
const executable = path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node');
const entry = path.join(runtime, 'bin', 'recto.js');

// Use a fresh directory so the package cannot pick up local development files.
await mkdir(runtime);
for (const name of ['src', 'bin', 'scripts', 'public']) {
  await cp(path.join(root, name), path.join(runtime, name), { recursive: true });
}
for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'PUBLISHING_AUTOMATION.md']) {
  await copyFile(path.join(root, name), path.join(runtime, name));
}
await copyFile(process.execPath, executable);
const nodeHome = path.dirname(process.execPath);
const license = await Promise.any([nodeHome, path.dirname(nodeHome)].map(directory => readFile(path.join(directory, 'LICENSE'))))
  .catch(async () => {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Could not locate the Node.js license (HTTP ${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  });
await writeFile(path.join(runtime, 'NODE-LICENSE.txt'), license);

const npmArgs = ['ci', '--omit=dev', '--no-bin-links', '--no-audit', '--no-fund'];
if (!process.env.npm_execpath) throw new Error('Run this script using npm run prepare:mcp-runtime.');
execFileSync(process.execPath, [process.env.npm_execpath, ...npmArgs], { cwd: runtime, stdio: 'inherit' });

if (!(await stat(entry)).isFile()) throw new Error('The bundled CLI is missing.');
const client = new Client({ name: 'recto-runtime-check', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: executable, cwd: runtime,
    args: [entry, 'mcp', '--workspace', runtime] }), { timeout: 90000 });
  const result = await client.callTool({ name: 'recto_available_features', arguments: {} }, { timeout: 90000 });
  if (result.isError || result.structuredContent?.mode !== 'read-only') throw new Error('The bundled server failed its stdio check.');
  const help = execFileSync(executable, [entry, 'mcp', '--help'], { cwd: runtime, encoding: 'utf8' });
  if (!help.includes('--workspace')) throw new Error('The bundled executable did not start the Recto CLI.');
  console.log('Bundled MCP server answered over stdio.');
} finally { await client.close(); }
