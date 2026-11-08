import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Cold headless PDF exports initialize native SVG rendering and system fonts.
    testTimeout: 20000,
  },
});
