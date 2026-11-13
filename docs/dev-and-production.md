# Development, QA and production

This guide shows how a feature moves from your laptop to 100% of production users with Forkcast.

## 1. Run Forkcast locally

```bash
npx forkcast start
```

Use the printed **Development** client key in your app. Alternatively, skip the server entirely while prototyping:

```ts
createForkcast({ config: { version: 1, experiments: [...] }, environment: 'development' });
```

## 2. Wire up the client once

```ts
// src/forkcast.ts
import { createForkcast } from 'forkcast';
import { mountDevtools } from 'forkcast/devtools';

export const forkcast = createForkcast({
  apiUrl: import.meta.env.VITE_FORKCAST_URL,      // http://localhost:4400 in dev
  clientKey: import.meta.env.VITE_FORKCAST_KEY,   // dev key in .env.development, prod key in .env.production
  devMode: import.meta.env.DEV,                   // or process.env.NODE_ENV !== 'production'
  user: { id: session.userId, country: session.country },
});

mountDevtools(forkcast); // no-op in production builds
```

```bash
# .env.development
VITE_FORKCAST_URL=http://localhost:4400
VITE_FORKCAST_KEY=fc_deve_xxxxxxxx

# .env.production
VITE_FORKCAST_URL=https://flags.example.com
VITE_FORKCAST_KEY=fc_prod_xxxxxxxx
```

Next.js: use `NEXT_PUBLIC_FORKCAST_URL` / `NEXT_PUBLIC_FORKCAST_KEY`. Create React App: `REACT_APP_…`. Node: plain `process.env`.

Python backends follow the same pattern. Pick the key from the environment and enable overrides only in development:

```python
forkcast = Forkcast(
    api_url=os.environ["FORKCAST_URL"],
    client_key=os.environ["FORKCAST_CLIENT_KEY"],   # dev key locally, prod key in production
    dev_mode=os.environ.get("APP_ENV") == "development",
)
```

See [python.md](python.md) for FastAPI, Flask and Django.

Client keys are public: they can only read config and send events for their environment. Never put the **admin token** in frontend code.

## 3. Build the feature behind a treatment

```tsx
<Experiment name="new-checkout">
  <Variant name="C"><ClassicCheckout /></Variant>
  <Variant name="T1"><OneClickCheckout /></Variant>
</Experiment>
```

Keep the `C` branch working: it is the fallback for everything.

## 4. Test every branch in development

Pick whichever is most convenient:

| Method | How |
| --- | --- |
| Dashboard | Development environment → set the experiment to *Running* or *Launched → T1* |
| URL | `http://localhost:5173/?forkcast=new-checkout:T1` |
| Devtools panel | Click **FC** in the corner, choose a treatment |
| Code | `forkcast.override('new-checkout', 'T1')` |
| Unit tests | `createForkcast({ config: [], overrides: { 'new-checkout': 'T1' }, devMode: true })` |

Overrides only work when `devMode` (or `allowOverrides`) is true, so they cannot leak into production.

## 5. QA in staging

- Set the experiment to *Running 100%* in **Staging**, or
- Add tester user ids to **Targeting → Forced users** so they always see `T1` (also works in production for dogfooding), or
- Ship a QA build with `allowOverrides: true` and share `?forkcast=` links.

## 6. Deploy with the experiment off

Deploy the code to production while the experiment is **off** in Production. Nothing changes for users. Deploying and releasing are now separate steps.

## 7. Ramp up in production

1. Turn it on at **1–5%** traffic. Watch errors, latency and the **SRM check**.
2. Increase to **10% → 25% → 50%**. Raising traffic only adds users; nobody switches treatment.
3. Wait for the planned sample size and duration (at least a week), then read the **verdict**.

Something wrong? Hit **Kill switch**. Every user gets `C` within seconds (realtime) or at the next poll (servers, 30s by default). No deploy, no rollback.

## 8. Decide

- **Winner**: click **Launched** and pick the treatment. Everyone gets it, no deploy required.
- **No difference or worse**: turn it off.

## 9. Clean up

Experiments are temporary. Once launched or turned off:

1. Remove the losing code path and the `getTreatment` call.
2. Deploy.
3. **Archive** the experiment in the dashboard (it then returns `C` everywhere; your history and results are kept).

Long-lived operational switches (maintenance mode, a dependency kill switch) can stay as permanent `flag`s.

## Hosting the Forkcast server in production

See [server.md](server.md). In short:

```bash
FORKCAST_ADMIN_TOKEN=$(openssl rand -hex 24) \
FORKCAST_DATA=/var/lib/forkcast/data.json \
npx forkcast start --port 4400
```

Put it behind HTTPS (any reverse proxy), keep the data file on a persistent volume, and back it up.

## What happens when…

| Situation | Result |
| --- | --- |
| Forkcast server is down at page load | `ready()` resolves, every experiment returns `C`, events queue and retry |
| Server goes down later | Last known config keeps working; realtime reconnects automatically |
| Experiment deleted while apps run | Apps receive the new config and return `C` |
| User clears `localStorage` | Anonymous users get a new id and may change treatment (logged-in ids are stable) |
| Same user on web and mobile | Same id → same treatment everywhere |
