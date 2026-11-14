import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

describe('Recto Studio legacy engine integration', () => {
  it('passes the engine integration suites in a separate Node process', async () => {
    const { stdout } = await run(process.execPath, ['--import', 'tsx', 'test.ts'], {
      timeout: 240_000, encoding: 'utf8',
    });
    expect(stdout).toMatch(/ALL \d+ TEST SUITES PASSED FLAWLESSLY! \(100% OK\)/);
  }, 250_000);
});
