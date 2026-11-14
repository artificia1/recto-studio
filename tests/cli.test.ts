import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { stateManager } from '../src/state';

const run = promisify(execFile);
const cli = resolve('bin/recto.js');
const exportTimeout = 90_000;

describe('Headless Publishing CLI Engine (recto build)', () => {
  let directory: string;
  let project: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recto-cli-'));
    project = join(directory, 'project.recto');
    await writeFile(project, JSON.stringify(stateManager.getState()));
  });

  afterAll(async () => {
    if (directory) await rm(directory, { force: true, recursive: true });
  });

  async function build(format: string, filename: string, ...flags: string[]) {
    const output = join(directory, filename);
    await run(process.execPath, [cli, 'build', project, '--export', format, '--output', output, ...flags], {
      timeout: exportTimeout,
    });
    return readFile(output);
  }

  it('generates a print-ready PDF', async () => {
    const pdf = await build('pdf/x-1a', 'output.pdf', '--crop-marks', '--bleed');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.toString('utf8', 0, 5)).toBe('%PDF-');
  }, exportTimeout + 5000);

  it('generates an HTML flipbook', async () => {
    const html = await build('flipbook', 'flipbook.html');
    expect(html.toString('utf8')).toContain('flipbook-stage');
  }, exportTimeout + 5000);

  it('generates an EPUB 3 archive', async () => {
    const epub = await build('epub', 'book.epub');
    expect(epub.length).toBeGreaterThan(500);
    expect(epub.toString('ascii', 0, 2)).toBe('PK');
  }, exportTimeout + 5000);
});
