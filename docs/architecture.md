# Architecture

## Overview

```
 ┌───────────────────────── your apps ─────────────────────────┐
 │  Browser / React     Node / SSR      Python      Edge / RN   │
 │  createForkcast()    forUser()       for_user() per request  │
 │     │  evaluate() locally: pure hashing, no network per call │
 └─────┼─────────────────────────────────────────────────────────┘
       │ GET /api/sdk/config     (on start)
       │ GET /api/sdk/stream     (SSE: config pushes)   ← or polling
       │ POST /api/sdk/events    (batched exposures + track)
 ┌─────▼──────────────────── forkcast server ───────────────────┐
 │  node:http router ─ SDK endpoints (client key, CORS *)        │
 │                   ─ Admin API (bearer token) ─ audit log      │
 │                   ─ static dashboard (dist/dashboard)         │
 │  stats.ts: z-test, Welch, SRM chi-square, verdicts            │
 │  ForkcastStorage ─ MemoryStorage ─ JsonFileStorage ─ (yours)  │
 └───────────────────────────────────────────────────────────────┘
       ▲
       │ same-origin fetch, 5 s polling
 ┌─────┴────── dashboard (React SPA, hash routing) ─────────────┐
 └───────────────────────────────────────────────────────────────┘
```

## Key design decisions

**Evaluation happens in the SDK, not the server.** The SDK downloads the environment's config once and evaluates locally with deterministic hashing. Reading a treatment costs microseconds, works offline, and the server only has to handle config fetches and event batches. The trade-off: audience rules and forced ids are visible to clients (same as most client-side flag SDKs).

**Deterministic hashing instead of stored assignments.** Users are sticky without a lookup. Traffic and variant use separate hash namespaces so ramping is monotonic. See [concepts.md](concepts.md#bucketing). The algorithm is an invariant.

**`C` is the universal fallback.** Every failure path (missing experiment, network error, invalid override, no user id) resolves to `C`. Application code can always treat `C` as "the old, safe behaviour".

**Per-environment state on the experiment.** One experiment definition (treatments, targeting, metrics) and a small `{ status, traffic, launchedVariant }` per environment. Promotion from staging to production is a status change, not a copy.

**Intention-to-treat analysis.** A user's first exposure fixes their analysis group. Conversions count only after that first exposure.

**Realtime via SSE.** Server-Sent Events are plain HTTP, pass through most proxies, reconnect automatically and need no library. Clients without `EventSource` poll.

**One evaluator, several languages.** The server never evaluates; each SDK does. `python/` is a port of `src/core` (hashing, targeting with JavaScript's value coercions, evaluation precedence) so Python services and JS clients agree on every user. Parity is enforced by a fixture generated from the JS code (`scripts/python-parity.ts`) and replayed by the Python tests. The Python client talks to the same three SDK endpoints, so the server needs no changes per language.

**Zero runtime dependencies.** The SDK, server and CLI use only platform APIs (`fetch`, `node:http`, `node:crypto`). The dashboard is pre-built and shipped as static files.

## Data model

```ts
Experiment {
  key, name, type: 'experiment' | 'flag',
  variants: [{ key: 'C', weight, payload? }, { key: 'T1', ... }],
  audience?: { match: 'all' | 'any', conditions: [{ attribute, operator, value }] },
  forced?: [{ variant, userIds }],
  environments: { [env]: { status: 'off' | 'running' | 'launched', traffic: 0-100, launchedVariant? } },
  metrics?: string[], salt?, owner?, tags?, archived?, description?, hypothesis?
}
```

Stored per environment and experiment by the JSON adapter:

```
assignments[env][experiment][userId] = { v: variant, t: firstExposureTs, n: exposures, a: {country...}, m: { [metric]: { n, v, t } } }
daily[env][experiment][YYYY-MM-DD][variant] = { users, exposures }
events[env][YYYY-MM-DD][name] = { count, value }
audit[] = { id, ts, actor, action, experiment?, environment?, detail? }
```

Results are computed on read from `assignments` and `daily` (`computeResults` in `src/server/stats.ts`), so changing metrics on an experiment re-analyses existing data.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/core/types.ts` | All shared types; the vocabulary of the project |
| `src/core/hash.ts` | MurmurHash3 and `bucketOf` (**invariant**) |
| `src/core/targeting.ts` | Operators and audience matching |
| `src/core/evaluate.ts` | The precedence chain; pure function |
| `src/core/validate.ts` | Validation, normalisation, `slugify` |
| `src/core/client.ts` | `ForkcastClient`: fetching, SSE, overrides, exposure queue, `forUser` |
| `src/react/index.tsx` | React bindings via `useSyncExternalStore` |
| `src/devtools/index.ts` | Shadow-DOM override panel |
| `src/server/storage.ts` | Storage interface, memory and JSON adapters, attribution |
| `src/server/stats.ts` | Statistics and verdicts; pure functions |
| `src/server/server.ts` | HTTP routing, auth, SSE, seeding, static files |
| `src/cli/index.ts` | `forkcast` binary |
| `dashboard/src` | React SPA (pages, charts, API client) |
| `python/src/forkcast/hashing.py`, `targeting.py`, `evaluate.py` | Python port of the evaluator (**must match `src/core`**) |
| `python/src/forkcast/_js.py` | JavaScript `String()` / `Number()` semantics used by targeting |
| `python/src/forkcast/client.py` | `Forkcast` / `ScopedForkcast`: config sync thread, SSE, event queue, fork safety |
| `python/src/forkcast/integrations/` | FastAPI dependency + lifespan, Flask extension |
| `scripts/python-parity.ts` | Generates the JS → Python parity fixture |

## Build output

`npm run build` produces:

```
dist/index.{js,cjs,d.ts}      forkcast
dist/react.{js,cjs,d.ts}      forkcast/react
dist/devtools.{js,cjs,d.ts}   forkcast/devtools
dist/server.{js,d.ts}         forkcast/server (ESM, Node)
dist/cli.js                   bin
dist/dashboard/               static SPA served by the server
```

`python -m build` (in `python/`) produces the PyPI wheel and sdist for `forkcast-sdk` in `python/dist/`.
