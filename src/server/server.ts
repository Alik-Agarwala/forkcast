import { timingSafeEqual } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { murmur3 } from '../core/hash';
import { CONTROL, type EnvironmentInfo, type EnvironmentSettings, type Experiment, type ForkcastConfig, type ForkcastEvent } from '../core/types';
import { normalizeExperiment, validateConfig, validateExperiment } from '../core/validate';
import { computeResults, dayKey, type ExperimentResults } from './stats';
import { generateClientKey, JsonFileStorage, MemoryStorage, type ForkcastStorage } from './storage';

export interface ForkcastServerOptions {
  /** Storage adapter. Default: JSON file at `dataFile`, or memory if no file is given. */
  storage?: ForkcastStorage;
  /** Path of the JSON data file. Ignored when `storage` is passed. */
  dataFile?: string;
  /** Protects the dashboard and admin API. Strongly recommended in production. */
  adminToken?: string;
  /** Serve the dashboard UI. `true` (default) uses the bundled build; a string is a custom directory. */
  dashboard?: boolean | string;
  /** Experiments (and optionally environments/keys) to load when the store is empty. */
  seed?: ForkcastConfig;
  /** Allowed origins for the admin API (SDK endpoints always allow any origin). Default: same-origin only. */
  adminCorsOrigins?: string[];
  logger?: (message: string) => void;
}

export interface ForkcastServer {
  /** Node/Express compatible request handler. Mount with `app.use('/forkcast', server.handler)`. */
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  storage: ForkcastStorage;
  listen(port?: number, host?: string): Promise<{ port: number; url: string; server: Server }>;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const MAX_BODY = 1024 * 1024;
const MAX_EVENTS_PER_REQUEST = 1000;
const MAX_PAST_MS = 90 * 24 * 3600 * 1000;

function defaultDashboardDir(): string | undefined {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [join(here, 'dashboard'), join(here, '..', '..', 'dist', 'dashboard'), join(here, '..', 'dashboard')];
  return candidates.find((d) => existsSync(join(d, 'index.html')));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** The part of an experiment an SDK needs for one environment. */
function sdkView(exp: Experiment, env: string): Experiment {
  const settings: EnvironmentSettings = exp.environments[env] ?? { status: 'off', traffic: 0 };
  return {
    key: exp.key,
    name: exp.name,
    type: exp.type,
    variants: exp.variants,
    salt: exp.salt,
    audience: exp.audience,
    forced: exp.forced,
    metrics: exp.metrics,
    environments: { [env]: settings },
  };
}

function describeEnvChange(before: EnvironmentSettings | undefined, after: EnvironmentSettings): string {
  const parts: string[] = [];
  const b = before ?? { status: 'off', traffic: 0 };
  if (b.status !== after.status) parts.push(`status ${b.status} → ${after.status}`);
  if (b.traffic !== after.traffic) parts.push(`traffic ${b.traffic}% → ${after.traffic}%`);
  if (after.status === 'launched' && b.launchedVariant !== after.launchedVariant) parts.push(`launched ${after.launchedVariant}`);
  return parts.join(', ') || 'no change';
}

export async function createForkcastServer(options: ForkcastServerOptions = {}): Promise<ForkcastServer> {
  const log = options.logger ?? (() => {});
  const storage = options.storage ?? (options.dataFile ? new JsonFileStorage(options.dataFile) : new MemoryStorage());
  await storage.init();

  // ---- seeding -------------------------------------------------------------
  if (options.seed) {
    const errors = validateConfig(options.seed);
    if (errors.length) throw new Error(`Invalid seed config:\n- ${errors.join('\n- ')}`);
    if (options.seed.environments?.length) {
      const current = await storage.getEnvironments();
      const merged = [...current];
      for (const env of options.seed.environments) {
        const i = merged.findIndex((e) => e.key === env.key);
        if (i >= 0) merged[i] = { ...merged[i], ...env };
        else merged.push({ ...env, clientKey: env.clientKey || generateClientKey(env.key) });
      }
      await storage.saveEnvironments(merged);
    }
    if ((await storage.listExperiments()).length === 0) {
      for (const exp of options.seed.experiments) await storage.saveExperiment(normalizeExperiment(exp));
      await storage.addAudit({ actor: 'system', action: 'seed', detail: `Imported ${options.seed.experiments.length} experiments` });
      log(`Seeded ${options.seed.experiments.length} experiments`);
    }
  }

  const dashboardDir =
    options.dashboard === false ? undefined : typeof options.dashboard === 'string' ? resolve(options.dashboard) : defaultDashboardDir();

  // ---- realtime (SSE) ------------------------------------------------------
  const streams = new Map<string, Set<ServerResponse>>();

  async function envByKey(clientKey: string | undefined): Promise<EnvironmentInfo> {
    if (!clientKey) throw new HttpError(401, 'Missing client key (x-forkcast-key header or ?key=)');
    const env = (await storage.getEnvironments()).find((e) => safeEqual(e.clientKey, clientKey));
    if (!env) throw new HttpError(401, 'Unknown client key');
    return env;
  }

  async function sdkConfig(env: string) {
    const experiments = (await storage.listExperiments()).filter((e) => !e.archived).map((e) => sdkView(e, env));
    const version = murmur3(JSON.stringify(experiments)).toString(36);
    return { environment: env, version, experiments };
  }

  async function broadcast() {
    for (const [env, set] of streams) {
      if (!set.size) continue;
      const data = JSON.stringify(await sdkConfig(env));
      for (const res of set) res.write(`event: config\ndata: ${data}\n\n`);
    }
  }

  const heartbeat = setInterval(() => {
    for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  // ---- helpers -------------------------------------------------------------
  function requireAdmin(req: IncomingMessage) {
    if (!options.adminToken) return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, options.adminToken)) throw new HttpError(401, 'Admin token required');
  }

  function actorOf(req: IncomingMessage): string {
    const raw = req.headers['x-forkcast-actor'];
    const v = Array.isArray(raw) ? raw[0] : raw;
    return (v ? decodeURIComponent(v) : 'api').replace(/[^\w .@-]/g, '').slice(0, 64) || 'api';
  }

  async function mustGet(key: string): Promise<Experiment> {
    const exp = await storage.getExperiment(key);
    if (!exp) throw new HttpError(404, `Experiment "${key}" not found`);
    return exp;
  }

  async function knownEnv(env: string): Promise<void> {
    if (!(await storage.getEnvironments()).some((e) => e.key === env)) throw new HttpError(400, `Unknown environment "${env}"`);
  }

  async function results(exp: Experiment, env: string): Promise<ExperimentResults> {
    return computeResults(exp, env, await storage.getAssignments(env, exp.key), await storage.getDaily(env, exp.key));
  }

  async function summary(exp: Experiment, env: string) {
    const r = await results(exp, env);
    const today = Date.now();
    const spark: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = dayKey(today - i * 86400000);
      const row = r.timeseries.find((t) => t.date === d);
      spark.push(row ? Object.values(row.daily).reduce((s, n) => s + n, 0) : 0);
    }
    const primary = r.metrics.find((m) => m.primary);
    return {
      ...exp,
      results: {
        totalUsers: r.totalUsers,
        spark,
        primaryMetric: primary?.name,
        variants: r.variants.map((v) => {
          const mv = primary?.variants.find((x) => x.key === v.key);
          return { key: v.key, users: v.users, rate: mv?.rate ?? 0, lift: mv?.test?.lift ?? null, significant: mv?.significant ?? false };
        }),
        verdict: r.verdict,
        srmOk: r.srm.ok,
      },
    };
  }

  // ---- routes ----------------------------------------------------------------
  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? 'GET';
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

    // CORS: SDK endpoints are public; admin endpoints are same-origin unless configured.
    const origin = req.headers.origin;
    if (parts[1] === 'sdk') {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type, x-forkcast-key');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    } else if (origin && options.adminCorsOrigins?.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'content-type, authorization, x-forkcast-actor');
      res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (method === 'OPTIONS') return void send(res, 204, undefined);

    if (parts[0] !== 'api') return serveStatic(res, path);

    // ---- public ----
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true });
    if (method === 'GET' && path === '/api/meta') {
      return send(res, 200, { name: 'forkcast', authRequired: Boolean(options.adminToken) });
    }

    // ---- SDK ----
    if (parts[1] === 'sdk') {
      if (method === 'GET' && parts[2] === 'config') {
        const env = await envByKey((req.headers['x-forkcast-key'] as string) ?? url.searchParams.get('key') ?? undefined);
        return send(res, 200, await sdkConfig(env.key));
      }
      if (method === 'GET' && parts[2] === 'stream') {
        const env = await envByKey(url.searchParams.get('key') ?? undefined);
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write(`retry: 3000\nevent: config\ndata: ${JSON.stringify(await sdkConfig(env.key))}\n\n`);
        const set = streams.get(env.key) ?? new Set();
        streams.set(env.key, set);
        set.add(res);
        req.on('close', () => set.delete(res));
        return;
      }
      if (method === 'POST' && parts[2] === 'events') {
        const body = (await readBody(req)) as { clientKey?: string; events?: ForkcastEvent[] };
        const env = await envByKey(body.clientKey ?? (req.headers['x-forkcast-key'] as string | undefined));
        const now = Date.now();
        const events = (Array.isArray(body.events) ? body.events : []).slice(0, MAX_EVENTS_PER_REQUEST).filter((e) => {
          if (!e || typeof e.userId !== 'string' || !e.userId) return false;
          if (e.type === 'exposure') return typeof e.experiment === 'string' && typeof e.variant === 'string';
          if (e.type === 'track') return typeof e.name === 'string' && e.name.length <= 100;
          return false;
        });
        for (const e of events) {
          const ts = Number(e.ts);
          e.ts = Number.isFinite(ts) && ts > now - MAX_PAST_MS && ts <= now + 5 * 60_000 ? ts : now;
        }
        await storage.recordEvents(env.key, events);
        return send(res, 202, { accepted: events.length });
      }
      throw new HttpError(404, 'Not found');
    }

    // ---- admin ----
    requireAdmin(req);
    const actor = actorOf(req);

    if (method === 'GET' && path === '/api/environments') return send(res, 200, await storage.getEnvironments());
    if (method === 'POST' && parts[1] === 'environments' && parts[3] === 'rotate-key') {
      const envs = await storage.getEnvironments();
      const env = envs.find((e) => e.key === parts[2]);
      if (!env) throw new HttpError(404, 'Environment not found');
      env.clientKey = generateClientKey(env.key);
      await storage.saveEnvironments(envs);
      await storage.addAudit({ actor, action: 'rotate-key', environment: env.key, detail: 'Client key rotated' });
      return send(res, 200, env);
    }

    if (method === 'GET' && path === '/api/overview') {
      const env = url.searchParams.get('env') ?? 'production';
      const experiments = await storage.listExperiments();
      const summaries = await Promise.all(experiments.map((e) => summary(e, env)));
      const totals = await storage.getEventTotals(env);
      const days: Array<{ date: string; events: number; users: number }> = [];
      for (let i = 13; i >= 0; i--) {
        const d = dayKey(Date.now() - i * 86400000);
        const events = Object.values(totals[d] ?? {}).reduce((s, x) => s + x.count, 0);
        const users = summaries.reduce((s, x) => s + (x.results.spark[13 - i] ?? 0), 0);
        days.push({ date: d, events, users });
      }
      const active = experiments.filter((e) => !e.archived);
      return send(res, 200, {
        environment: env,
        counts: {
          total: active.length,
          running: active.filter((e) => e.environments[env]?.status === 'running').length,
          launched: active.filter((e) => e.environments[env]?.status === 'launched').length,
          off: active.filter((e) => (e.environments[env]?.status ?? 'off') === 'off').length,
        },
        enrolledUsers: summaries.reduce((s, x) => s + x.results.totalUsers, 0),
        eventsToday: days[days.length - 1].events,
        days,
        topEvents: Object.entries(
          Object.values(totals).reduce<Record<string, number>>((acc, day) => {
            for (const [name, t] of Object.entries(day)) acc[name] = (acc[name] ?? 0) + t.count;
            return acc;
          }, {}),
        )
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
      });
    }

    if (parts[1] === 'experiments') {
      const key = parts[2];
      if (!key) {
        if (method === 'GET') {
          const env = url.searchParams.get('env') ?? 'production';
          const list = await storage.listExperiments();
          return send(res, 200, await Promise.all(list.map((e) => summary(e, env))));
        }
        if (method === 'POST') {
          const body = (await readBody(req)) as Partial<Experiment> & { key: string };
          if (body.key && (await storage.getExperiment(body.key))) throw new HttpError(409, `Experiment "${body.key}" already exists`);
          const exp = normalizeExperiment({ ...body, owner: body.owner ?? actor });
          const envs = await storage.getEnvironments();
          for (const e of envs) exp.environments[e.key] ??= { status: 'off', traffic: e.key === 'production' ? 0 : 100 };
          const errors = validateExperiment(exp);
          if (errors.length) throw new HttpError(400, 'Invalid experiment', errors);
          await storage.saveExperiment(exp);
          await storage.addAudit({ actor, action: 'create', experiment: exp.key, detail: `Created ${exp.type} "${exp.name}"` });
          await broadcast();
          return send(res, 201, exp);
        }
      }

      if (key && parts.length === 3) {
        if (method === 'GET') return send(res, 200, await mustGet(key));
        if (method === 'PUT') {
          const current = await mustGet(key);
          const body = (await readBody(req)) as Partial<Experiment>;
          const next: Experiment = {
            ...current,
            ...body,
            key: current.key,
            createdAt: current.createdAt,
            environments: { ...current.environments, ...(body.environments ?? {}) },
            updatedAt: new Date().toISOString(),
          };
          const errors = validateExperiment(next);
          if (errors.length) throw new HttpError(400, 'Invalid experiment', errors);
          await storage.saveExperiment(next);
          const changed = Object.keys(body).filter((k) => JSON.stringify((body as Record<string, unknown>)[k]) !== JSON.stringify((current as unknown as Record<string, unknown>)[k]));
          await storage.addAudit({ actor, action: 'update', experiment: key, detail: changed.length ? `Changed ${changed.join(', ')}` : 'Saved without changes' });
          await broadcast();
          return send(res, 200, next);
        }
        if (method === 'DELETE') {
          await mustGet(key);
          await storage.deleteExperiment(key);
          await storage.addAudit({ actor, action: 'delete', experiment: key, detail: 'Deleted experiment and its data' });
          await broadcast();
          return send(res, 200, { deleted: key });
        }
      }

      if (key && parts[3] === 'environments' && parts[4] && method === 'PATCH') {
        const env = parts[4];
        await knownEnv(env);
        const exp = await mustGet(key);
        const body = (await readBody(req)) as Partial<EnvironmentSettings>;
        const before = exp.environments[env];
        const next: EnvironmentSettings = {
          status: body.status ?? before?.status ?? 'off',
          traffic: body.traffic ?? before?.traffic ?? 0,
          launchedVariant: body.launchedVariant ?? before?.launchedVariant,
        };
        if (next.status === 'launched' && !next.launchedVariant) {
          next.launchedVariant = exp.variants.find((v) => v.key !== CONTROL)?.key ?? CONTROL;
        }
        exp.environments[env] = next;
        exp.updatedAt = new Date().toISOString();
        const errors = validateExperiment(exp);
        if (errors.length) throw new HttpError(400, 'Invalid change', errors);
        await storage.saveExperiment(exp);
        const action = next.status !== (before?.status ?? 'off') ? (next.status === 'off' ? 'turn-off' : next.status === 'launched' ? 'launch' : 'start') : 'update-traffic';
        await storage.addAudit({ actor, action, experiment: key, environment: env, detail: describeEnvChange(before, next) });
        await broadcast();
        return send(res, 200, exp);
      }

      if (key && parts[3] === 'archive' && method === 'POST') {
        const exp = await mustGet(key);
        const body = (await readBody(req)) as { archived?: boolean };
        exp.archived = body.archived ?? true;
        if (exp.archived) for (const s of Object.values(exp.environments)) s.status = 'off';
        exp.updatedAt = new Date().toISOString();
        await storage.saveExperiment(exp);
        await storage.addAudit({ actor, action: exp.archived ? 'archive' : 'unarchive', experiment: key });
        await broadcast();
        return send(res, 200, exp);
      }

      if (key && parts[3] === 'results' && method === 'GET') {
        const env = url.searchParams.get('env') ?? 'production';
        return send(res, 200, await results(await mustGet(key), env));
      }

      if (key && parts[3] === 'reset' && method === 'POST') {
        const env = url.searchParams.get('env') ?? 'production';
        await mustGet(key);
        await storage.resetResults(env, key);
        await storage.addAudit({ actor, action: 'reset-results', experiment: key, environment: env, detail: 'Cleared collected results' });
        return send(res, 200, { reset: true });
      }
    }

    if (method === 'GET' && path === '/api/audit') {
      const limit = Math.min(1000, Number(url.searchParams.get('limit')) || 200);
      return send(res, 200, await storage.listAudit({ experiment: url.searchParams.get('experiment') ?? undefined, limit }));
    }

    if (method === 'GET' && path === '/api/export') {
      const experiments = (await storage.listExperiments()).map(({ createdAt, updatedAt, ...e }) => e);
      return send(res, 200, { version: 1, experiments } satisfies ForkcastConfig, {
        'content-disposition': 'attachment; filename="forkcast.config.json"',
      });
    }

    if (method === 'POST' && path === '/api/import') {
      const body = (await readBody(req)) as ForkcastConfig;
      const errors = validateConfig(body);
      if (errors.length) throw new HttpError(400, 'Invalid config', errors);
      for (const exp of body.experiments) {
        const existing = await storage.getExperiment(exp.key);
        await storage.saveExperiment(normalizeExperiment({ ...existing, ...exp, createdAt: existing?.createdAt, updatedAt: new Date().toISOString() }));
      }
      await storage.addAudit({ actor, action: 'import', detail: `Imported ${body.experiments.length} experiments` });
      await broadcast();
      return send(res, 200, { imported: body.experiments.length });
    }

    throw new HttpError(404, 'Not found');
  }

  async function serveStatic(res: ServerResponse, path: string) {
    if (!dashboardDir) {
      return send(res, 404, { error: 'Dashboard not available. Build it with `npm run build` or pass dashboard: "<dir>".' });
    }
    const target = normalize(join(dashboardDir, path === '/' ? 'index.html' : path));
    const inside = target.startsWith(dashboardDir + sep) || target === dashboardDir;
    let file = inside ? target : join(dashboardDir, 'index.html');
    try {
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = join(dashboardDir, 'index.html');
    } catch {
      file = join(dashboardDir, 'index.html');
    }
    const body = await fs.readFile(file);
    const isAsset = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  }

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    route(req, res, url).catch((err: unknown) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, details: err.details });
      log(`Error: ${(err as Error)?.stack ?? err}`);
      send(res, 500, { error: 'Internal server error' });
    });
  };

  let httpServer: Server | undefined;

  return {
    handler,
    storage,
    async listen(port = 4400, host = '0.0.0.0') {
      httpServer = createServer(handler);
      await new Promise<void>((ok, fail) => {
        httpServer!.once('error', fail);
        httpServer!.listen(port, host, () => ok());
      });
      const address = httpServer.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      return { port: actual, url: `http://localhost:${actual}`, server: httpServer };
    },
    async close() {
      clearInterval(heartbeat);
      for (const set of streams.values()) for (const res of set) res.end();
      streams.clear();
      if (httpServer) await new Promise<void>((ok) => httpServer!.close(() => ok()));
      await storage.close();
    },
  };
}
