// Runtime smoke test of the BUILT package (dist/). Runs on every supported Node version in CI.
//   npm run build && node scripts/smoke.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createForkcast } from '../dist/index.js';
import { createForkcastServer } from '../dist/server.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');
assert.equal(typeof cjs.createForkcast, 'function', 'CommonJS entry works');

const server = await createForkcastServer({
  seed: {
    version: 1,
    environments: [{ key: 'production', name: 'Production', clientKey: 'smoke_key' }],
    experiments: [
      {
        key: 'smoke',
        name: 'Smoke',
        type: 'experiment',
        variants: [
          { key: 'C', weight: 50 },
          { key: 'T1', weight: 50 },
        ],
        metrics: ['purchase'],
        environments: { production: { status: 'running', traffic: 100 } },
      },
    ],
  },
});
const { url } = await server.listen(0, '127.0.0.1');
const fc = createForkcast({ apiUrl: url, clientKey: 'smoke_key', devMode: false, realtime: false, refreshInterval: 0, flushInterval: 0 });
await fc.ready();
for (let i = 0; i < 50; i++) {
  const u = fc.forUser({ id: `u${i}` });
  assert.ok(['C', 'T1'].includes(u.getTreatment('smoke')));
  u.track('purchase', { value: 1 });
}
await fc.close();
const results = await fetch(`${url}/api/experiments/smoke/results?env=production`).then((r) => r.json());
assert.equal(results.totalUsers, 50, 'events reached the server');
const html = await fetch(url).then((r) => r.text());
assert.ok(html.includes('id="root"'), 'dashboard is served');
await server.close();
console.log(`smoke test passed on Node ${process.version}`);
