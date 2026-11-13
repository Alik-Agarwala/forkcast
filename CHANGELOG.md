# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Python SDK** (`pip install forkcast-sdk`, `import forkcast`) for Python 3.9+, with no runtime dependencies. Local evaluation with bucketing, targeting and precedence identical to the JS SDK; background config polling or realtime SSE; batched exposures and `track()` events with retries; dev-only overrides; local config-as-code mode; fork-safe for gunicorn/uvicorn workers.
- Python framework integrations: `forkcast.integrations.fastapi` (`forkcast_dependency`, `forkcast_lifespan`) and `forkcast.integrations.flask` (`FlaskForkcast`, `current_forkcast`, a `forkcast` Jinja variable). `?forkcast=key:T1` overrides work when `dev_mode=True`.
- `npm run python:parity`: generates a JS → Python parity fixture so both SDKs are tested against each other.
- Examples: `examples/python-fastapi`, `examples/python-flask`.
- CI: Python 3.9–3.13 test matrix, end-to-end tests against the real server, and a PyPI trusted-publishing workflow (`publish-python.yml`).
- Docs: [docs/python.md](docs/python.md), plus Python sections in the README, testing, architecture and publishing guides.

## [0.1.0] - 2026-11-06

### Added

- Core SDK: deterministic MurmurHash3 bucketing, C/T1/T2 treatments with weights and payloads, per-environment off/running/launched status and traffic %, audience targeting with 17 operators, forced users, developer overrides, exposure and conversion tracking, realtime config over SSE with polling fallback, local config-as-code mode, `forUser()` for servers.
- React bindings: `ForkcastProvider`, `useTreatment`, `useVariant`, `useFlag`, `usePayload`, `useTrack`, `useForkcastReady`, `<Experiment>`, `<Variant>`, `<Feature>`.
- Devtools: floating override panel with shareable `?forkcast=` links.
- Server: REST API, SSE stream, JSON file and memory storage, pluggable storage interface, admin token, per-environment client keys, audit log, import/export.
- Statistics: two-proportion z-test, Welch test for value per user, 95% CI for lift, SRM chi-square check, automatic verdicts.
- Dashboard: experiments overview, one-click toggles, rollout controls with kill switch, results with charts and breakdowns, setup and targeting editors, integration snippets, activity log, environments and keys, light/dark themes.
- CLI: `forkcast start`, `forkcast init`, `forkcast validate`.
- Examples: demo shop, Node server, traffic simulator.
