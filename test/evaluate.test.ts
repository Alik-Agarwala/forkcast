import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/evaluate';
import type { Experiment } from '../src/core/types';

function exp(overrides: Partial<Experiment> = {}): Experiment {
  return {
    key: 'new-checkout',
    name: 'New checkout',
    type: 'experiment',
    variants: [
      { key: 'C', weight: 50 },
      { key: 'T1', weight: 50, payload: { label: 'Buy now' } },
    ],
    environments: { production: { status: 'running', traffic: 100 } },
    ...overrides,
  };
}
const prod = { environment: 'production' };

describe('evaluate', () => {
  it('returns C for unknown experiments', () => {
    expect(evaluate(undefined, 'nope', { id: 'u' }, prod)).toMatchObject({ variant: 'C', reason: 'not_found', inExperiment: false });
  });

  it('returns C when the environment is off or missing (kill switch)', () => {
    const e = exp({ environments: { production: { status: 'off', traffic: 100 } } });
    expect(evaluate(e, e.key, { id: 'u' }, prod).reason).toBe('off');
    expect(evaluate(exp(), 'new-checkout', { id: 'u' }, { environment: 'staging' }).reason).toBe('off');
  });

  it('serves the launched variant to everyone', () => {
    const e = exp({ environments: { production: { status: 'launched', traffic: 0, launchedVariant: 'T1' } } });
    for (let i = 0; i < 50; i++) {
      expect(evaluate(e, e.key, { id: `u${i}` }, prod)).toMatchObject({ variant: 'T1', reason: 'launched', payload: { label: 'Buy now' } });
    }
  });

  it('is sticky: the same user always gets the same treatment', () => {
    const e = exp();
    const first = evaluate(e, e.key, { id: 'sticky' }, prod).variant;
    for (let i = 0; i < 20; i++) expect(evaluate(e, e.key, { id: 'sticky' }, prod).variant).toBe(first);
  });

  it('splits by weights', () => {
    const e = exp({ variants: [{ key: 'C', weight: 80 }, { key: 'T1', weight: 20 }] });
    let t1 = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (evaluate(e, e.key, { id: `u${i}` }, prod).variant === 'T1') t1++;
    expect(t1 / n).toBeGreaterThan(0.18);
    expect(t1 / n).toBeLessThan(0.22);
  });

  it('respects traffic % and marks outsiders as not in experiment', () => {
    const e = exp({ environments: { production: { status: 'running', traffic: 10 } } });
    let inside = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const r = evaluate(e, e.key, { id: `u${i}` }, prod);
      if (r.inExperiment) inside++;
      else expect(r).toMatchObject({ variant: 'C', reason: 'not_in_traffic' });
    }
    expect(inside / n).toBeGreaterThan(0.09);
    expect(inside / n).toBeLessThan(0.11);
  });

  it('raising traffic never moves existing users to another treatment', () => {
    const low = exp({ environments: { production: { status: 'running', traffic: 20 } } });
    const high = exp({ environments: { production: { status: 'running', traffic: 80 } } });
    for (let i = 0; i < 5000; i++) {
      const a = evaluate(low, low.key, { id: `u${i}` }, prod);
      if (!a.inExperiment) continue;
      const b = evaluate(high, high.key, { id: `u${i}` }, prod);
      expect(b.inExperiment).toBe(true);
      expect(b.variant).toBe(a.variant);
    }
  });

  it('applies audience targeting', () => {
    const e = exp({ audience: { match: 'all', conditions: [{ attribute: 'country', operator: 'in', value: ['IN'] }] } });
    expect(evaluate(e, e.key, { id: 'u', country: 'US' }, prod).reason).toBe('not_targeted');
    expect(evaluate(e, e.key, { id: 'u', country: 'IN' }, prod).inExperiment).toBe(true);
  });

  it('forced users win over targeting and traffic, but not over off', () => {
    const e = exp({
      forced: [{ variant: 'T1', userIds: ['qa-1'] }],
      audience: { match: 'all', conditions: [{ attribute: 'country', operator: 'eq', value: 'XX' }] },
      environments: { production: { status: 'running', traffic: 0 } },
    });
    expect(evaluate(e, e.key, { id: 'qa-1' }, prod)).toMatchObject({ variant: 'T1', reason: 'forced', inExperiment: false });
    const off = { ...e, environments: { production: { status: 'off' as const, traffic: 0 } } };
    expect(evaluate(off, e.key, { id: 'qa-1' }, prod).variant).toBe('C');
  });

  it('overrides win over everything except unknown variants', () => {
    const e = exp({ environments: { production: { status: 'off', traffic: 0 } } });
    expect(evaluate(e, e.key, { id: 'u' }, { ...prod, overrides: { 'new-checkout': 'T1' } })).toMatchObject({ variant: 'T1', reason: 'override' });
    expect(evaluate(e, e.key, { id: 'u' }, { ...prod, overrides: { 'new-checkout': 'T9' } }).variant).toBe('C');
  });

  it('needs a user id to randomise', () => {
    expect(evaluate(exp(), 'new-checkout', {}, prod).reason).toBe('no_user');
  });

  it('archived experiments always return C', () => {
    expect(evaluate(exp({ archived: true }), 'new-checkout', { id: 'u' }, prod).reason).toBe('archived');
  });
});
