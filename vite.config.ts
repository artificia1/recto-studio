import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  server: {
    port: 3000,
    open: false,
  },
  optimizeDeps: {
    // The native SVG rasterizer is loaded by Node's export path only.
    exclude: ['@resvg/resvg-js'],
  },
  build: {
    manifest: true,
    rollupOptions: {
      external: [/^core-js/, /^node:/, '@resvg/resvg-js', 'canvg', 'html2canvas', 'dompurify'],
    },
  },
});
