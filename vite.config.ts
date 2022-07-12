import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 3000,
    open: false,
  },
  build: {
    rollupOptions: {
      external: [/^core-js/, 'canvg', 'html2canvas', 'dompurify'],
    },
  },
});
