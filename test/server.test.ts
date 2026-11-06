import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createForkcast } from '../src/core/client';
import { createForkcastServer, JsonFileStorage, type ForkcastServer } from '../src/server';

const ADMIN = 'test-admin-token';
let server: ForkcastServer;
let base: string;
let dataFile: string;

async function api(path: string, init: RequestInit & { json?: unknown } = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json', 'x-forkcast-actor': 'tester', ...(init.headers ?? {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

beforeAll(async () => {
  dataFile = join(mkdtempSync(join(tmpdir(), 'forkcast-')), 'data.json');
  server = await createForkcastServer({
    storage: new JsonFileStorage(dataFile, 10),
    adminToken: ADMIN,
    dashboard: false,
    seed: {
      version: 1,
      environments: [{ key: 'development', name: 'Development', clientKey: 'fc_dev_test' }],
      experiments: [
        {
          key: 'new-checkout',
          name: 'New checkout',
          type: 'experiment',
          variants: [
            { key: 'C', weight: 50 },
            { key: 'T1', weight: 50 },
          ],
          metrics: ['purchase'],
          environments: { development: { status: 'running', traffic: 100 } },
        },
      ],
    },
  });
  base = (await server.listen(0, '127.0.0.1')).url;
});

afterAll(async () => {
  await server.close();
});

describe('admin API', () => {
  it('rejects requests without the admin token', async () => {
    const res = await fetch(`${base}/api/experiments`);
    expect(res.status).toBe(401);
  });

  it('reports meta without auth', async () => {
    const res = await fetch(`${base}/api/meta`);
    expect(await res.json()).toEqual({ name: 'forkcast', authRequired: true });
  });

  it('lists seeded experiments and environments', async () => {
    const envs = await api('/api/environments');
    expect(envs.body.map((e: { key: string }) => e.key)).toEqual(['development', 'staging', 'production']);
    expect(envs.body[0].clientKey).toBe('fc_dev_test');
    const list = await api('/api/experiments?env=development');
    expect(list.body[0]).toMatchObject({ key: 'new-checkout', results: { totalUsers: 0 } });
  });

  it('creates experiments with defaults and validates input', async () => {
    const bad = await api('/api/experiments', { method: 'POST', json: { key: 'Bad Key', name: '' } });
    expect(bad.status).toBe(400);
    expect(bad.body.details.length).toBeGreaterThan(0);

    const ok = await api('/api/experiments', { method: 'POST', json: { key: 'dark-mode', name: 'Dark mode', type: 'flag' } });
    expect(ok.status).toBe(201);
    expect(ok.body.environments.production).toEqual({ status: 'off', traffic: 0 });
    expect(ok.body.owner).toBe('tester');

    const dup = await api('/api/experiments', { method: 'POST', json: { key: 'dark-mode', name: 'Again' } });
    expect(dup.status).toBe(409);
  });

  it('toggles an environment with one call and records an audit entry', async () => {
    const on = await api('/api/experiments/dark-mode/environments/production', { method: 'PATCH', json: { status: 'running', traffic: 25 } });
    expect(on.body.environments.production).toMatchObject({ status: 'running', traffic: 25 });
    const launched = await api('/api/experiments/dark-mode/environments/production', { method: 'PATCH', json: { status: 'launched' } });
    expect(launched.body.environments.production.launchedVariant).toBe('T1');
    const audit = await api('/api/audit?experiment=dark-mode');
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(['launch', 'start', 'create']);
    expect(audit.body[1].detail).toBe('status off → running, traffic 0% → 25%');
    expect(audit.body[0].actor).toBe('tester');
  });

  it('rejects unknown environments', async () => {
    const res = await api('/api/experiments/dark-mode/environments/moon', { method: 'PATCH', json: { status: 'running' } });
    expect(res.status).toBe(400);
  });

  it('exports and imports config-as-code', async () => {
    const exported = await api('/api/export');
    expect(exported.body.version).toBe(1);
    expect(exported.body.experiments.map((e: { key: string }) => e.key)).toContain('dark-mode');
    const imported = await api('/api/import', { method: 'POST', json: { version: 1, experiments: [{ ...exported.body.experiments[0], name: 'Renamed' }] } });
    expect(imported.body.imported).toBe(1);
  });
});

describe('SDK endpoints', () => {
  it('rejects unknown client keys', async () => {
    const res = await fetch(`${base}/api/sdk/config`, { headers: { 'x-forkcast-key': 'nope' } });
    expect(res.status).toBe(401);
  });

  it('serves per-environment config with CORS', async () => {
    const res = await fetch(`${base}/api/sdk/config?key=fc_dev_test`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.environment).toBe('development');
    expect(Object.keys(body.experiments[0].environments)).toEqual(['development']);
    expect(body.version).toBeTruthy();
  });

  it('end-to-end: SDK exposures + conversions show up in results', async () => {
    const fc = createForkcast({ apiUrl: base, clientKey: 'fc_dev_test', realtime: false, refreshInterval: 0, flushInterval: 0, persist: false });
    await fc.ready();
    const seen: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const u = fc.forUser({ id: `user-${i}`, country: i % 2 ? 'IN' : 'US' });
      const t = u.getTreatment('new-checkout');
      seen[t] = (seen[t] ?? 0) + 1;
      if (t === 'T1' ? i % 3 === 0 : i % 10 === 0) u.track('purchase', { value: 20 });
    }
    await fc.flush();
    await fc.close();

    const { body } = await api('/api/experiments/new-checkout/results?env=development');
    expect(body.totalUsers).toBe(400);
    expect(body.variants.find((v: { key: string }) => v.key === 'C').users).toBe(seen.C);
    const purchase = body.metrics.find((m: { name: string }) => m.name === 'purchase');
    const t1 = purchase.variants.find((v: { key: string }) => v.key === 'T1');
    expect(t1.conversions).toBeGreaterThan(0);
    expect(t1.total).toBe(t1.conversions * 20);
    expect(body.breakdowns.country.map((c: { value: string }) => c.value).sort()).toEqual(['IN', 'US']);
    expect(body.timeseries.at(-1).cumulative.C).toBe(seen.C);

    const overview = await api('/api/overview?env=development');
    expect(overview.body.enrolledUsers).toBe(400);
    expect(overview.body.topEvents[0].name).toBe('purchase');
  });

  it('pushes config changes over SSE', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/sdk/stream?key=fc_dev_test`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const readUntil = async (pred: (s: string) => boolean) => {
      while (!pred(buffer)) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
    };
    await readUntil((s) => s.includes('event: config'));
    buffer = '';
    await api('/api/experiments/new-checkout/environments/development', { method: 'PATCH', json: { status: 'off' } });
    await readUntil((s) => s.includes('"status":"off"'));
    expect(buffer).toContain('"status":"off"');
    controller.abort();
  });

  it('persists to the JSON file', async () => {
    await (server.storage as JsonFileStorage).writeNow();
    const data = JSON.parse(readFileSync(dataFile, 'utf8'));
    expect(data.experiments.length).toBe(2);
    expect(Object.keys(data.assignments.development['new-checkout']).length).toBe(400);
  });
});
