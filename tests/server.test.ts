import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createStaticServer } from '../server.js';

describe('Local desktop server boundaries', () => {
  let directory: string;
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'recto-server-'));
    const root = path.join(directory, 'dist');
    await mkdir(root);
    await writeFile(path.join(root, 'index.html'), '<h1>Recto</h1>');
    await writeFile(path.join(root, 'hello world.js'), 'export {};');
    await writeFile(path.join(root, '.secret'), 'hidden');
    await writeFile(path.join(directory, 'private.txt'), 'private');
    await symlink(directory, path.join(root, 'outside'), 'junction');
    server = createStaticServer(root);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  function request(url: string, method = 'GET') {
    return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  it('serves built entry and encoded assets without wildcard CORS', async () => {
    const response = await request('/?version=1');
    expect(response.status).toBe(200);
    expect(response.body).toContain('Recto');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request('/hello%20world.js')).status).toBe(200);
    expect((await request('/', 'HEAD')).body).toBe('');
  });
  it.each(['/../private.txt', '/%2e%2e/private.txt', '/..%5cprivate.txt', '/%2e%2e%2fprivate.txt', '/.secret', '/.git/config', '/C:/private.txt', '/%00'])('rejects unsafe path %s', async url => {
    expect((await request(url)).status).toBe(403);
  });
  it('blocks links escaping the public directory', async () => {
    expect((await request('/outside/private.txt')).status).toBe(403);
  });
  it('does not fall back to repository files', async () => {
    expect((await request('/private.txt')).status).toBe(404);
  });
  it('handles invalid encoding and unsupported methods', async () => {
    expect((await request('/%ZZ')).status).toBe(400);
    expect((await request('/', 'POST')).status).toBe(405);
  });
});
