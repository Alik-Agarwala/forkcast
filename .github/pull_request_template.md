## What and why

<!-- What does this change and why is it needed? Link issues with "Closes #123". -->

## How was it tested?

<!-- Commands run, new tests, screenshots for dashboard changes (light and dark). -->

## Checklist

- [ ] `npm run typecheck && npm test && npm run build` pass
- [ ] Python touched: `pytest`, `ruff check .` and `mypy` pass in `python/` (and `npm run python:parity` re-run if evaluation changed)
- [ ] Tests added or updated
- [ ] Docs updated (README / docs/*) for user-facing changes
- [ ] CHANGELOG.md entry under Unreleased
- [ ] Bucketing (`src/core/hash.ts`, `python/src/forkcast/hashing.py`, hash namespaces) unchanged
