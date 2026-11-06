import type { Audience, Condition, Operator, UserContext } from './types';

export const OPERATORS: Operator[] = [
  'eq',
  'neq',
  'in',
  'notIn',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'gt',
  'gte',
  'lt',
  'lte',
  'regex',
  'exists',
  'notExists',
  'semverGte',
  'semverLt',
];

/** Read `a.b.c` style paths from the user context. */
export function getAttribute(user: UserContext, path: string): unknown {
  if (path in user) return user[path];
  let cur: unknown = user;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const norm = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(',').map((s) => s.trim());
  return [v];
}

/** Compare dotted versions. Returns -1, 0 or 1. Non-numeric parts compare as 0. */
export function compareSemver(a: string, b: string): number {
  const pa = String(a).replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Evaluate a single condition. String comparisons are case-insensitive. */
export function matchCondition(user: UserContext, c: Condition): boolean {
  const actual = getAttribute(user, c.attribute);
  const expected = c.value;

  switch (c.operator) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'notExists':
      return actual === undefined || actual === null || actual === '';
  }

  if (actual === undefined || actual === null) {
    // Negative operators match when the attribute is missing.
    return c.operator === 'neq' || c.operator === 'notIn' || c.operator === 'notContains';
  }

  switch (c.operator) {
    case 'eq':
      return norm(actual) === norm(expected) || String(norm(actual)) === String(norm(expected));
    case 'neq':
      return !(norm(actual) === norm(expected) || String(norm(actual)) === String(norm(expected)));
    case 'in':
      return asList(expected).some((e) => String(norm(e)) === String(norm(actual)));
    case 'notIn':
      return !asList(expected).some((e) => String(norm(e)) === String(norm(actual)));
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => String(norm(a)) === String(norm(expected)));
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'notContains':
      if (Array.isArray(actual)) return !actual.some((a) => String(norm(a)) === String(norm(expected)));
      return !String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'startsWith':
      return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
    case 'endsWith':
      return String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'regex':
      try {
        return new RegExp(String(expected), 'i').test(String(actual));
      } catch {
        return false;
      }
    case 'semverGte':
      return compareSemver(String(actual), String(expected)) >= 0;
    case 'semverLt':
      return compareSemver(String(actual), String(expected)) < 0;
    default:
      return false;
  }
}

/** An empty or missing audience matches everybody. */
export function matchAudience(user: UserContext, audience?: Audience): boolean {
  if (!audience || !audience.conditions || audience.conditions.length === 0) return true;
  return audience.match === 'any'
    ? audience.conditions.some((c) => matchCondition(user, c))
    : audience.conditions.every((c) => matchCondition(user, c));
}
