/**
 * Traffic simulator: sends realistic exposures + conversions to a running
 * Forkcast server so you can see the dashboard with data.
 *
 *   npm run dev:server                                   # terminal 1
 *   npm run demo:simulate                                # terminal 2 (development env)
 *   npm run demo:simulate -- --key fc_prod_demo_key      # production env
 *
 * Options: --url http://localhost:4400  --key <clientKey>  --users 4000  --days 14
 *
 * It uses the real evaluation engine, so who-gets-what is exactly what the SDK would do.
 */
import { evaluate } from '../src/core/evaluate';
import type { Experiment, ForkcastEvent } from '../src/core/types';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const url = String(args.url ?? 'http://localhost:4400').replace(/\/$/, '');
const key = String(args.key ?? 'fc_dev_demo_key');
const userCount = Number(args.users ?? 4000);
const days = Number(args.days ?? 14);

/** Conversion probability per experiment / treatment / event. Unlisted = baseline. */
const EFFECTS: Record<string, Record<string, Record<string, number>>> = {
  'new-checkout': {
    C: { purchase: 0.08, add_to_cart: 0.22 },
    T1: { purchase: 0.112, add_to_cart: 0.215 },
    T2: { purchase: 0.086, add_to_cart: 0.25 },
  },
  'hero-headline': {
    C: { add_to_cart: 0.2 },
    T1: { add_to_cart: 0.235 },
  },
};
const BASELINE: Record<string, number> = { purchase: 0.08, add_to_cart: 0.2 };

const COUNTRIES: Array<[string, number]> = [
  ['US', 34],
  ['IN', 26],
  ['GB', 12],
  ['DE', 10],
  ['BR', 7],
  ['CA', 6],
  ['JP', 5],
];
const PLATFORMS: Array<[string, number]> = [
  ['web', 55],
  ['ios', 25],
  ['android', 20],
];

function pick<T>(items: Array<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of items) if ((r -= w) < 0) return v;
  return items[0][0];
}

async function main() {
  const res = await fetch(`${url}/api/sdk/config`, { headers: { 'x-forkcast-key': key } });
  if (!res.ok) throw new Error(`Could not load config from ${url} with key ${key}: ${res.status}. Is the server running?`);
  const config = (await res.json()) as { environment: string; experiments: Experiment[] };
  console.log(`Simulating ${userCount} users over ${days} days in "${config.environment}" (${config.experiments.length} experiments)…`);

  const now = Date.now();
  const events: ForkcastEvent[] = [];
  for (let i = 0; i < userCount; i++) {
    // More users on recent days, like a growing rollout.
    const dayOffset = Math.floor(Math.pow(Math.random(), 1.6) * days);
    const firstSeen = now - dayOffset * 86_400_000 - Math.random() * 80_000_000;
    const user = { id: `sim-${config.environment}-${i}`, country: pick(COUNTRIES), platform: pick(PLATFORMS) };

    const assigned: Record<string, string> = {};
    for (const exp of config.experiments) {
      const ev = evaluate(exp, exp.key, user, { environment: config.environment });
      if (!ev.inExperiment) continue;
      assigned[exp.key] = ev.variant;
      const visits = 1 + Math.floor(Math.random() * 3);
      for (let v = 0; v < visits; v++) {
        events.push({ type: 'exposure', experiment: exp.key, variant: ev.variant, userId: user.id, ts: Math.min(now, firstSeen + v * 3_600_000), attributes: { country: user.country, platform: user.platform } });
      }
    }

    for (const name of ['add_to_cart', 'purchase']) {
      // Combine effects of every experiment the user is in (relative to baseline).
      let p = BASELINE[name];
      for (const [exp, variant] of Object.entries(assigned)) {
        const effect = EFFECTS[exp]?.[variant]?.[name];
        if (effect != null) p *= effect / BASELINE[name];
      }
      if (Math.random() < p) {
        const value = name === 'purchase' ? Math.round((14 + Math.random() * 50) * 100) / 100 : undefined;
        events.push({ type: 'track', name, userId: user.id, value, ts: Math.min(now, firstSeen + 600_000 + Math.random() * 3_600_000) });
      }
    }
  }

  events.sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < events.length; i += 1000) {
    const batch = events.slice(i, i + 1000);
    const r = await fetch(`${url}/api/sdk/events`, { method: 'POST', body: JSON.stringify({ clientKey: key, events: batch }) });
    if (!r.ok) throw new Error(`Event upload failed: ${r.status} ${await r.text()}`);
  }
  console.log(`Sent ${events.length} events. Open ${url} to see the results.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
