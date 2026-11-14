import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
for (const options of [
  process.argv.slice(2),
  ['--config', 'vitest.integration.config.ts'],
]) {
  const result = spawnSync(process.execPath, [vitest, 'run', ...options], { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
