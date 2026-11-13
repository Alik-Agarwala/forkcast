/**
 * Generates `python/tests/fixtures/parity.json`: hashing, targeting and
 * evaluation results computed by the JavaScript core. The Python SDK's test
 * suite replays every case and must get identical answers, so a user lands in
 * the same bucket whichever SDK evaluates them.
 *
 *   npm run python:parity            # regenerate the fixture
 *   npm run python:parity -- --check # fail if the fixture is out of date (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUCKETS, bucketOf, murmur3 } from '../src/core/hash';
import { compareSemver, matchCondition } from '../src/core/targeting';
import { evaluate, pickVariant } from '../src/core/evaluate';
import type { Condition, Experiment, UserContext } from '../src/core/types';

const OUT = resolve(import.meta.dirname ?? __dirname, '../python/tests/fixtures/parity.json');

// ---------------------------------------------------------------- hashing
const hashInputs = [
  '',
  'a',
  'ab',
  'abc',
  'abcd',
  'abcde',
  'hello',
  'hello world',
  'new-checkout:traffic:alice',
  'new-checkout:variant:alice',
  'Ünïcödé',
  'नमस्ते',
  'こんにちは',
  '🚀🔥',
  'mixed 🚀 text ü',
  'x'.repeat(300),
  ...Array.from({ length: 13 }, (_, i) => 'q'.repeat(i)),
];
const hashes = hashInputs.flatMap((s) => [0, 1, 42, 0xffffffff].map((seed) => [s, seed, murmur3(s, seed)]));

const userIds = [
  ...Array.from({ length: 1000 }, (_, i) => `user-${i}`),
  ...Array.from({ length: 200 }, (_, i) => String(i * 7919)),
  'alice',
  'bob',
  'Prantika',
  'ユーザー',
  'user@example.com',
  '00000000-0000-4000-8000-000000000000',
];
const namespaces = ['new-checkout:traffic', 'new-checkout:variant', 'dark-mode:traffic', 'üñí:variant'];
const buckets = namespaces.map((ns) => ({ namespace: ns, buckets: userIds.map((id) => bucketOf(ns, id)) }));

// ---------------------------------------------------------------- targeting
const values: Array<[string, unknown]> = [
  ['missing', undefined],
  ['null', null],
  ['IN', 'IN'],
  ['in', 'in'],
  ['spaced', ' IN '],
  ['US', 'US'],
  ['empty', ''],
  ['zero', 0],
  ['one', 1],
  ['five', 5],
  ['fiveHalf', 5.5],
  ['negative', -3],
  ['str5', '5'],
  ['str05', '05'],
  ['str5.0', '5.0'],
  ['strPadded', ' 12 '],
  ['hex', '0x10'],
  ['abc', 'abc'],
  ['true', true],
  ['false', false],
  ['ver', '2.4.0'],
  ['verV', 'v2.10.1'],
  ['verShort', '2.4'],
  ['verPre', '2.4.0-beta.1'],
  ['list', ['a', 'B']],
  ['listCountries', ['IN', 'US']],
  ['listEmpty', []],
  ['obj', { x: 1 }],
  ['big', 1e21],
  ['float', 0.1 + 0.2],
  ['tiny', 1e-7],
  ['decimal', 123456789.123],
  ['email', 'Dev@Example.com'],
];

const conditions: Condition[] = [
  { attribute: 'a', operator: 'eq', value: 'in' },
  { attribute: 'a', operator: 'eq', value: 'IN' },
  { attribute: 'a', operator: 'eq', value: 5 },
  { attribute: 'a', operator: 'eq', value: '5' },
  { attribute: 'a', operator: 'eq', value: true },
  { attribute: 'a', operator: 'eq', value: 'true' },
  { attribute: 'a', operator: 'eq', value: '' },
  { attribute: 'a', operator: 'eq', value: 'a,b' },
  { attribute: 'a', operator: 'eq', value: '1e+21' },
  { attribute: 'a', operator: 'eq', value: '0.30000000000000004' },
  { attribute: 'a', operator: 'eq', value: '1e-7' },
  { attribute: 'a', operator: 'eq', value: '[object Object]' },
  { attribute: 'a', operator: 'eq' },
  { attribute: 'a', operator: 'neq', value: 'in' },
  { attribute: 'a', operator: 'neq', value: 5 },
  { attribute: 'a', operator: 'in', value: ['IN', 'US'] },
  { attribute: 'a', operator: 'in', value: 'in, us' },
  { attribute: 'a', operator: 'in', value: [5, 'x'] },
  { attribute: 'a', operator: 'in', value: 'true' },
  { attribute: 'a', operator: 'in', value: 5 },
  { attribute: 'a', operator: 'notIn', value: ['IN', 'US'] },
  { attribute: 'a', operator: 'notIn', value: 'gb,fr' },
  { attribute: 'a', operator: 'contains', value: 'n' },
  { attribute: 'a', operator: 'contains', value: 'b' },
  { attribute: 'a', operator: 'contains', value: 'IN' },
  { attribute: 'a', operator: 'contains', value: '@example' },
  { attribute: 'a', operator: 'notContains', value: 'n' },
  { attribute: 'a', operator: 'notContains', value: 'b' },
  { attribute: 'a', operator: 'startsWith', value: 'i' },
  { attribute: 'a', operator: 'startsWith', value: 'v2' },
  { attribute: 'a', operator: 'endsWith', value: 'n' },
  { attribute: 'a', operator: 'endsWith', value: '.COM' },
  { attribute: 'a', operator: 'gt', value: 5 },
  { attribute: 'a', operator: 'gt', value: '4' },
  { attribute: 'a', operator: 'gt', value: 'abc' },
  { attribute: 'a', operator: 'gte', value: 5 },
  { attribute: 'a', operator: 'gte', value: 0 },
  { attribute: 'a', operator: 'lt', value: 5 },
  { attribute: 'a', operator: 'lt', value: '1' },
  { attribute: 'a', operator: 'lte', value: 5 },
  { attribute: 'a', operator: 'lte', value: 0 },
  { attribute: 'a', operator: 'regex', value: '^i' },
  { attribute: 'a', operator: 'regex', value: '^[0-9]+$' },
  { attribute: 'a', operator: 'regex', value: '(' },
  { attribute: 'a', operator: 'regex', value: 'v2\\.' },
  { attribute: 'a', operator: 'regex', value: '@example\\.com$' },
  { attribute: 'a', operator: 'exists' },
  { attribute: 'a', operator: 'notExists' },
  { attribute: 'a', operator: 'semverGte', value: '2.4.0' },
  { attribute: 'a', operator: 'semverGte', value: 'v2.5' },
  { attribute: 'a', operator: 'semverLt', value: '2.10.0' },
  { attribute: 'a', operator: 'semverLt', value: '3' },
  { attribute: 'a', operator: 'bogus' as Condition['operator'], value: 'x' },
];

const targeting: Array<{ user: Record<string, unknown>; condition: Condition; expected: boolean }> = [];
for (const [, v] of values) {
  const user: Record<string, unknown> = v === undefined ? {} : { a: v };
  for (const c of conditions) targeting.push({ user, condition: c, expected: matchCondition(user, c) });
}
const nestedUser = { profile: { tier: 'Gold', score: 7 }, tags: ['beta', 'staff'], 'dotted.key': 'flat' };
for (const c of [
  { attribute: 'profile.tier', operator: 'eq', value: 'gold' },
  { attribute: 'profile.score', operator: 'gte', value: 7 },
  { attribute: 'profile.missing', operator: 'notExists' },
  { attribute: 'tags.1', operator: 'eq', value: 'staff' },
  { attribute: 'tags', operator: 'contains', value: 'BETA' },
  { attribute: 'dotted.key', operator: 'eq', value: 'flat' },
  { attribute: 'profile', operator: 'exists' },
] as Condition[]) {
  targeting.push({ user: nestedUser, condition: c, expected: matchCondition(nestedUser, c) });
}

const semverPairs = [
  ['2.4.0', '2.4.0'],
  ['2.10.0', '2.9.9'],
  ['v1.2.3', '1.2.3'],
  ['1.2', '1.2.0'],
  ['1.2.3-beta', '1.2.3'],
  ['1.2.3+build.5', '1.2.4'],
  ['abc', '0.0.0'],
  ['3', '2.99.99'],
  [' 2.4.0', '2.4.0'],
  ['V2.4.0', '2.4.0'],
  ['1.-2.3', '1.0.0'],
].map(([a, b]) => [a, b, compareSemver(a, b)]);

// ---------------------------------------------------------------- evaluation
const base = (key: string, extra: Partial<Experiment> = {}): Experiment => ({
  key,
  name: key,
  type: 'experiment',
  variants: [
    { key: 'C', weight: 50 },
    { key: 'T1', weight: 50, payload: { label: 'one-click' } },
  ],
  environments: { production: { status: 'running', traffic: 100 } },
  ...extra,
});

const experiments: Experiment[] = [
  base('ab-full'),
  base('ab-10pct', { environments: { production: { status: 'running', traffic: 10 } } }),
  base('ab-0pct', { environments: { production: { status: 'running', traffic: 0 } } }),
  base('ab-fraction', { environments: { production: { status: 'running', traffic: 33.33 } } }),
  base('abn', {
    variants: [
      { key: 'C', weight: 40 },
      { key: 'T1', weight: 20 },
      { key: 'T2', weight: 20 },
      { key: 'behaviour-1', weight: 10 },
      { key: 'behaviour-2', weight: 10 },
    ],
  }),
  base('odd-weights', {
    variants: [
      { key: 'C', weight: 1 },
      { key: 'T1', weight: 0.3 },
      { key: 'T2', weight: 2.7 },
      { key: 'T3', weight: 0 },
    ],
  }),
  base('flag', { type: 'flag', variants: [{ key: 'C', weight: 0 }, { key: 'T1', weight: 100 }] }),
  base('salted', { salt: 'restart-2', environments: { production: { status: 'running', traffic: 50 } } }),
  base('off', { environments: { production: { status: 'off', traffic: 100 } } }),
  base('launched', { environments: { production: { status: 'launched', traffic: 100, launchedVariant: 'T1' } } }),
  base('launched-default', { environments: { production: { status: 'launched', traffic: 100 } } }),
  base('dev-only', { environments: { development: { status: 'running', traffic: 100 } } }),
  base('archived', { archived: true }),
  base('targeted', {
    audience: {
      match: 'all',
      conditions: [
        { attribute: 'country', operator: 'in', value: ['IN', 'US'] },
        { attribute: 'appVersion', operator: 'semverGte', value: '2.4.0' },
      ],
    },
    environments: { production: { status: 'running', traffic: 60 } },
  }),
  base('targeted-any', {
    audience: {
      match: 'any',
      conditions: [
        { attribute: 'plan', operator: 'eq', value: 'pro' },
        { attribute: 'email', operator: 'endsWith', value: '@example.com' },
      ],
    },
  }),
  base('forced', { forced: [{ variant: 'T1', userIds: ['user-1', 'user-2'] }, { variant: 'T9', userIds: ['user-3'] }] }),
  base('zero-weights', { variants: [{ key: 'C', weight: 0 }, { key: 'T1', weight: 0 }] }),
];

const countries = ['IN', 'US', 'GB', 'in', undefined];
const plans = ['free', 'pro', 'PRO', undefined];
const versions = ['2.3.9', '2.4.0', '2.10.1', undefined];
const users: UserContext[] = Array.from({ length: 400 }, (_, i) => {
  const u: UserContext = { id: `user-${i}` };
  if (countries[i % 5]) u.country = countries[i % 5];
  if (plans[i % 4]) u.plan = plans[i % 4];
  if (versions[i % 7 % 4]) u.appVersion = versions[i % 7 % 4];
  if (i % 11 === 0) u.email = `person${i}@example.com`;
  return u;
});
users.push({}, { country: 'IN' }, { id: 42 as unknown as string }, { id: '' });

const evaluations = experiments.map((exp) => ({
  key: exp.key,
  results: users.map((u) => {
    const e = evaluate(exp, exp.key, u, { environment: 'production' });
    return `${e.variant}|${e.reason}|${e.inExperiment ? 1 : 0}`;
  }),
}));

const overrides = experiments.map((exp) => {
  const e = evaluate(exp, exp.key, users[5], { environment: 'production', overrides: { [exp.key]: 'T1' } });
  return [exp.key, e.variant, e.reason];
});
const notFound = evaluate(undefined, 'nope', users[0], { environment: 'production' });

// Variant picking: record the bucket where the chosen variant changes.
const weightSets = experiments.filter((e) => ['ab-full', 'abn', 'odd-weights', 'flag', 'zero-weights'].includes(e.key));
const pickBoundaries = weightSets.map((exp) => {
  const runs: Array<[number, string]> = [];
  let prev = '';
  for (let b = 0; b < BUCKETS; b++) {
    const v = pickVariant(exp, b);
    if (v !== prev) runs.push([b, v]);
    prev = v;
  }
  return { key: exp.key, runs };
});

const fixture = {
  generatedBy: 'scripts/python-parity.ts',
  hashes,
  userIds,
  buckets,
  targeting,
  semver: semverPairs,
  experiments,
  users,
  evaluations,
  overrides,
  notFound: [notFound.variant, notFound.reason],
  pickBoundaries,
};

// One case per line keeps diffs readable.
function format(value: unknown): string {
  const lines = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
    if (Array.isArray(v)) return `  ${JSON.stringify(k)}: [\n${v.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

const output = format(fixture);
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    /* missing */
  }
  if (current !== output) {
    console.error('python/tests/fixtures/parity.json is out of date. Run `npm run python:parity` and commit the result.');
    process.exit(1);
  }
  console.log('Python parity fixture is up to date.');
} else {
  writeFileSync(OUT, output);
  console.log(`Wrote ${OUT} (${targeting.length} targeting cases, ${users.length * experiments.length} evaluations)`);
}
