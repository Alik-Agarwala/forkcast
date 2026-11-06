import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(`../../src/${p}`, import.meta.url));

// In your own app you would just `npm install forkcast`. Here we alias to the
// source so the demo always runs against the code in this repo, no build needed.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^forkcast\/react$/, replacement: src('react/index.tsx') },
      { find: /^forkcast\/devtools$/, replacement: src('devtools/index.ts') },
      { find: /^forkcast$/, replacement: src('core/index.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173 },
});
