import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

if (!process.argv[2]) throw new Error('Pass the path to the built recto-native binary.');
const binary = path.resolve(process.argv[2]);
const temp = await mkdtemp(path.join(os.tmpdir(), 'recto-native-'));
const root = path.join(temp, 'workspace');
const client = new Client({ name: 'recto-native-check', version: '1.0.0' });
try {
  await mkdir(root);
  const body = JSON.stringify({ settings: { title: 'Rust proof' }, spreads: [
    { id: 'sp1', pages: [{ id: 'p1', pageNumber: 1 }], elements: [{ id: 'f1' }] },
    { id: 'sp2', pages: [{ id: 'p2', pageNumber: 2 }], elements: [] },
  ] });
  const project = path.join(root, 'proof.recto');
  const revision = createHash('sha256').update(body).digest('hex');
  await writeFile(project, body);
  await writeFile(path.join(temp, 'outside.recto'), body);
  await link(path.join(temp, 'outside.recto'), path.join(root, 'linked.recto'));
  await symlink(temp, path.join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = JSON.parse(execFileSync(binary, ['inspect', project], { encoding: 'utf8' }));
  assert.equal(result.revision, revision);
  assert.equal(result.pageCount, 2);
  const timeout = 30_000;
  await client.connect(new StdioClientTransport({ command: binary, args: ['mcp', '--workspace', root] }), { timeout });
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(tool => tool.name), ['recto_inspect_publication', 'recto_plan_imposition']);
  const sheets = await client.callTool({ name: 'recto_plan_imposition',
    arguments: { pageCount: 8, pageWidthMm: 55, pageHeightMm: 75, bindingMode: 'mini-zine-8page' } }, { timeout });
  assert.equal(sheets.structuredContent?.totalSides, 1);
  assert.equal(sheets.structuredContent?.sheetWidthMm, 220);
  assert.deepEqual(sheets.structuredContent?.sheetSides[0].panels, [5, 4, 3, 2, 6, 7, 8, 1]);
  async function inspect(args) {
    return client.callTool({ name: 'recto_inspect_publication', arguments: args }, { timeout });
  }
  const reply = await inspect({ project: 'proof.recto', revision, limit: 1 });
  assert.equal(reply.structuredContent?.revision, revision);
  assert.equal(reply.structuredContent?.nextOffset, 1);
  assert.equal(reply.structuredContent?.spreads[0]?.pages[0]?.id, 'p1');
  for (const filename of ['../outside.recto', 'outside/outside.recto', 'linked.recto', 'NUL.recto']) {
    assert.equal((await inspect({ project: filename })).isError, true);
  }
  assert.equal((await inspect({ project: 'proof.recto', revision: '0'.repeat(64) })).isError, true);
  console.log('Native CLI inventory and MCP stdio verification passed.');
} finally {
  await client.close();
  await rm(temp, { recursive: true, force: true });
}
