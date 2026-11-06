<div align="center">

# Forkcast

**Self-hosted A/B testing and feature flags for JavaScript.**
Ship code dark, flip it on with one click, roll out by percentage, target by country or anything else, and see which treatment wins, all from one npm package.

`npm install forkcast`

</div>

---

Forkcast is a feature-flag and experimentation tool in the spirit of the internal platforms big companies use (Amazon's *Weblab*, for example). Every experiment has a **control `C`** and one or more **treatments `T1`, `T2`, …**. Your code asks *"which treatment does this user get?"*, and the dashboard decides: off, on for 10% of users, on only in India, or launched to everyone.

```ts
const treatment = forkcast.getTreatment('new-checkout'); // 'C' | 'T1' | 'T2'
```

## Contents

- [Why Forkcast](#why-forkcast)
- [Features](#features)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Core concepts](#core-concepts)
- [Using the SDK](#using-the-sdk)
- [Development vs production](#development-vs-production)
- [The dashboard](#the-dashboard)
- [Where it runs](#where-it-runs)
- [Try the full demo locally](#try-the-full-demo-locally)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [Documentation index](#documentation-index)

## Why Forkcast

- **One package, no SaaS account.** The SDK, React bindings, server, CLI and dashboard all ship in `forkcast`. Run `npx forkcast start` and you have a working experimentation platform.
- **Safe by default.** Anything unknown, off, archived or unreachable returns `C`. A broken network never breaks your app.
- **Instant changes.** Toggles in the dashboard reach connected browsers and servers in about a second, over Server-Sent Events.
- **Statistics built in.** Conversion rates, lift with confidence intervals, p-values, a sample-ratio-mismatch check and a plain-English verdict.
- **Config as code.** Export everything to `forkcast.config.json`, review it in pull requests, or evaluate fully offline without a server.

## Features

| Area | What you get |
| --- | --- |
| **Treatments** | `C` control plus any number of treatments (`T1`, `T2`, …), each with a weight and an optional JSON payload |
| **Rollout** | Per-environment status (`off` / `running` / `launched`) and traffic %, one-click kill switch, launch a winner to 100% |
| **Bucketing** | Deterministic MurmurHash3 into 10,000 buckets (0.01% steps). Sticky per user. Raising traffic never reshuffles existing users |
| **Targeting** | 17 operators: `eq`, `in`, `contains`, `regex`, `gt`, `semverGte`, … over any user attribute (country, plan, app version, email, nested paths) |
| **QA** | Forced user lists, `?forkcast=new-checkout:T1` URL overrides, a floating devtools panel, overrides disabled in production |
| **Environments** | Development, staging and production, each with its own public client key |
| **Analytics** | Exposures, conversions and revenue per treatment, lift ± 95% CI, p-values, SRM check, daily enrolment, country breakdown |
| **Dashboard** | Clean, real-time UI with light and dark themes, audit log, targeting editor, code snippets |
| **SDKs** | Vanilla JS/TS, React hooks + components, Node server-side evaluation (`forUser`) |
| **Self-hosting** | Standalone server or mount into Express; JSON-file storage out of the box; pluggable storage adapter interface |

## Quick start (5 minutes)

### 1. Start the server and dashboard

```bash
npx forkcast start
```

This starts the API and dashboard on <http://localhost:4400> and stores data in `.forkcast/data.json`. The terminal prints one **client key** per environment.

### 2. Create an experiment

Open <http://localhost:4400>, click **New experiment**, name it `new-checkout`, keep `C / T1`, and create it. It starts **off** everywhere, so creating it changes nothing for users. Flip the switch in **Development**.

### 3. Use it in your app

```bash
npm install forkcast
```

```ts
import { createForkcast } from 'forkcast';

const forkcast = createForkcast({
  apiUrl: 'http://localhost:4400',
  clientKey: 'fc_deve_...', // development key from step 1
  user: { id: currentUser.id, country: currentUser.country },
});

await forkcast.ready();

if (forkcast.getTreatment('new-checkout') === 'T1') {
  renderOneClickCheckout();
} else {
  renderClassicCheckout(); // C: also what everyone gets if anything goes wrong
}

// Measure it
forkcast.track('purchase', { value: 49.99 });
```

### 4. Watch the results

Results appear on the experiment page as users arrive: users per treatment, conversion rate, lift and significance.

## Core concepts

| Term | Meaning |
| --- | --- |
| **Experiment** | A named switch in your code, like `new-checkout`. Type `experiment` (A/B/n test) or `flag` (on/off rollout). |
| **`C` (control)** | Today's behaviour. Returned when the experiment is off, missing, archived, the user is not targeted, or the server is unreachable. |
| **`T1`, `T2`, …** | Treatments: the new behaviours you are testing. For flags, `T1` means "on". |
| **Weights** | How users *inside* the experiment are split, e.g. `C 50 / T1 50`. |
| **Traffic** | What % of eligible users enter the experiment at all. The rest get `C` and are **not** counted in results. |
| **Status** | Per environment: `off` (everyone gets C; this is the kill switch), `running` (bucketing and measuring), `launched` (everyone gets one chosen treatment). |
| **Audience** | Targeting rules on user attributes. Non-matching users get `C`. |
| **Exposure** | Recorded the first time a bucketed user reads their treatment. This is the denominator of every result. |
| **Metric** | An event name you send with `track()`. The first metric on an experiment is the primary one. |

How a decision is made, first match wins:

```
experiment missing / archived ──────────────► C
developer override (dev builds only) ───────► that treatment
status off in this environment ─────────────► C           (kill switch)
status launched ────────────────────────────► launchedVariant for everyone
user id in a forced list ───────────────────► that treatment (QA)
audience rules don't match ─────────────────► C
outside traffic % ──────────────────────────► C
otherwise ──────────────────────────────────► weighted random, sticky per user  ← counted in results
```

Read more in [docs/concepts.md](docs/concepts.md).

## Using the SDK

### JavaScript / TypeScript

```ts
import { createForkcast } from 'forkcast';

const forkcast = createForkcast({ apiUrl, clientKey, user: { id: 'u_123', country: 'IN', plan: 'pro' } });

forkcast.getTreatment('new-checkout');              // 'C' | 'T1' | 'T2'
forkcast.isEnabled('dark-mode');                    // true when not C
forkcast.getPayload<{ headline: string }>('hero');  // JSON payload of the user's treatment
forkcast.getVariant('new-checkout');                // { variant, payload, reason, inExperiment }
forkcast.track('purchase', { value: 49.99 });       // conversion event
forkcast.setUser({ id: 'u_456', country: 'US' });   // e.g. after login
forkcast.subscribe(() => rerender());               // config / user / override changes
```

### React

```tsx
import { ForkcastProvider, Experiment, Variant, Feature, useTreatment, useTrack } from 'forkcast/react';

<ForkcastProvider client={forkcast}>
  <App />
</ForkcastProvider>

<Experiment name="new-checkout">
  <Variant name="C"><ClassicCheckout /></Variant>
  <Variant name="T1"><OneClickCheckout /></Variant>
</Experiment>

<Feature flag="dark-mode" fallback={<LightTheme />}><DarkTheme /></Feature>

const treatment = useTreatment('new-checkout');
const track = useTrack();
```

### Node.js (server-side)

```ts
const forkcast = createForkcast({ apiUrl, clientKey: process.env.FORKCAST_CLIENT_KEY });
await forkcast.ready(); // once at startup; config then stays in sync

app.get('/checkout', (req, res) => {
  const fc = forkcast.forUser({ id: req.user.id, country: req.headers['cf-ipcountry'] });
  res.render(fc.getTreatment('new-checkout') === 'T1' ? 'checkout-v2' : 'checkout');
});
```

### Without a server (config as code)

```ts
import config from './forkcast.config.json';
const forkcast = createForkcast({ config, environment: 'production', user: { id } });
```

Full reference: [docs/sdk.md](docs/sdk.md).

## Development vs production

| | Development (`npm run dev`) | Production build |
| --- | --- | --- |
| Client key | development key | production key |
| `devMode` | `true` (auto-detected from `NODE_ENV` or `localhost`) | `false` |
| Overrides (`?forkcast=key:T1`, devtools, `override()`) | **enabled** | **ignored** unless `allowOverrides: true` |
| Devtools panel | `mountDevtools(forkcast)` shows a floating panel | does not mount |
| Debug logs | on | off |
| Experiment state | its own on/off/traffic per experiment | its own on/off/traffic per experiment |

Recommended setup (Vite shown; use `process.env.NODE_ENV` elsewhere):

```ts
import { createForkcast } from 'forkcast';
import { mountDevtools } from 'forkcast/devtools';

export const forkcast = createForkcast({
  apiUrl: import.meta.env.VITE_FORKCAST_URL,
  clientKey: import.meta.env.VITE_FORKCAST_KEY, // dev key in .env.development, prod key in .env.production
  devMode: import.meta.env.DEV,
  user: { id: user.id, country: user.country },
});

mountDevtools(forkcast); // no-op in production builds
```

Typical lifecycle of a feature:

1. **Build** it behind `getTreatment('my-feature')`. Merge and deploy with the experiment **off** in production.
2. **Test** in development: turn it on, or force `?forkcast=my-feature:T1`.
3. **QA** in staging: run at 100% or add testers to the forced list.
4. **Ramp** in production: 1% → 10% → 50%, watching results and the SRM check.
5. **Decide**: *Launch* the winner (everyone gets it) or hit the *kill switch* (everyone gets `C`), with no deploy.
6. **Clean up**: remove the old code path, then archive the experiment.

Details: [docs/dev-and-production.md](docs/dev-and-production.md).

## The dashboard

Run `npx forkcast start` and open the printed URL.

- **Experiments**: KPI tiles, a one-click on/off switch per row, traffic, split preview, 14-day trend and a verdict badge.
- **Experiment page**: off / running / launched control, traffic slider with 1–100% presets, kill switch, status across all environments, then tabs for **Results**, **Setup**, **Targeting**, **Integrate** (copy-paste snippets and QA links) and **History**.
- **Activity**: an audit log of every change, who made it and in which environment.
- **Environments & keys**: client keys, key rotation, config export and import.

Protect it in production with `--admin-token` (or `FORKCAST_ADMIN_TOKEN`). See [docs/dashboard.md](docs/dashboard.md).

## Where it runs

Forkcast is plain ESM + CommonJS with zero runtime dependencies, so it works anywhere npm packages run:

| Runtime | Notes |
| --- | --- |
| Browsers (React, Vue, Svelte, Angular, vanilla) via Vite, webpack, Next.js, Remix… | Realtime via EventSource; anonymous ids persisted in `localStorage` |
| Next.js / Remix / SSR | Evaluate on the server with `forUser()`, pass `bootstrap` to the client to avoid flicker |
| Node.js ≥ 18 (Express, Fastify, NestJS, Koa) | `forUser()` per request; the server can also be mounted into your app |
| Bun, Deno (`npm:forkcast`) | Same API |
| Edge / Workers (Cloudflare, Vercel Edge) | Use `realtime: false` with polling, or local `config` mode |
| React Native / Expo | Pass `user.id` explicitly (no `localStorage`); polling instead of SSE |

## Try the full demo locally

The repository includes a demo coffee shop, seeded experiments and a traffic simulator.

```bash
git clone https://github.com/alikagarwala/forkcast.git
cd forkcast
npm install
npm run build              # builds the library + dashboard
```

```bash
npm run dev:server         # terminal 1: API + dashboard on http://localhost:4400 with demo experiments
```

```bash
npm run demo:shop          # terminal 2: demo shop on http://localhost:5173
```

```bash
npm run demo:simulate                              # terminal 3: 4,000 simulated users in development
npm run demo:simulate -- --key fc_prod_demo_key    # and production
```

Then try:

1. Open the shop with `?user=alice&country=IN`. The **What this user sees** card shows each treatment and *why*.
2. In the dashboard, turn **dark-mode** off in Development. The shop switches theme within a second, without reloading.
3. Click the **FC** button in the shop's corner and force `new-checkout` to `T1`: the buttons become *Buy now · 1-click*.
4. Change the country to `BR`: `new-checkout` drops to `C (not targeted)` because its audience is US/IN/GB/DE/CA.
5. Open **New checkout flow** in the dashboard to see the winner, lift and confidence intervals from the simulated traffic.
6. Hit **Kill switch** and watch every shopper fall back to `C`.

## Testing

```bash
npm test             # 79 unit + integration tests (vitest)
npm run typecheck    # strict TypeScript across library, dashboard and examples
npm run build        # library (ESM + CJS + .d.ts) and dashboard
```

What the tests cover:

- `test/hash.test.ts`: reference MurmurHash3 vectors, pinned buckets, uniform distribution
- `test/evaluate.test.ts`: precedence order, stickiness, weights, traffic ramping, targeting, forced users, overrides
- `test/targeting.test.ts`: every operator
- `test/client.test.ts`: local and remote modes, exposure dedupe, batching, offline fallback
- `test/stats.test.ts`: z-test, chi-square, SRM, verdicts, timeseries
- `test/server.test.ts`: the real HTTP server end to end: auth, CRUD, toggles, audit, import/export, SDK round trip, SSE
- `test/react.test.tsx`: hooks, components and the devtools panel in jsdom

To check the package exactly as users receive it:

```bash
npm pack                               # creates forkcast-0.1.0.tgz
mkdir /tmp/try && cd /tmp/try && npm init -y
npm install /path/to/forkcast-0.1.0.tgz
npx forkcast start --memory
```

More: [docs/testing.md](docs/testing.md).

## Project structure

```
src/
  core/        SDK: types, hashing, targeting, evaluation, validation, client   → forkcast
  react/       Provider, hooks, <Experiment>/<Variant>/<Feature>               → forkcast/react
  devtools/    Floating override panel (vanilla DOM, shadow root)              → forkcast/devtools
  server/      HTTP API, SSE, storage adapters, statistics                     → forkcast/server
  cli/         `forkcast start | init | validate`                              → bin
dashboard/     React + Vite SPA, compiled into dist/dashboard and served by the server
examples/      demo-shop (React), node-server, forkcast.demo.json seed
scripts/       simulate.ts traffic generator
test/          vitest suites
docs/          guides and references
```

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). If you use an AI coding agent, point it at [AGENTS.md](AGENTS.md), which lists the commands, conventions and invariants (for example: never change the hashing algorithm).

## Roadmap

- Postgres / SQLite / Redis storage adapters
- Mutually exclusive experiment layers
- Scheduled ramps (for example 10% → 50% → 100% over a week)
- Sequential testing / CUPED variance reduction
- SSO and roles for the dashboard
- Webhooks and Slack notifications on status changes
- SDKs for other languages using the same hashing spec

## Documentation index

| Doc | For |
| --- | --- |
| [docs/concepts.md](docs/concepts.md) | How bucketing, traffic, targeting and statistics work |
| [docs/sdk.md](docs/sdk.md) | Full JavaScript, React, devtools and Node API |
| [docs/dev-and-production.md](docs/dev-and-production.md) | Local development, QA, deployment and rollout playbook |
| [docs/server.md](docs/server.md) | Self-hosting, CLI flags, REST API, storage adapters, security |
| [docs/dashboard.md](docs/dashboard.md) | Tour of every dashboard screen |
| [docs/architecture.md](docs/architecture.md) | How the pieces fit together, data model, design decisions |
| [docs/testing.md](docs/testing.md) | Running and writing tests |
| [docs/publishing.md](docs/publishing.md) | Releasing new versions to npm |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, conventions, pull requests |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents working in this repo |

## License

[MIT](LICENSE) © Alik Agarwala
