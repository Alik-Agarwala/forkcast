import { afterEach, describe, expect, it, vi } from 'vitest';
import { createForkcast, parseOverrideParam } from '../src/core/client';
import type { Experiment } from '../src/core/types';

const experiments: Experiment[] = [
  {
    key: 'new-checkout',
    name: 'New checkout',
    type: 'experiment',
    variants: [
      { key: 'C', weight: 50 },
      { key: 'T1', weight: 50, payload: { label: 'Buy now' } },
    ],
    environments: {
      development: { status: 'running', traffic: 100 },
      production: { status: 'off', traffic: 0 },
    },
  },
  {
    key: 'dark-mode',
    name: 'Dark mode',
    type: 'flag',
    variants: [
      { key: 'C', weight: 0 },
      { key: 'T1', weight: 100 },
    ],
    environments: { development: { status: 'launched', traffic: 100, launchedVariant: 'T1' } },
  },
];

describe('local mode', () => {
  it('evaluates config-as-code without a server', () => {
    const fc = createForkcast({ config: experiments, environment: 'development', user: { id: 'u1' }, persist: false });
    expect(['C', 'T1']).toContain(fc.getTreatment('new-checkout'));
    expect(fc.isEnabled('dark-mode')).toBe(true);
    expect(fc.getTreatment('missing')).toBe('C');
  });

  it('defaults to production outside dev mode', () => {
    const fc = createForkcast({ config: experiments, devMode: false, user: { id: 'u1' }, persist: false });
    expect(fc.getEnvironment()).toBe('production');
    expect(fc.getTreatment('new-checkout')).toBe('C');
  });

  it('supports overrides only when allowed', () => {
    const dev = createForkcast({ config: experiments, devMode: true, user: { id: 'u1' }, persist: false });
    dev.override('new-checkout', 'T1');
    expect(dev.getVariant('new-checkout')).toMatchObject({ variant: 'T1', reason: 'override', payload: { label: 'Buy now' } });
    dev.clearOverrides();
    expect(dev.getVariant('new-checkout').reason).not.toBe('override');

    const prod = createForkcast({ config: experiments, devMode: false, user: { id: 'u1' }, persist: false, overrides: { 'new-checkout': 'T1' } });
    prod.override('new-checkout', 'T1');
    expect(prod.getTreatment('new-checkout')).toBe('C');
  });

  it('notifies subscribers', () => {
    const fc = createForkcast({ config: experiments, devMode: true, user: { id: 'u1' }, persist: false });
    const fn = vi.fn();
    fc.subscribe(fn);
    fc.setUser({ id: 'u2' });
    fc.override('dark-mode', 'C');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('forUser evaluates other users without touching the default user', () => {
    const fc = createForkcast({ config: experiments, environment: 'development', user: { id: 'me' }, persist: false });
    const a = fc.forUser({ id: 'someone-else' });
    expect(['C', 'T1']).toContain(a.getTreatment('new-checkout'));
    expect(fc.getUser().id).toBe('me');
  });
});

describe('parseOverrideParam', () => {
  it('parses pairs and reset', () => {
    expect(parseOverrideParam('a:T1, b:C')).toEqual({ a: 'T1', b: 'C' });
    expect(parseOverrideParam('reset')).toBe('reset');
    expect(parseOverrideParam(null)).toBeNull();
  });
});

describe('remote mode', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/api/sdk/config')) {
        return new Response(JSON.stringify({ environment: 'development', version: 'v1', experiments }), { status: 200 });
      }
      return new Response('{"ok":true}', { status: 200 });
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it('fetches config, records one exposure per user/experiment and batches events', async () => {
    const { fetchImpl, calls } = mockFetch();
    const fc = createForkcast({
      apiUrl: 'http://forkcast.test/',
      clientKey: 'fc_dev_123',
      user: { id: 'u1', country: 'IN' },
      fetch: fetchImpl,
      realtime: false,
      refreshInterval: 0,
      flushInterval: 0,
      persist: false,
    });
    expect(fc.getTreatment('new-checkout')).toBe('C'); // not loaded yet -> safe default
    await fc.ready();
    expect(fc.initialized).toBe(true);

    const t = fc.getTreatment('new-checkout');
    fc.getTreatment('new-checkout');
    fc.track('purchase', { value: 42, sku: 'abc' });
    await fc.flush();

    const post = calls.find((c) => c.url.endsWith('/api/sdk/events'))!;
    const body = JSON.parse(String(post.init!.body));
    expect(body.clientKey).toBe('fc_dev_123');
    const exposures = body.events.filter((e: { type: string }) => e.type === 'exposure');
    expect(exposures).toHaveLength(1);
    expect(exposures[0]).toMatchObject({ experiment: 'new-checkout', variant: t, userId: 'u1', attributes: { country: 'IN' } });
    expect(body.events.find((e: { type: string }) => e.type === 'track')).toMatchObject({ name: 'purchase', value: 42, properties: { sku: 'abc' } });
    await fc.close();
  });

  it('falls back to C when the server is unreachable', async () => {
    const onError = vi.fn();
    const fc = createForkcast({
      apiUrl: 'http://down.test',
      clientKey: 'k',
      user: { id: 'u1' },
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
      realtime: false,
      refreshInterval: 0,
      flushInterval: 0,
      persist: false,
      onError,
    });
    await fc.ready();
    expect(fc.getTreatment('new-checkout')).toBe('C');
    expect(onError).toHaveBeenCalled();
    await fc.close();
  });
});
