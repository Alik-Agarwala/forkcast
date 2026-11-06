// Server-side evaluation example: plain Node http, no framework.
//
//   npm run build                      # builds dist/ (this example imports the built package)
//   npm run dev:server                 # starts Forkcast on :4400 with demo data
//   node examples/node-server/server.mjs
//   open http://localhost:3000/?user=alice&country=US
//
// In your own project: `import { createForkcast } from 'forkcast'`.
import { createServer } from 'node:http';
import { createForkcast } from '../../dist/index.js';

const forkcast = createForkcast({
  apiUrl: process.env.FORKCAST_URL ?? 'http://localhost:4400',
  clientKey: process.env.FORKCAST_CLIENT_KEY ?? 'fc_prod_demo_key',
  devMode: false, // server code: never accept overrides from users
});
await forkcast.ready();

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // One scoped evaluator per request. Cheap: no network calls, pure hashing.
  const fc = forkcast.forUser({ id: url.searchParams.get('user') ?? 'anonymous', country: url.searchParams.get('country') ?? 'US' });
  const checkout = fc.getTreatment('new-checkout');
  const hero = fc.getPayload('hero-headline');

  if (url.pathname === '/buy') {
    fc.track('purchase', { value: 25 });
    res.end('thanks!\n');
    return;
  }

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<h1>${hero?.headline ?? 'Welcome'}</h1>
<p>new-checkout treatment: <b>${checkout}</b></p>
<pre>${JSON.stringify(fc.getAllTreatments(), null, 2)}</pre>
<a href="/buy?user=${encodeURIComponent(fc.user.id)}">Buy</a>`);
}).listen(3000, () => console.log('Example app on http://localhost:3000/?user=alice&country=US'));

process.on('SIGINT', async () => {
  await forkcast.close(); // flush pending events
  process.exit(0);
});
