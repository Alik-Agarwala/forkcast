# Testing

## Commands

```bash
npm test                 # all suites once
npm run test:watch       # watch mode
npx vitest run test/evaluate.test.ts   # one file
npm run typecheck        # tsc --noEmit over src, dashboard, examples, scripts, tests
npm run build            # must succeed before publishing
```

Python SDK, from `python/`:

```bash
pip install -e ".[dev]"  # once
pytest                   # all Python suites
ruff check . && ruff format --check . && mypy
```

## Suites

| File | Covers | Environment |
| --- | --- | --- |
| `test/hash.test.ts` | MurmurHash3 reference vectors, pinned buckets, uniformity | node |
| `test/targeting.test.ts` | Every operator, `all` / `any`, semver | node |
| `test/evaluate.test.ts` | Precedence chain, stickiness, weights, traffic ramping, targeting, forced users, overrides | node |
| `test/validate.test.ts` | Validation messages, normalisation, slugify | node |
| `test/client.test.ts` | Local and remote mode with mocked fetch, exposure dedupe, offline fallback | node |
| `test/stats.test.ts` | Normal CDF, chi-square, z-test, SRM, verdicts, timeseries | node |
| `test/server.test.ts` | Real HTTP server on a random port: auth, CRUD, env toggles, audit, import/export, SDK round trip, SSE push, JSON persistence | node |
| `test/react.test.tsx` | Hooks, `<Experiment>`, `<Feature>`, devtools panel | jsdom (`// @vitest-environment jsdom`) |

## Python SDK

| File | Covers |
| --- | --- |
| `python/tests/test_parity.py` | Replays `python/tests/fixtures/parity.json`: MurmurHash3 vectors, buckets for 1,000+ ids, 1,700+ targeting cases (including JavaScript's `String()` / `Number()` coercions), semver, every evaluation reason for 400 users × 17 experiments, variant boundaries for every bucket |
| `python/tests/test_core.py` | Pinned hashes, JS value semantics, attribute paths, weight distribution, monotonic traffic ramping, fail-to-`C` |
| `python/tests/test_client.py` | Local and remote mode against an in-process fake server: exposure dedupe, batching, retries, unreachable server, bootstrap, polling, realtime SSE, overrides, `fork()` safety |
| `python/tests/test_integrations.py` | FastAPI dependency and lifespan, Flask extension, `current_forkcast`, Jinja, dev-only overrides |
| `python/tests/test_e2e.py` | The real Node server: Python and JS SDKs assign identical treatments, kill switch reaches Python, Python events appear in results. Skipped if `dist/` is not built |

The parity fixture is generated from the JavaScript core. After changing targeting or evaluation (in both SDKs), regenerate and commit it:

```bash
npm run python:parity            # writes python/tests/fixtures/parity.json
npm run python:parity -- --check # CI: fails if the committed fixture is stale
```

Never edit the fixture by hand, and never "fix" a parity failure by regenerating it after changing only one SDK.

## Writing tests

- Prefer testing pure functions (`evaluate`, `computeResults`, `matchCondition`) directly.
- Statistical assertions use large samples (≥ 20,000 users) and tolerances, never exact counts, except for pinned hashes.
- Server tests start a real server with `listen(0, '127.0.0.1')` and talk to it with `fetch`. Use `dashboard: false` and an in-memory or temp-dir storage.
- React tests need `afterEach(cleanup)` because globals are disabled.
- If you change behaviour, add a test that fails without your change.

## The hashing guard

`test/hash.test.ts` (and `test_hash_is_frozen` in `python/tests/test_core.py`) contains pinned bucket values. If they fail, you changed bucketing, which would reassign every user of every live experiment. Revert the change. Do not update the snapshot unless the project has explicitly decided to ship a breaking major version with a migration plan.

## Manual end-to-end test

```bash
npm run build
npm run dev:server        # seeded demo on :4400
npm run demo:shop         # :5173
npm run demo:simulate     # traffic
```

Checklist:

- [ ] Dashboard lists five demo experiments with results for `new-checkout` and `hero-headline`
- [ ] Toggling `dark-mode` in Development changes the shop's theme within ~1s without reload
- [ ] `?forkcast=new-checkout:T1` shows the *Buy now · 1-click* buttons; `?forkcast=reset` clears it
- [ ] Devtools panel lists every experiment with the reason
- [ ] Country `BR` makes `new-checkout` show `not targeted`
- [ ] Kill switch sends every shopper to `C`
- [ ] Activity shows each change with your name
- [ ] Restarting the server keeps all data (`.forkcast/dev.json`)
- [ ] `examples/python-fastapi` and `examples/python-flask` show the same treatments as the shop for the same `?user=`, and follow the kill switch within ~1s

## Testing the published artifact

```bash
npm pack
mkdir -p /tmp/forkcast-try && cd /tmp/forkcast-try && npm init -y
npm install /path/to/forkcast/forkcast-0.1.0.tgz react
node -e "console.log(typeof require('forkcast').createForkcast)"
node --input-type=module -e "import('forkcast/react').then(m => console.log(typeof m.useTreatment))"
npx forkcast start --memory
```
