import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  server: {
    port: 3000,
    open: false,
  },
  build: {
    manifest: true,
    rollupOptions: {
      external: [/^core-js/, 'canvg', 'html2canvas', 'dompurify'],
    },
  },
});
