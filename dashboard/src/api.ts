import type { EnvironmentInfo, EnvironmentSettings, EnvironmentStatus, Experiment, ForkcastConfig } from '../../src/core/types';
import type { AuditEntry } from '../../src/server/storage';
import type { ExperimentResults, Verdict } from '../../src/server/stats';

export type { EnvironmentInfo, EnvironmentSettings, EnvironmentStatus, Experiment, ExperimentResults, AuditEntry, Verdict, ForkcastConfig };

export interface ExperimentSummary extends Experiment {
  results: {
    totalUsers: number;
    spark: number[];
    primaryMetric?: string;
    variants: Array<{ key: string; users: number; rate: number; lift: number | null; significant: boolean }>;
    verdict: Verdict;
    srmOk: boolean;
  };
}

export interface Overview {
  environment: string;
  counts: { total: number; running: number; launched: number; off: number };
  enrolledUsers: number;
  eventsToday: number;
  days: Array<{ date: string; events: number; users: number }>;
  topEvents: Array<{ name: string; count: number }>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'forkcast:adminToken';
const ACTOR_KEY = 'forkcast:actor';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const session = {
  get token() {
    return read(TOKEN_KEY);
  },
  set token(v: string | null) {
    write(TOKEN_KEY, v);
  },
  get actor() {
    return read(ACTOR_KEY) || 'dashboard';
  },
  set actor(v: string) {
    write(ACTOR_KEY, v);
  },
};

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-forkcast-actor': encodeURIComponent(session.actor) };
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`api/${path.replace(/^\//, '')}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = body as { error?: string; details?: string[] } | undefined;
    throw new ApiError(res.status, b?.error ?? `Request failed (${res.status})`, b?.details);
  }
  return body as T;
}

export const api = {
  meta: () => request<{ authRequired: boolean }>('meta'),
  environments: () => request<EnvironmentInfo[]>('environments'),
  rotateKey: (env: string) => request<EnvironmentInfo>(`environments/${env}/rotate-key`, { method: 'POST' }),
  overview: (env: string) => request<Overview>(`overview?env=${env}`),
  experiments: (env: string) => request<ExperimentSummary[]>(`experiments?env=${env}`),
  experiment: (key: string) => request<Experiment>(`experiments/${encodeURIComponent(key)}`),
  create: (exp: Partial<Experiment>) => request<Experiment>('experiments', { method: 'POST', json: exp }),
  update: (key: string, exp: Partial<Experiment>) => request<Experiment>(`experiments/${encodeURIComponent(key)}`, { method: 'PUT', json: exp }),
  setEnv: (key: string, env: string, patch: Partial<EnvironmentSettings>) =>
    request<Experiment>(`experiments/${encodeURIComponent(key)}/environments/${env}`, { method: 'PATCH', json: patch }),
  archive: (key: string, archived: boolean) => request<Experiment>(`experiments/${encodeURIComponent(key)}/archive`, { method: 'POST', json: { archived } }),
  remove: (key: string) => request(`experiments/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  results: (key: string, env: string) => request<ExperimentResults>(`experiments/${encodeURIComponent(key)}/results?env=${env}`),
  reset: (key: string, env: string) => request(`experiments/${encodeURIComponent(key)}/reset?env=${env}`, { method: 'POST' }),
  audit: (experiment?: string) => request<AuditEntry[]>(`audit${experiment ? `?experiment=${encodeURIComponent(experiment)}` : '?limit=500'}`),
  exportConfig: () => request<ForkcastConfig>('export'),
  importConfig: (config: ForkcastConfig) => request<{ imported: number }>('import', { method: 'POST', json: config }),
};
