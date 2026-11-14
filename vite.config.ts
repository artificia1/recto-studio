import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { offlineBuild } from './scripts/offlineBuild';

export default defineConfig({
  base: './',
  plugins: [preact(), offlineBuild()],
  server: {
    port: 3000,
    open: false,
  },
  optimizeDeps: {
    // The native SVG rasterizer is loaded by Node's export path only.
    exclude: ['@resvg/resvg-js'],
  },
  worker: { format: 'es' },
  build: {
    manifest: true,
    rollupOptions: {
      external: [/^core-js/, /^node:/, '@resvg/resvg-js', 'canvg', 'html2canvas', 'dompurify'],
    },
  },
});
