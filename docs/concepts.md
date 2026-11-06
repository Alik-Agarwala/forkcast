# Concepts

This page explains how Forkcast decides what a user sees and how it measures the result. If you only read one doc after the README, read this one.

## Experiments, treatments and the control

An **experiment** is a named decision point in your code:

```ts
const t = forkcast.getTreatment('new-checkout');
```

Every experiment has a list of **treatments** (also called variants). One of them is always **`C`, the control**: the behaviour your app has today. The others are **`T1`, `T2`, …**, the new behaviours.

`C` is special. It is what the SDK returns whenever it cannot or should not make a decision:

- the experiment does not exist or is archived
- it is `off` in the current environment
- the user does not match the audience, or falls outside the traffic %
- the config has not loaded yet, or the server is unreachable

So the rule for your code is simple: **the `C` branch must always be safe**.

There are two experiment types. They behave identically; the type only changes defaults and wording in the dashboard.

| Type | Use it for | Default treatments |
| --- | --- | --- |
| `experiment` | Measuring which version is better | `C 50 / T1 50` |
| `flag` | Shipping dark, gradual rollout, kill switch | `C 0 / T1 100` (T1 = on) |

## Environments and status

Each experiment has independent settings per environment (`development`, `staging`, `production` by default):

| Status | Who gets what | Counted in results? |
| --- | --- | --- |
| `off` | Everyone gets `C`. This is the kill switch. | No |
| `running` | Users are bucketed by traffic % and weights. | Yes, for users that are randomly bucketed |
| `launched` | Everyone gets `launchedVariant`. | No |

The SDK learns its environment from the client key it uses, so the same code ships to every environment; only the key changes.

## Traffic and weights

Two numbers control allocation, and they do different jobs:

- **Traffic** (0–100%, per environment): what fraction of eligible users *enter* the experiment.
- **Weights** (per treatment): how users *inside* the experiment are split.

Example: traffic 20%, weights `C 50 / T1 50`. Out of 1,000 eligible users, ~200 enter: ~100 get `C`, ~100 get `T1`. The other ~800 also get `C`, but they are not part of the experiment and are not counted. This keeps the comparison fair: the in-experiment `C` group is the true control for `T1`.

Use **traffic** to ramp up (1% → 10% → 50% → 100%). Avoid changing **weights** on a running experiment, because that moves some users between treatments.

## Bucketing

Forkcast uses deterministic hashing, so no assignment needs to be stored to be sticky:

```
trafficBucket = murmur3("<salt>:traffic:<userId>") % 10000
variantBucket = murmur3("<salt>:variant:<userId>") % 10000
```

- `salt` defaults to the experiment key.
- 10,000 buckets give 0.01% granularity.
- The user enters if `trafficBucket < traffic × 100`.
- The treatment is picked by walking the cumulative weights with `variantBucket`.

Because the two hashes are **independent**:

- the same user always gets the same treatment, on every device and server that sees the same user id
- raising traffic only *adds* users; nobody already in the experiment changes treatment
- different experiments are uncorrelated (different salts)

Changing the salt re-randomises everyone. Only do it to restart an experiment from scratch.

> **Invariant:** the hashing algorithm and bucket count must never change. A change would silently reassign every user in every live experiment. `test/hash.test.ts` pins known outputs to prevent accidents.

## User identity

Bucketing needs a stable `user.id`:

- Logged-in users: pass your user id.
- Anonymous visitors in browsers: if you omit `id`, the SDK generates a random id and stores it in `localStorage` (`forkcast:anonId`).
- Servers / React Native: always pass an id (session id, device id, account id).

When an anonymous user logs in, call `forkcast.setUser({ id: realId, ... })`. They may land in a different treatment; that is expected with id-based bucketing.

## Targeting

An **audience** is a list of conditions on user attributes, combined with `all` (AND) or `any` (OR):

```json
{
  "match": "all",
  "conditions": [
    { "attribute": "country", "operator": "in", "value": ["US", "IN"] },
    { "attribute": "appVersion", "operator": "semverGte", "value": "2.4.0" }
  ]
}
```

| Operator | Meaning |
| --- | --- |
| `eq`, `neq` | equals / not equals (case-insensitive for strings) |
| `in`, `notIn` | value is / is not in a list (array or comma-separated string) |
| `contains`, `notContains` | substring, or membership if the attribute is an array |
| `startsWith`, `endsWith` | string prefix / suffix |
| `gt`, `gte`, `lt`, `lte` | numeric comparison |
| `regex` | case-insensitive regular expression |
| `semverGte`, `semverLt` | version comparison (`2.10.0 > 2.9.9`) |
| `exists`, `notExists` | attribute is set / not set |

Attributes can be nested with dot paths (`account.tier`). Negative operators (`neq`, `notIn`, `notContains`) match when the attribute is missing.

**Location-based targeting**: pass `country` (or `region`, `city`) on the user context. Forkcast does not geolocate IPs itself; use what your stack already has (Cloudflare `cf-ipcountry`, Vercel `x-vercel-ip-country`, CloudFront `CloudFront-Viewer-Country`, or your user profile).

## Forced users and overrides

Two ways to see a specific treatment without randomisation:

| | Forced users | Overrides |
| --- | --- | --- |
| Configured in | Dashboard → Targeting | Device: URL `?forkcast=key:T1`, devtools panel, `override()` |
| Applies to | Those user ids, on every device | This browser only |
| Works in production | Yes (still respects `off`) | Only with `allowOverrides: true` |
| Counted in results | No | No |
| Typical use | QA accounts, dogfooding, demos | Developers checking each branch |

## Exposures and metrics

An **exposure** is recorded the first time a randomly bucketed user reads their treatment (`getTreatment`, `useTreatment`, `<Experiment>`…). Only `assigned` decisions create exposures: not `off`, `launched`, `forced`, `override` or out-of-traffic users.

Read the treatment **where the user actually experiences it**. If you call `getTreatment` for every experiment on app start, everyone is "exposed" to everything, which dilutes results. Use `peek()` when you need the value without recording an exposure.

A **metric** is any event name sent with `track(name, { value })`. A conversion counts for an experiment if it happens *after* that user's first exposure. Users are analysed in the treatment they were first exposed to (intention-to-treat).

## Statistics

For each metric and treatment the server computes:

- **Conversion rate**: users with ≥ 1 event / exposed users.
- **Lift**: relative difference vs `C`, `(rate_T − rate_C) / rate_C`.
- **95% confidence interval** of the lift (normal approximation).
- **p-value**: two-sided two-proportion z-test vs `C`.
- **Value per user**: summed `value` / exposed users, compared with Welch's t-test.
- **Significant**: p < 0.05 **and** at least 100 users in both groups.

The **verdict** summarises the primary metric:

| Verdict | Meaning |
| --- | --- |
| Collecting data | A treatment has fewer than 100 users |
| Winner | At least one treatment is significantly better than C (the best one is named) |
| Underperforming | Every treatment is significantly worse than C |
| No significant difference | Enough data, no clear effect yet |
| Rolling out | `C` has weight 0, so there is no control group to compare against |
| Sample ratio mismatch | See below; fix this before trusting anything else |

### Sample Ratio Mismatch (SRM)

If weights are 50/50 but you observe 55/45 with thousands of users, something is broken: a redirect that loses users in one branch, caching, bots, or exposure logging that only fires in one treatment. Forkcast runs a chi-square goodness-of-fit test on observed vs expected counts and flags p < 0.001. When SRM fails, the results are not trustworthy, even if they look significant.

### Good practice

- Decide the primary metric and minimum runtime **before** starting. Run at least one full week to cover weekday/weekend patterns.
- Do not stop the moment p < 0.05. Repeatedly checking inflates false positives; let the experiment reach its planned size.
- Keep experiments small and focused: one hypothesis each.
