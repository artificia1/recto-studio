import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('Recto Studio Core Engine Verification', () => {
  it(
    'executes and passes all engine integration suites flawlessly',
    () => {
      // This child runs all 58 legacy suites, including cold font and PDF engines.
      // Bound the child itself so a stalled process cannot outlive the test runner.
      const output = execSync('npx tsx test.ts', { encoding: 'utf8', timeout: 120000 });
      expect(output).toMatch(/ALL \d+ TEST SUITES PASSED FLAWLESSLY! \(100% OK\)/);
    },
    130000
  );
});
