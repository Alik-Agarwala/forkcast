import { describe, expect, it } from 'vitest';
import { compareSemver, matchAudience, matchCondition } from '../src/core/targeting';

const user = { id: 'u1', country: 'IN', plan: 'pro', age: 31, email: 'dev@amazon.com', appVersion: '2.10.1', roles: ['beta', 'staff'], meta: { tier: 'gold' } };

describe('matchCondition', () => {
  it.each([
    [{ attribute: 'country', operator: 'eq', value: 'in' }, true],
    [{ attribute: 'country', operator: 'neq', value: 'US' }, true],
    [{ attribute: 'country', operator: 'in', value: ['US', 'IN'] }, true],
    [{ attribute: 'country', operator: 'in', value: 'US, GB' }, false],
    [{ attribute: 'country', operator: 'notIn', value: ['US'] }, true],
    [{ attribute: 'email', operator: 'endsWith', value: '@amazon.com' }, true],
    [{ attribute: 'email', operator: 'startsWith', value: 'dev' }, true],
    [{ attribute: 'email', operator: 'contains', value: 'AMAZON' }, true],
    [{ attribute: 'roles', operator: 'contains', value: 'beta' }, true],
    [{ attribute: 'roles', operator: 'notContains', value: 'admin' }, true],
    [{ attribute: 'age', operator: 'gte', value: 31 }, true],
    [{ attribute: 'age', operator: 'lt', value: 18 }, false],
    [{ attribute: 'email', operator: 'regex', value: '^dev@' }, true],
    [{ attribute: 'plan', operator: 'exists' }, true],
    [{ attribute: 'missing', operator: 'notExists' }, true],
    [{ attribute: 'missing', operator: 'eq', value: 'x' }, false],
    [{ attribute: 'missing', operator: 'neq', value: 'x' }, true],
    [{ attribute: 'appVersion', operator: 'semverGte', value: '2.9.0' }, true],
    [{ attribute: 'appVersion', operator: 'semverLt', value: '2.10.0' }, false],
    [{ attribute: 'meta.tier', operator: 'eq', value: 'gold' }, true],
  ] as const)('%o -> %s', (cond, expected) => {
    expect(matchCondition(user, cond as never)).toBe(expected);
  });

  it('treats invalid regex as no match', () => {
    expect(matchCondition(user, { attribute: 'email', operator: 'regex', value: '(' })).toBe(false);
  });
});

describe('matchAudience', () => {
  it('matches everyone when empty', () => {
    expect(matchAudience(user, undefined)).toBe(true);
    expect(matchAudience(user, { match: 'all', conditions: [] })).toBe(true);
  });
  it('supports all / any', () => {
    const conditions = [
      { attribute: 'country', operator: 'eq' as const, value: 'US' },
      { attribute: 'plan', operator: 'eq' as const, value: 'pro' },
    ];
    expect(matchAudience(user, { match: 'all', conditions })).toBe(false);
    expect(matchAudience(user, { match: 'any', conditions })).toBe(true);
  });
});

describe('compareSemver', () => {
  it('compares numerically', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
    expect(compareSemver('v2.0.0', '2.0.0')).toBe(0);
    expect(compareSemver('1.0', '1.0.1')).toBe(-1);
  });
});
