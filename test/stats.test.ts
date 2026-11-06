import { describe, expect, it } from 'vitest';
import { chiSquarePValue, computeResults, normalCdf, twoProportionTest } from '../src/server/stats';
import type { AssignmentRecord } from '../src/server/storage';
import type { Experiment } from '../src/core/types';

describe('distributions', () => {
  it('normalCdf matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.645)).toBeCloseTo(0.05, 3);
  });
  it('chiSquarePValue matches known values', () => {
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(5.991, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(0, 1)).toBe(1);
  });
});

describe('twoProportionTest', () => {
  it('detects a real lift', () => {
    const r = twoProportionTest(100, 1000, 150, 1000)!;
    expect(r.lift).toBeCloseTo(0.5, 6);
    expect(r.pValue).toBeLessThan(0.01);
    expect(r.liftLow).toBeGreaterThan(0);
  });
  it('does not flag noise', () => {
    expect(twoProportionTest(100, 1000, 104, 1000)!.pValue).toBeGreaterThan(0.5);
  });
});

const exp: Experiment = {
  key: 'x',
  name: 'X',
  type: 'experiment',
  variants: [
    { key: 'C', weight: 50 },
    { key: 'T1', weight: 50 },
  ],
  environments: {},
  metrics: ['purchase'],
};

function users(variant: string, n: number, converters: number, value = 10, country = 'IN'): AssignmentRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    u: `${variant}-${i}`,
    v: variant,
    t: Date.now(),
    n: 1,
    a: { country },
    ...(i < converters ? { m: { purchase: { n: 1, v: value, t: Date.now() } } } : {}),
  }));
}

describe('computeResults', () => {
  it('declares a winner when the treatment is significantly better', () => {
    const r = computeResults(exp, 'production', [...users('C', 1000, 100), ...users('T1', 1000, 160)], {});
    expect(r.totalUsers).toBe(2000);
    expect(r.srm.ok).toBe(true);
    const t1 = r.metrics[0].variants.find((v) => v.key === 'T1')!;
    expect(t1.rate).toBeCloseTo(0.16);
    expect(t1.significant).toBe(true);
    expect(r.verdict).toMatchObject({ status: 'winner', variant: 'T1', metric: 'purchase' });
    expect(r.breakdowns.country[0]).toMatchObject({ value: 'IN', users: 2000 });
  });

  it('flags sample ratio mismatch', () => {
    const r = computeResults(exp, 'production', [...users('C', 1000, 100), ...users('T1', 700, 70)], {});
    expect(r.srm.ok).toBe(false);
    expect(r.verdict.status).toBe('srm');
  });

  it('waits for enough data', () => {
    const r = computeResults(exp, 'production', [...users('C', 20, 2), ...users('T1', 20, 9)], {});
    expect(r.verdict.status).toBe('collecting');
  });

  it('builds a continuous cumulative timeseries', () => {
    const today = new Date().toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const r = computeResults(exp, 'production', [], {
      [twoDaysAgo]: { C: { users: 5, exposures: 5 }, T1: { users: 4, exposures: 4 } },
      [today]: { C: { users: 1, exposures: 3 } },
    });
    expect(r.timeseries).toHaveLength(3);
    expect(r.timeseries[1].daily).toEqual({ C: 0, T1: 0 });
    expect(r.timeseries[2].cumulative).toEqual({ C: 6, T1: 4 });
  });
});

describe('rollout flags', () => {
  it('reports a rollout instead of a comparison when C has no weight', () => {
    const flag: Experiment = { ...exp, type: 'flag', variants: [{ key: 'C', weight: 0 }, { key: 'T1', weight: 100 }] };
    const r = computeResults(flag, 'production', users('T1', 500, 50), {});
    expect(r.verdict.status).toBe('rollout');
  });
});

describe('empty experiments', () => {
  it('returns finite, JSON-safe numbers when nobody is enrolled yet', () => {
    const r = computeResults(exp, 'production', [], {});
    expect(r.verdict.status).toBe('not_started');
    expect(Number.isFinite(r.srm.chiSquare)).toBe(true);
    const json = JSON.stringify(r, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NOT_FINITE' : v));
    expect(json).not.toContain('NOT_FINITE');
  });
});
