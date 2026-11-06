# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, …) working in this repository. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md).

## What this project is

Forkcast is an npm package for self-hosted A/B testing and feature flags. One package ships:

- `forkcast`: universal SDK (`src/core`)
- `forkcast/react`: React bindings (`src/react`)
- `forkcast/devtools`: floating override panel (`src/devtools`)
- `forkcast/server`: Node HTTP server, storage, statistics (`src/server`)
- `forkcast` CLI binary (`src/cli`)
- a pre-built React dashboard (`dashboard/` → `dist/dashboard`)

Vocabulary: experiment, treatment/variant, `C` = control, `T1`/`T2` = treatments, traffic %, weights, environment (development/staging/production), status (`off`/`running`/`launched`), exposure, metric. Definitions: [docs/concepts.md](docs/concepts.md).

## Commands

```bash
npm install
npm run typecheck      # must pass
npm test               # must pass (vitest, ~5s)
npm run build          # must pass (tsup + vite)
npm run dev:server     # demo server on :4400 (seeded from examples/forkcast.demo.json)
npm run demo:shop      # demo app on :5173
npm run demo:simulate  # simulated traffic into the running server
```

Run `npm run typecheck && npm test` after every change. Run `npm run build` when touching exports, `tsup.config.ts`, `package.json` or the dashboard.

## Invariants (do not break)

1. **Bucketing is frozen.** Do not modify `murmur3`, `bucketOf`, `BUCKETS` (10,000), or the hash namespaces `${salt}:traffic` / `${salt}:variant` in `src/core/evaluate.ts`. Do not update the inline snapshots in `test/hash.test.ts`. Changing them reassigns every user in every live experiment.
2. **Evaluation precedence** in `evaluate()` is documented in its JSDoc, README and docs/concepts.md. Changing the order is a breaking change; update all three if a maintainer asks for it.
3. **Fail to `C`.** SDK reads must never throw; unknown, off, archived, unreachable → `C`.
4. **No runtime dependencies** in `package.json` `dependencies`. React stays an optional peer.
5. **`src/core` is universal**: no `node:*` imports, no unguarded `window`/`document`/`localStorage`.
6. **Overrides are dev-only by default** (`allowOverrides` defaults to `devMode`). Never default them on in production.
7. **Only `assigned` evaluations record exposures.** Forced, override, launched and off do not.
8. **Config format is backwards compatible.** New fields optional.
9. **Public API**: everything exported from `src/*/index.ts` is public. Removing or renaming an export is a breaking change.

## Conventions

- TypeScript strict, ESM source, 2-space indent, single quotes.
- Tests live in `test/<module>.test.ts(x)`; React/DOM tests start with `// @vitest-environment jsdom` and call `cleanup()` in `afterEach`.
- Server tests use a real server on port 0 with `dashboard: false`.
- Dashboard: tokens in `dashboard/src/styles.css` (light + dark), treatment colours via `variantColor()`, inline SVG charts in `dashboard/src/components/charts.tsx` (legend/direct labels, hover tooltip, aria-label required).
- Dashboard imports shared types from `../../src/...` with `import type` only.
- Conventional Commits (`feat(core): …`, `fix(server): …`). One logical change per commit.

## Where to make common changes

| Task | Files |
| --- | --- |
| New targeting operator | `src/core/types.ts` (`Operator`), `src/core/targeting.ts` (`OPERATORS`, `matchCondition`), `dashboard/src/pages/Setup.tsx` (`OPS`), `test/targeting.test.ts`, docs/concepts.md |
| New SDK option/method | `src/core/client.ts`, `test/client.test.ts`, docs/sdk.md, README if user-facing |
| New React hook/component | `src/react/index.tsx`, `test/react.test.tsx`, docs/sdk.md |
| New API endpoint | `src/server/server.ts` (`route`), `dashboard/src/api.ts`, `test/server.test.ts`, docs/server.md |
| New statistic / verdict | `src/server/stats.ts`, `test/stats.test.ts`, `dashboard/src/pages/Results.tsx`, docs/concepts.md |
| New storage adapter | implement `ForkcastStorage` from `src/server/storage.ts`; mirror `MemoryStorage` semantics |
| Dashboard page | `dashboard/src/pages/*`, route in `dashboard/src/App.tsx` |
| CLI flag | `src/cli/index.ts` (`HELP`, `start`), docs/server.md |

## Definition of done

- typecheck, tests and build pass
- new behaviour covered by tests
- docs updated (README and/or `docs/*.md`), `CHANGELOG.md` under *Unreleased*
- no new runtime dependencies, no invariant violated
