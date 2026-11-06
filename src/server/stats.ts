/**
 * Statistics for experiment results. Pure functions, no I/O.
 *
 * - Conversion metrics: two-proportion z-test (two-sided).
 * - Value metrics (revenue per user): Welch's t-test with a normal approximation.
 * - Sample Ratio Mismatch (SRM): chi-square goodness-of-fit against the configured weights.
 *   A failing SRM check means the assignment or logging is broken and results are not trustworthy.
 */
import type { Experiment } from '../core/types';
import type { AssignmentRecord, DailyCounts } from './storage';

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 200; n++) {
      del *= x / ++ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** p-value of a chi-square statistic with `df` degrees of freedom. */
export function chiSquarePValue(stat: number, df: number): number {
  if (df <= 0) return 1;
  return Math.max(0, Math.min(1, gammaQ(df / 2, stat / 2)));
}

export interface ProportionTest {
  /** Relative lift of treatment over control, e.g. 0.12 = +12%. */
  lift: number;
  /** 95% confidence interval for the relative lift. */
  liftLow: number;
  liftHigh: number;
  pValue: number;
}

export function twoProportionTest(cConv: number, cN: number, tConv: number, tN: number): ProportionTest | null {
  if (cN === 0 || tN === 0) return null;
  const p1 = cConv / cN;
  const p2 = tConv / tN;
  const pooled = (cConv + tConv) / (cN + tN);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / cN + 1 / tN));
  const z = se === 0 ? 0 : (p2 - p1) / se;
  const pValue = se === 0 ? 1 : 2 * (1 - normalCdf(Math.abs(z)));
  const seDiff = Math.sqrt((p1 * (1 - p1)) / cN + (p2 * (1 - p2)) / tN);
  const diff = p2 - p1;
  if (p1 === 0) return { lift: 0, liftLow: 0, liftHigh: 0, pValue };
  return {
    lift: diff / p1,
    liftLow: (diff - 1.96 * seDiff) / p1,
    liftHigh: (diff + 1.96 * seDiff) / p1,
    pValue,
  };
}

export function welchTest(
  m1: number,
  v1: number,
  n1: number,
  m2: number,
  v2: number,
  n2: number,
): ProportionTest | null {
  if (n1 < 2 || n2 < 2) return null;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const diff = m2 - m1;
  const pValue = se === 0 ? 1 : 2 * (1 - normalCdf(Math.abs(diff / se)));
  if (m1 === 0) return { lift: 0, liftLow: 0, liftHigh: 0, pValue };
  return { lift: diff / m1, liftLow: (diff - 1.96 * se) / m1, liftHigh: (diff + 1.96 * se) / m1, pValue };
}

export interface VariantSummary {
  key: string;
  name: string;
  weight: number;
  users: number;
  exposures: number;
  /** Observed share of enrolled users. */
  share: number;
  /** Share expected from the weights. */
  expectedShare: number;
}

export interface MetricVariantResult {
  key: string;
  users: number;
  conversions: number;
  rate: number;
  total: number;
  valuePerUser: number;
  /** Conversion-rate comparison against C. `null` for C itself or with no data. */
  test: ProportionTest | null;
  /** Value-per-user comparison against C. */
  valueTest: ProportionTest | null;
  significant: boolean;
}

export interface MetricResult {
  name: string;
  primary: boolean;
  hasValue: boolean;
  variants: MetricVariantResult[];
}

export interface Verdict {
  status: 'not_started' | 'rollout' | 'collecting' | 'no_difference' | 'winner' | 'loser' | 'srm';
  variant?: string;
  metric?: string;
  lift?: number;
  message: string;
}

export interface ExperimentResults {
  experiment: string;
  environment: string;
  generatedAt: string;
  totalUsers: number;
  totalExposures: number;
  variants: VariantSummary[];
  metrics: MetricResult[];
  timeseries: Array<{ date: string; daily: Record<string, number>; cumulative: Record<string, number> }>;
  breakdowns: Record<string, Array<{ value: string; users: number; byVariant: Record<string, number> }>>;
  srm: { chiSquare: number; pValue: number; ok: boolean };
  verdict: Verdict;
}

export const MIN_USERS_PER_VARIANT = 100;
export const ALPHA = 0.05;

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 366) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function computeResults(
  exp: Experiment,
  environment: string,
  assignments: AssignmentRecord[],
  daily: DailyCounts,
): ExperimentResults {
  const keys = exp.variants.map((v) => v.key);
  for (const a of assignments) if (!keys.includes(a.v)) keys.push(a.v);
  const totalWeight = exp.variants.reduce((s, v) => s + v.weight, 0) || 1;

  // ---- per-variant enrolment ------------------------------------------------
  const users: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const exposures: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const a of assignments) {
    users[a.v]++;
    exposures[a.v] += a.n;
  }
  const totalUsers = assignments.length;
  const variants: VariantSummary[] = keys.map((k) => {
    const v = exp.variants.find((x) => x.key === k);
    return {
      key: k,
      name: v?.name ?? k,
      weight: v?.weight ?? 0,
      users: users[k],
      exposures: exposures[k],
      share: totalUsers ? users[k] / totalUsers : 0,
      expectedShare: (v?.weight ?? 0) / totalWeight,
    };
  });

  // ---- metrics ---------------------------------------------------------------
  const metricNames = [...(exp.metrics ?? [])];
  for (const a of assignments) for (const m of Object.keys(a.m ?? {})) if (!metricNames.includes(m)) metricNames.push(m);

  const metrics: MetricResult[] = metricNames.map((name, i) => {
    const agg = keys.map((k) => ({ key: k, conv: 0, total: 0, sumSq: 0 }));
    const byKey = Object.fromEntries(agg.map((x) => [x.key, x]));
    for (const a of assignments) {
      const m = a.m?.[name];
      if (!m) continue;
      const row = byKey[a.v];
      row.conv++;
      row.total += m.v;
      row.sumSq += m.v * m.v;
    }
    const hasValue = agg.some((x) => x.total !== 0);
    const control = byKey['C'];
    const cN = users['C'] ?? 0;
    const cMean = cN ? control.total / cN : 0;
    const cVar = cN > 1 ? Math.max(0, (control.sumSq - cN * cMean * cMean) / (cN - 1)) : 0;

    return {
      name,
      primary: i === 0,
      hasValue,
      variants: agg.map((x) => {
        const n = users[x.key];
        const mean = n ? x.total / n : 0;
        const variance = n > 1 ? Math.max(0, (x.sumSq - n * mean * mean) / (n - 1)) : 0;
        const isControl = x.key === 'C';
        const test = isControl ? null : twoProportionTest(control?.conv ?? 0, cN, x.conv, n);
        const valueTest = isControl || !hasValue ? null : welchTest(cMean, cVar, cN, mean, variance, n);
        const enough = n >= MIN_USERS_PER_VARIANT && cN >= MIN_USERS_PER_VARIANT;
        return {
          key: x.key,
          users: n,
          conversions: x.conv,
          rate: n ? x.conv / n : 0,
          total: x.total,
          valuePerUser: mean,
          test,
          valueTest,
          significant: Boolean(test && enough && test.pValue < ALPHA),
        };
      }),
    };
  });

  // ---- timeseries ------------------------------------------------------------
  const days = Object.keys(daily).sort();
  const timeseries: ExperimentResults['timeseries'] = [];
  if (days.length) {
    const today = dayKey(Date.now());
    const last = days[days.length - 1] > today ? days[days.length - 1] : today;
    const cum: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const date of dateRange(days[0], last)) {
      const d: Record<string, number> = {};
      for (const k of keys) {
        const n = daily[date]?.[k]?.users ?? 0;
        d[k] = n;
        cum[k] += n;
      }
      timeseries.push({ date, daily: d, cumulative: { ...cum } });
    }
  }

  // ---- breakdowns ------------------------------------------------------------
  const breakdowns: ExperimentResults['breakdowns'] = {};
  for (const attr of ['country', 'platform']) {
    const rows = new Map<string, { users: number; byVariant: Record<string, number> }>();
    for (const a of assignments) {
      const value = a.a?.[attr];
      if (value == null) continue;
      const k = String(value);
      const row = rows.get(k) ?? { users: 0, byVariant: {} };
      row.users++;
      row.byVariant[a.v] = (row.byVariant[a.v] ?? 0) + 1;
      rows.set(k, row);
    }
    if (rows.size) {
      breakdowns[attr] = [...rows.entries()]
        .map(([value, r]) => ({ value, ...r }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 20);
    }
  }

  // ---- SRM -------------------------------------------------------------------
  let chi = 0;
  let df = -1;
  for (const v of variants) {
    if (v.expectedShare <= 0) continue;
    const expected = v.expectedShare * totalUsers;
    chi += ((v.users - expected) ** 2) / expected;
    df++;
  }
  const srmP = totalUsers > 0 && df > 0 ? chiSquarePValue(chi, df) : 1;
  const srm = { chiSquare: chi, pValue: srmP, ok: srmP >= 0.001 };

  return {
    experiment: exp.key,
    environment,
    generatedAt: new Date().toISOString(),
    totalUsers,
    totalExposures: Object.values(exposures).reduce((s, n) => s + n, 0),
    variants,
    metrics,
    timeseries,
    breakdowns,
    srm,
    verdict: verdictFor(variants, metrics, srm.ok, totalUsers),
  };
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

function verdictFor(variants: VariantSummary[], metrics: MetricResult[], srmOk: boolean, total: number): Verdict {
  if (total === 0) return { status: 'not_started', message: 'No users have been exposed yet.' };
  if (!variants.some((v) => v.key === 'C' && v.expectedShare > 0)) {
    return { status: 'rollout', message: 'Rollout without a control group: everyone in the traffic gets the feature. Give C a weight to measure impact.' };
  }
  if (!srmOk) {
    return {
      status: 'srm',
      message: 'Sample ratio mismatch: traffic split does not match the configured weights. Check for bugs before trusting results.',
    };
  }
  const primary = metrics.find((m) => m.primary);
  const smallest = Math.min(...variants.filter((v) => v.expectedShare > 0).map((v) => v.users));
  if (!primary) return { status: 'collecting', message: 'Add a metric and call track() to measure impact.' };
  if (smallest < MIN_USERS_PER_VARIANT) {
    return { status: 'collecting', message: `Collecting data: every treatment needs at least ${MIN_USERS_PER_VARIANT} users.` };
  }
  const sig = primary.variants.filter((v) => v.significant && v.test);
  const winners = sig.filter((v) => v.test!.lift > 0).sort((a, b) => b.test!.lift - a.test!.lift);
  if (winners.length) {
    const w = winners[0];
    return { status: 'winner', variant: w.key, metric: primary.name, lift: w.test!.lift, message: `${w.key} beats C on ${primary.name} by ${pct(w.test!.lift)} (p=${w.test!.pValue.toFixed(3)}).` };
  }
  const treatments = primary.variants.filter((v) => v.key !== 'C');
  if (treatments.length && sig.length === treatments.length) {
    const worst = sig.sort((a, b) => a.test!.lift - b.test!.lift)[0];
    return { status: 'loser', variant: worst.key, metric: primary.name, lift: worst.test!.lift, message: `Every treatment is worse than C on ${primary.name}. Consider turning it off.` };
  }
  return { status: 'no_difference', metric: primary.name, message: `No significant difference on ${primary.name} yet. Keep collecting or call it neutral.` };
}
