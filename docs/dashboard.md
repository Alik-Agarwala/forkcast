# Dashboard tour

Start the server (`npx forkcast start`) and open the printed URL. If the server has an admin token, the dashboard asks for it once and remembers it in this browser.

## Layout

- **Sidebar**: Experiments, Activity, Environments & keys, Docs. At the bottom: *Your name* (written to the audit log for every change you make) and the light/dark theme toggle.
- **Environment switcher** (top right): Development, Staging, Production. Every screen shows and edits the selected environment. Your choice is remembered.

## Experiments

- **KPI tiles**: running / launched / off counts, users enrolled, new enrolments per day for 14 days, events today.
- **Filters**: All, Running, Launched, Off, Archived, plus search by name, key or tag.
- **Table**, one row per experiment:
  - **On** switch: one click turns the experiment on (running) or off in the current environment. Connected apps update in about a second.
  - Name, key and type (A/B test or Flag).
  - Status pill and, for launched experiments, which treatment is served.
  - Traffic %, split bar (treatment weights), users, 14-day trend.
  - **Result**: Winner (with lift), Underperforming, No significant difference, Collecting data, Rolling out, or an SRM warning.

Click a row to open it. **New experiment** creates one.

## New experiment

1. Choose **A/B test** or **Feature flag**.
2. Name it; the key (used in code) is generated, and you can edit it.
3. Optional description, hypothesis and primary metric (event name sent with `track()`).
4. Treatments: presets `C / T1` or `C / T1 / T2`, or add your own with weights and JSON payloads.

New experiments start **off in every environment**.

## Experiment page

### Rollout card

- **Off / Running / Launched** control for the selected environment.
  - *Running* starts bucketing at the current traffic.
  - *Launched* asks which treatment everyone should get.
- **Kill switch**: turns it off immediately.
- **Traffic slider** with 1, 5, 10, 25, 50 and 100% presets.
- A table of the status in **every** environment, so you can see that it is at 100% in staging and 5% in production at a glance.

### Results tab

- **Verdict banner** in plain English.
- Users in the experiment and per treatment, with observed vs expected share.
- **Metrics table** (pick any metric): users, converted users, conversion rate, lift vs C, a 95% confidence interval bar around zero, p-value, value per user and a significance badge.
- **Users enrolled over time** (cumulative, hover for exact numbers).
- **Users by country**, split by treatment (hover for counts).
- **Sample ratio check** and **Reset results** (clears data for this environment; users keep their treatments).

Results refresh every 5 seconds.

### Setup tab

Name, owner, description, hypothesis, metrics, tags, treatments (keys, names, weights, payloads) and, under *Advanced*, the hashing salt. A warning appears if you change weights, because that moves users between treatments. The danger zone has **Archive** and **Delete**.

### Targeting tab

- **Audience**: conditions on user attributes (country, platform, plan, appVersion, email, or anything you pass), matched with *all* or *any*.
- **Forced users**: user ids pinned to each treatment, one per line.

### Integrate tab

Copy-paste snippets for React, JavaScript and Node, pre-filled with this experiment and the selected environment's client key, plus `?forkcast=key:T…` links to preview each treatment.

### History tab

Every change to this experiment.

## Activity

The global audit log: who changed what, when and in which environment, filterable by text.

## Environments & keys

- Client key per environment, with copy and **Rotate key**.
- Quick-start snippet using your real keys.
- **Export config** downloads `forkcast.config.json`; **Import config** uploads one (upsert by key).

## Developing the dashboard

```bash
npm run dev:server      # API on :4400
npm run dev:dashboard   # Vite dev server on :5174 with hot reload, proxying /api to :4400
```

Source lives in [`dashboard/src`](../dashboard/src). `npm run build` compiles it into `dist/dashboard`, which the server serves and which ships inside the npm package.
