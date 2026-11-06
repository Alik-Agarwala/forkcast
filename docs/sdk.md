# SDK reference

```bash
npm install forkcast
```

| Import | Contents |
| --- | --- |
| `forkcast` | `createForkcast`, `evaluate`, validation helpers, types |
| `forkcast/react` | `ForkcastProvider`, hooks, `<Experiment>`, `<Variant>`, `<Feature>` |
| `forkcast/devtools` | `mountDevtools` floating panel |
| `forkcast/server` | Self-hosted server, storage adapters, statistics (Node only, see [server.md](server.md)) |

All entry points ship ESM, CommonJS and TypeScript declarations. There are no runtime dependencies; React is an optional peer dependency used only by `forkcast/react`.

## `createForkcast(options)`

Creates a client. Create **one** per app (browser) or per process (server).

```ts
import { createForkcast } from 'forkcast';

const forkcast = createForkcast({
  apiUrl: 'https://flags.example.com',
  clientKey: 'fc_prod_...',
  user: { id: 'u_123', country: 'IN' },
});
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `user` | `UserContext` | `{}` | `{ id, country, ...anyAttributes }`. Attributes are used for targeting. |
| `apiUrl` | `string` | – | Forkcast server URL. With `clientKey`, enables **remote mode**. |
| `clientKey` | `string` | – | Public key of an environment. Decides which environment's settings apply. |
| `config` | `ForkcastConfig \| Experiment[]` | – | **Local mode**: evaluate these experiments with no server. |
| `environment` | `string` | `development` in dev mode, else `production` | Environment used in local mode. In remote mode it comes from the key. |
| `devMode` | `boolean` | auto | Enables overrides and debug logging. Auto: `NODE_ENV !== 'production'`, or a `localhost` hostname. Pass it explicitly when you can (`import.meta.env.DEV`). |
| `allowOverrides` | `boolean` | `devMode` | Accept `?forkcast=` URL params, devtools and `override()`. |
| `overrides` | `Record<string, string>` | – | Overrides applied at start (when allowed). |
| `trackExposures` | `boolean` | `true` | Record exposures automatically. |
| `realtime` | `boolean` | `true` | Live config over Server-Sent Events when `EventSource` exists. |
| `refreshInterval` | `number` (ms) | `30000` | Polling interval when realtime is unavailable. `0` disables. |
| `flushInterval` | `number` (ms) | `2000` | How often queued events are sent. `0` disables the timer (call `flush()`). |
| `bootstrap` | `ForkcastConfig \| Experiment[]` | – | Initial config before the first fetch (SSR, offline cache). |
| `persist` | `boolean` | `true` | Store anonymous id and overrides in `localStorage`. |
| `fetch` | `typeof fetch` | global | Custom fetch implementation. |
| `debug` | `boolean` | `false` | Log every evaluation. |
| `onError` | `(err) => void` | warn in dev | Network or parsing errors. The client never throws from evaluation. |

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `ready()` | `Promise<void>` | Resolves after the first config fetch **or failure**. Never rejects. |
| `initialized` | `boolean` | `true` after `ready()` resolved. |
| `getTreatment(key)` | `string` | `'C'`, `'T1'`, … Records an exposure if the user is bucketed. |
| `getVariant(key)` | `Evaluation` | `{ experiment, variant, payload, reason, inExperiment }` |
| `isEnabled(key)` | `boolean` | `getTreatment(key) !== 'C'` |
| `getPayload<T>(key)` | `T \| undefined` | JSON payload attached to the treatment. |
| `peek(key)` | `Evaluation` | Same as `getVariant` but **never** records an exposure. |
| `getAllTreatments()` | `Record<string, string>` | Every known experiment, without exposures. |
| `track(name, props?)` | `void` | Conversion event. `props.value` (number) is summed; other props are stored. |
| `setUser(user)` | `void` | Switch user (login/logout). Triggers subscribers. |
| `getUser()` | `UserContext` | Current user, including the generated anonymous id. |
| `forUser(user)` | `ScopedForkcast` | Evaluator bound to another user (server requests). |
| `override(key, variant \| null)` | `void` | Force a treatment locally. Ignored when overrides are not allowed. |
| `getOverrides()` / `clearOverrides()` | | |
| `subscribe(listener)` | `() => void` | Called on config, user and override changes. |
| `refresh()` | `Promise<void>` | Fetch config now. |
| `flush()` | `Promise<void>` | Send queued events now. |
| `close()` | `Promise<void>` | Stop timers/streams and flush. Call on shutdown. |
| `getEnvironment()`, `getExperiments()`, `getVersion()` | | Introspection. |

### Evaluation reasons

`getVariant(key).reason` explains every decision:

| Reason | Meaning |
| --- | --- |
| `assigned` | Randomly bucketed. Counted in results. |
| `launched` | Experiment launched; everyone gets this treatment. |
| `forced` | User id is in a forced list. |
| `override` | Developer override. |
| `off` | Off in this environment. |
| `not_targeted` | Audience rules did not match. |
| `not_in_traffic` | Outside the traffic %. |
| `no_user` | No user id to bucket with. |
| `archived`, `not_found` | Experiment archived or unknown. |

## React (`forkcast/react`)

```tsx
import { createForkcast } from 'forkcast';
import { ForkcastProvider } from 'forkcast/react';

const forkcast = createForkcast({ apiUrl, clientKey, user });

root.render(
  <ForkcastProvider client={forkcast}>
    <App />
  </ForkcastProvider>,
);
```

`<ForkcastProvider options={...}>` can create the client for you, but creating it outside React (as above) avoids duplicate clients in Strict Mode and lets non-React code share it.

### Hooks

| Hook | Returns |
| --- | --- |
| `useTreatment(key)` | `'C' \| 'T1' \| ...` |
| `useFlag(key)` | `boolean` |
| `useVariant<P>(key)` | `Evaluation<P>` |
| `usePayload<P>(key)` | `P \| undefined` |
| `useTrack()` | stable `track(name, props)` |
| `useForkcastReady()` | `boolean` |
| `useForkcast()` | the client |

All hooks re-render on config changes (including realtime toggles from the dashboard), user changes and overrides.

### Components

```tsx
<Experiment name="new-checkout" loading={<Spinner />}>
  <Variant name="C"><ClassicCheckout /></Variant>
  <Variant name="T1"><OneClickCheckout /></Variant>
  <Variant name="T2"><StickyBar /></Variant>
</Experiment>
```

Renders the matching `<Variant>`, falling back to the `C` branch for unknown treatments. `loading` is optional; without it the `C` branch renders while loading.

```tsx
<Feature flag="dark-mode" fallback={<Light />}>
  <Dark />
</Feature>
```

### Avoiding flicker

In client-only apps the first render happens before config arrives, so users briefly see `C`. Options:

1. Gate the relevant UI with `useForkcastReady()` or `<Experiment loading={...}>`.
2. **SSR**: evaluate on the server and pass `bootstrap` to the browser client:

```ts
// server
const config = await fetch(`${apiUrl}/api/sdk/config`, { headers: { 'x-forkcast-key': key } }).then((r) => r.json());
// embed `config` in the HTML, then in the browser:
createForkcast({ apiUrl, clientKey, user, bootstrap: window.__FORKCAST__ });
```

## Devtools (`forkcast/devtools`)

```ts
import { mountDevtools } from 'forkcast/devtools';
const unmount = mountDevtools(forkcast, { position: 'bottom-right' });
```

A floating **FC** button opens a panel listing every experiment, the current treatment and the reason, with a dropdown to override it. **Copy share link** produces a URL like `https://app.test/?forkcast=new-checkout:T1,dark-mode:C` that reproduces your overrides for a teammate.

It does nothing unless overrides are allowed (dev mode), so leaving the call in production code is safe. Pass `{ force: true }` for an internal QA build.

## URL overrides

When overrides are allowed:

```
?forkcast=new-checkout:T1               force one
?forkcast=new-checkout:T1,dark-mode:C   force several
?forkcast=reset                         clear all
```

Overrides persist in `localStorage` until reset.

## Node.js

```ts
import { createForkcast } from 'forkcast';

const forkcast = createForkcast({
  apiUrl: process.env.FORKCAST_URL,
  clientKey: process.env.FORKCAST_CLIENT_KEY,
  devMode: false,
});
await forkcast.ready();

// Express
app.use((req, res, next) => {
  req.fc = forkcast.forUser({ id: req.user?.id ?? req.sessionID, country: req.get('cf-ipcountry') });
  next();
});

app.get('/', (req, res) => {
  if (req.fc.isEnabled('new-homepage')) return res.render('home-v2');
  res.render('home');
});

app.post('/orders', (req, res) => {
  req.fc.track('purchase', { value: req.body.total });
  // ...
});

process.on('SIGTERM', () => forkcast.close());
```

`forUser()` is pure computation (no network), so calling it per request is cheap. Node 18+ has `fetch`; there is no `EventSource`, so servers poll every `refreshInterval` (30s by default). Lower it if you need faster propagation.

## Local mode (no server)

```ts
import config from './forkcast.config.json' assert { type: 'json' };

const forkcast = createForkcast({ config, environment: 'production', user: { id } });
```

In local mode nothing is sent anywhere: no exposures and no events. Useful for tests, static sites, edge functions, or as a first step before running a server. Generate a starter file with `npx forkcast init` and validate it in CI with `npx forkcast validate`.

## Testing your app

```ts
const forkcast = createForkcast({
  config: [], // nothing configured: everything is C
  devMode: true,
  persist: false,
  overrides: { 'new-checkout': 'T1' }, // force the branch under test
});
```

Or use `evaluate()` directly for pure unit tests:

```ts
import { evaluate } from 'forkcast';
evaluate(experiment, 'new-checkout', { id: 'u1' }, { environment: 'production' }).variant;
```

## Types

```ts
import type { Experiment, Variant, UserContext, Evaluation, ForkcastConfig, Audience, Condition } from 'forkcast';
```

See [`src/core/types.ts`](../src/core/types.ts) for the documented definitions.
