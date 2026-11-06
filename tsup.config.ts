import { defineConfig } from 'tsup';

export default defineConfig([
  // Universal entries: run in browsers, Node, Deno, Bun, edge runtimes.
  {
    entry: {
      index: 'src/core/index.ts',
      react: 'src/react/index.tsx',
      devtools: 'src/devtools/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2019',
    external: ['react', 'react/jsx-runtime'],
    clean: false,
  },
  // Node-only entries: the self-hosted server + CLI.
  {
    entry: {
      server: 'src/server/index.ts',
      cli: 'src/cli/index.ts',
    },
    format: ['esm'],
    dts: { entry: { server: 'src/server/index.ts' } },
    sourcemap: true,
    platform: 'node',
    target: 'node18',
    clean: false,
  },
]);
