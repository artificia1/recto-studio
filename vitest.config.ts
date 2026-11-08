import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Font, SVG and WASM suites each allocate native buffers. Bound concurrency
    // so headless integration does not compete with dozens of cold runtimes.
    maxWorkers: 2,
    // The WASM wrapper publishes extensionless ESM imports; resolve them through Vite.
    server: { deps: { inline: ['@kittl/little-cms'] } },
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Cold headless PDF exports initialize native SVG rendering and system fonts.
    testTimeout: 20000,
  },
});
