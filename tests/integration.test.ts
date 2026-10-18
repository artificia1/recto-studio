import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('Recto Studio Core Engine Verification', () => {
  it(
    'executes and passes all engine integration suites flawlessly',
    () => {
      const output = execSync('npx tsx test.ts', { encoding: 'utf8' });
      expect(output).toMatch(/ALL \d+ TEST SUITES PASSED FLAWLESSLY! \(100% OK\)/);
    },
    60000
  );
});
