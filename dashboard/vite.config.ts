import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// The dashboard is a static SPA compiled into dist/dashboard and served by `forkcast start`.
export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/dashboard', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:4400' },
  },
});
