# Server, CLI and REST API

The Forkcast server is a single Node process that serves the dashboard, the admin API and the SDK endpoints. It has no dependencies beyond Node ≥ 18.

## CLI

```bash
npx forkcast start [options]     # API + dashboard
npx forkcast init [file]         # write a starter forkcast.config.json
npx forkcast validate [file]     # validate a config file (non-zero exit on errors, good for CI)
```

| Flag | Env var | Default | |
| --- | --- | --- | --- |
| `-p, --port` | `FORKCAST_PORT`, `PORT` | `4400` | |
| `--host` | `FORKCAST_HOST` | `0.0.0.0` | |
| `-d, --data` | `FORKCAST_DATA` | `.forkcast/data.json` | JSON data file |
| `--seed` | `FORKCAST_SEED` | – | Config imported when the store has no experiments. May also set environments and client keys. |
| `--admin-token` | `FORKCAST_ADMIN_TOKEN` | – | Required for the dashboard and admin API when set |
| `--memory` | – | – | Do not persist anything |
| `--no-dashboard` | – | – | API only |

## Embedding in your Node app

```ts
import express from 'express';
import { createForkcastServer, JsonFileStorage } from 'forkcast/server';

const forkcast = await createForkcastServer({
  storage: new JsonFileStorage('./data/forkcast.json'),
  adminToken: process.env.FORKCAST_ADMIN_TOKEN,
});

const app = express();
app.use('/forkcast', forkcast.handler); // dashboard at /forkcast/ (note the trailing slash)
app.listen(3000);
```

Or standalone: `const { url } = await forkcast.listen(4400)`. Call `forkcast.close()` on shutdown to flush data.

### `createForkcastServer(options)`

| Option | Description |
| --- | --- |
| `storage` | A `ForkcastStorage` adapter. Default: `JsonFileStorage(dataFile)` or `MemoryStorage` |
| `dataFile` | Path for the default JSON storage |
| `adminToken` | Bearer token for the admin API and dashboard |
| `dashboard` | `true` (bundled), `false`, or a directory path |
| `seed` | `ForkcastConfig` imported when empty |
| `adminCorsOrigins` | Origins allowed to call the admin API cross-origin (SDK endpoints always allow `*`) |
| `logger` | `(message) => void` |

## Security model

| Credential | Where it lives | What it can do |
| --- | --- | --- |
| **Client key** (`fc_prod_…`) | Frontend bundles, mobile apps, servers | Read that environment's config; send events. **Public.** |
| **Admin token** | Only you / your CI | Everything in the dashboard and admin API |

- Always set `--admin-token` when the server is reachable by anyone but you.
- Terminate HTTPS at a reverse proxy (nginx, Caddy, a cloud load balancer).
- The SDK config includes audience rules and forced user ids, because evaluation happens on the client. Do not put secrets in rules or payloads.
- Rotate a client key from **Environments & keys** if it is abused; apps using the old key fall back to `C` until redeployed.

## Storage

`JsonFileStorage` keeps everything in memory and writes one JSON file atomically (debounced 250 ms). It is ideal for side projects, internal tools and roughly up to 100k enrolled users per experiment. Beyond that, implement the `ForkcastStorage` interface for your database:

```ts
import type { ForkcastStorage } from 'forkcast/server';

class PostgresStorage implements ForkcastStorage {
  init() {}
  getEnvironments() {}
  saveEnvironments(envs) {}
  listExperiments() {}
  getExperiment(key) {}
  saveExperiment(exp) {}
  deleteExperiment(key) {}
  recordEvents(environment, events) {}     // exposures + track events
  getAssignments(environment, experiment) {} // one row per enrolled user
  getDaily(environment, experiment) {}
  getEventTotals(environment) {}
  resetResults(environment, experiment) {}
  addAudit(entry) {}
  listAudit(filter) {}
  close() {}
}
```

`MemoryStorage` in [`src/server/storage.ts`](../src/server/storage.ts) is the reference implementation, including how conversions are attributed to exposures.

## REST API

All responses are JSON. Admin endpoints need `Authorization: Bearer <adminToken>` when a token is configured. Send `x-forkcast-actor: <name>` to attribute changes in the audit log.

### SDK endpoints (public, CORS `*`)

| Method & path | Description |
| --- | --- |
| `GET /api/sdk/config` | Header `x-forkcast-key` or `?key=`. Returns `{ environment, version, experiments }` with only that environment's settings |
| `GET /api/sdk/stream?key=` | Server-Sent Events. Emits `event: config` immediately and on every change |
| `POST /api/sdk/events` | Body `{ clientKey, events: ForkcastEvent[] }` (≤ 1000 per request). Accepts `text/plain` for `sendBeacon` |

Event shapes:

```json
{ "type": "exposure", "experiment": "new-checkout", "variant": "T1", "userId": "u1", "ts": 1767225600000, "attributes": { "country": "IN" } }
{ "type": "track", "name": "purchase", "userId": "u1", "value": 49.99, "ts": 1767225660000 }
```

Timestamps older than 90 days or in the future are replaced with the receive time.

### Admin endpoints

| Method & path | Description |
| --- | --- |
| `GET /api/health` | `{ ok: true }` (no auth) |
| `GET /api/meta` | `{ name, authRequired }` (no auth) |
| `GET /api/environments` | Environments with client keys |
| `POST /api/environments/:env/rotate-key` | New client key |
| `GET /api/overview?env=` | KPI counts, 14-day series, top events |
| `GET /api/experiments?env=` | All experiments with result summaries |
| `POST /api/experiments` | Create. Body: `Experiment` (partial; defaults filled; starts off everywhere) |
| `GET /api/experiments/:key` | One experiment |
| `PUT /api/experiments/:key` | Update fields (merged; `environments` merged per environment) |
| `DELETE /api/experiments/:key` | Delete experiment and its data |
| `PATCH /api/experiments/:key/environments/:env` | `{ status?, traffic?, launchedVariant? }`: the one-click toggle |
| `POST /api/experiments/:key/archive` | `{ archived: boolean }` |
| `GET /api/experiments/:key/results?env=` | Full results (see `ExperimentResults` type) |
| `POST /api/experiments/:key/reset?env=` | Clear collected results |
| `GET /api/audit?experiment=&limit=` | Audit log, newest first |
| `GET /api/export` | `forkcast.config.json` |
| `POST /api/import` | Upsert experiments from a config |

Examples:

```bash
# Kill switch from a terminal or an incident runbook
curl -X PATCH https://flags.example.com/api/experiments/new-checkout/environments/production \
  -H "Authorization: Bearer $FORKCAST_ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'x-forkcast-actor: oncall' -d '{"status":"off"}'

# Ramp to 25%
curl -X PATCH .../environments/production -d '{"status":"running","traffic":25}' ...

# GitOps: apply the reviewed config from CI
curl -X POST https://flags.example.com/api/import -H "Authorization: Bearer $FORKCAST_ADMIN_TOKEN" \
  -H 'content-type: application/json' --data @forkcast.config.json
```

## Deploying

Any host that runs Node and has a persistent disk works (a VM, Fly.io, Render, Railway, a Docker container, an internal box).

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN npm install -g forkcast
VOLUME /data
ENV FORKCAST_DATA=/data/forkcast.json
EXPOSE 4400
CMD ["forkcast", "start"]
```

Run a single instance per data file: JSON storage is not designed for several writers.
