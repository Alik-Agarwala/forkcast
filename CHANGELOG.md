# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
