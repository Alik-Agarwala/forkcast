# Contributing to Forkcast

Thanks for helping! This guide gets you from clone to pull request.

## Setup

Requirements: **Node.js 22+** for development (Vite, Vitest and tsup need it) and npm. The published package itself runs on Node 18+, which CI checks with `scripts/smoke.mjs`.

```bash
git clone https://github.com/Alik-Agarwala/forkcast.git
cd forkcast
npm install
npm test
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm test` / `npm run test:watch` | Run the vitest suites |
| `npm run typecheck` | Strict TypeScript over everything |
| `npm run build` | Library (tsup) + dashboard (Vite) into `dist/` |
| `npm run dev:server` | Server on :4400 with the demo seed (`examples/forkcast.demo.json`), data in `.forkcast/dev.json` |
| `npm run dev:dashboard` | Dashboard with hot reload on :5174 (needs `dev:server`) |
| `npm run demo:shop` | Demo shop on :5173 (needs `dev:server`) |
| `npm run demo:simulate` | Send simulated traffic (`-- --key fc_prod_demo_key --users 9000`) |
| `node scripts/smoke.mjs` | Smoke-test the built `dist/` (run after `npm run build`) |

Delete `.forkcast/` to start from a clean demo.

### Python SDK

The Python SDK lives in `python/` and needs **Python 3.10+**. Work in a virtual environment so its tools stay out of your system Python:

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest
```

| Command (in `python/`) | What it does |
| --- | --- |
| `pytest` | All Python suites. `tests/test_e2e.py` also needs `npm run build:lib` in the repo root, otherwise it is skipped |
| `ruff check . && ruff format --check .` | Lint and formatting |
| `mypy` | Strict type checking |
| `python -m build` | Build the wheel and sdist into `python/dist/` |
| `npm run python:parity` (repo root) | Regenerate the JS → Python parity fixture |

## Where things live

See [docs/architecture.md](docs/architecture.md#source-map) for the full source map. Quick version:

- `src/core`: the SDK (runs everywhere; **no Node-only APIs here**)
- `src/react`, `src/devtools`: browser bindings
- `src/server`, `src/cli`: Node-only
- `dashboard/src`: React SPA
- `test/`: one suite per module
- `python/src/forkcast`: the Python SDK (`hashing`, `targeting`, `evaluate` mirror `src/core`; `client` and `integrations/` are Python-specific)
- `python/tests`: pytest suites and the parity fixture

## Rules of the road

1. **Never change bucketing.** `src/core/hash.ts` and the hash namespaces in `evaluate.ts` (`<salt>:traffic`, `<salt>:variant`) decide which users get which treatment. Changing them reassigns every live user. The pinned snapshots in `test/hash.test.ts` must not be updated.
2. **Keep the SDKs in lockstep.** A change to targeting or evaluation in `src/core` must be made in `python/src/forkcast` in the same pull request. Then run `npm run python:parity` and commit the regenerated fixture. `python/tests/test_parity.py` fails if the two disagree.
3. **`C` is the safe fallback.** Any new failure path in the SDK must resolve to `C`, never throw from `getTreatment`.
4. **Zero runtime dependencies** in `src/` and in the Python package (`dependencies = []`; FastAPI and Flask are optional extras imported only by `forkcast.integrations`). Dev dependencies are fine. The dashboard is bundled at build time.
5. **Keep `src/core` universal**: no `node:*` imports, guard browser globals (`globalThis.localStorage` etc.).
6. **Backwards-compatible config.** New fields must be optional with sensible defaults.
7. **Tests with every change.** Bug fix → a test that fails before the fix. Feature → tests for the behaviour.
8. **Docs with every user-facing change**: README and the relevant file in `docs/`.

## Code style

- TypeScript strict mode; avoid `any` (use `unknown` and narrow).
- Small pure functions where possible (`evaluate`, `computeResults`).
- Prettier-compatible formatting: 2 spaces, single quotes, trailing commas, ~140 columns.
- Comments explain *why*, not *what*.
- Python: type hints everywhere (`mypy --strict` passes), snake_case API, stdlib only, Python 3.10+, `ruff format` (120 columns).
- Dashboard: CSS custom properties in `dashboard/src/styles.css`, no CSS frameworks. Colours for treatments come from `variantColor()` (fixed by position, never by rank). Every chart needs a legend or direct labels, a hover tooltip and an `aria-label`.

## Commits and pull requests

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add semverGte operator
fix(server): keep audit order stable
docs: explain traffic vs weights
test(stats): cover SRM with three variants
chore: bump vitest
```

Scopes: `core`, `react`, `devtools`, `server`, `stats`, `cli`, `dashboard`, `python`, `examples`, `docs`, `ci`.

Pull request checklist:

- [ ] `npm run typecheck && npm test && npm run build` pass
- [ ] Python changes: `pytest`, `ruff check .` and `mypy` pass in `python/`
- [ ] Tests added or updated
- [ ] Docs updated for user-facing changes
- [ ] `CHANGELOG.md` entry under *Unreleased*
- [ ] Screenshots for dashboard changes (light and dark)

## Reporting bugs and proposing features

Open an issue using the templates. For bugs include the Forkcast version, runtime (browser / Node version, or Python version and framework), the experiment config (redact secrets) and what `forkcast.getVariant('<key>')` returns, since its `reason` field usually explains the behaviour.

## Releasing

Maintainers: see [docs/publishing.md](docs/publishing.md).
