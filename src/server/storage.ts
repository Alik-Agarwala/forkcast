import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { EnvironmentInfo, Experiment, ForkcastEvent } from '../core/types';
import { dayKey } from './stats';

/** One enrolled user in one experiment. Field names are short to keep files small. */
export interface AssignmentRecord {
  /** User id. */
  u: string;
  /** Treatment the user was first exposed to (intention-to-treat). */
  v: string;
  /** First exposure timestamp (ms). */
  t: number;
  /** Number of exposures. */
  n: number;
  /** Breakdown attributes (country, platform...). */
  a?: Record<string, string | number | boolean>;
  /** Metrics after first exposure: name -> { n: count, v: summed value, t: first conversion ts }. */
  m?: Record<string, { n: number; v: number; t: number }>;
}

/** day -> variant -> counts */
export type DailyCounts = Record<string, Record<string, { exposures: number; users: number }>>;

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  experiment?: string;
  environment?: string;
  detail?: string;
}

export interface EventTotals {
  /** day -> event name -> totals */
  [day: string]: Record<string, { count: number; value: number }>;
}

/**
 * Storage adapter contract. Implement this to back Forkcast with Postgres,
 * DynamoDB, Redis... The bundled adapters are {@link MemoryStorage} and
 * {@link JsonFileStorage}.
 */
export interface ForkcastStorage {
  init(): Promise<void>;
  getEnvironments(): Promise<EnvironmentInfo[]>;
  saveEnvironments(envs: EnvironmentInfo[]): Promise<void>;
  listExperiments(): Promise<Experiment[]>;
  getExperiment(key: string): Promise<Experiment | undefined>;
  saveExperiment(exp: Experiment): Promise<void>;
  deleteExperiment(key: string): Promise<void>;
  recordEvents(environment: string, events: ForkcastEvent[]): Promise<void>;
  getAssignments(environment: string, experiment: string): Promise<AssignmentRecord[]>;
  getDaily(environment: string, experiment: string): Promise<DailyCounts>;
  getEventTotals(environment: string): Promise<EventTotals>;
  resetResults(environment: string, experiment: string): Promise<void>;
  addAudit(entry: Omit<AuditEntry, 'id' | 'ts'> & { ts?: string }): Promise<AuditEntry>;
  listAudit(filter?: { experiment?: string; limit?: number }): Promise<AuditEntry[]>;
  close(): Promise<void>;
}

interface StoreData {
  version: 1;
  environments: EnvironmentInfo[];
  experiments: Experiment[];
  /** env -> experiment -> userId -> record */
  assignments: Record<string, Record<string, Record<string, Omit<AssignmentRecord, 'u'>>>>;
  /** env -> experiment -> daily counts */
  daily: Record<string, Record<string, DailyCounts>>;
  /** env -> event totals */
  events: Record<string, EventTotals>;
  audit: AuditEntry[];
}

const MAX_AUDIT = 2000;

export const DEFAULT_ENVIRONMENTS: Array<Omit<EnvironmentInfo, 'clientKey'>> = [
  { key: 'development', name: 'Development', color: '#16a34a' },
  { key: 'staging', name: 'Staging', color: '#d97706' },
  { key: 'production', name: 'Production', color: '#dc2626' },
];

export function generateClientKey(env: string): string {
  return `fc_${env.slice(0, 4)}_${randomBytes(12).toString('hex')}`;
}

function emptyData(): StoreData {
  return {
    version: 1,
    environments: DEFAULT_ENVIRONMENTS.map((e) => ({ ...e, clientKey: generateClientKey(e.key) })),
    experiments: [],
    assignments: {},
    daily: {},
    events: {},
    audit: [],
  };
}

/** Everything in memory. Great for tests and ephemeral demos. */
export class MemoryStorage implements ForkcastStorage {
  protected data: StoreData = emptyData();

  async init(): Promise<void> {}

  protected changed(): void {}

  async getEnvironments() {
    return this.data.environments.map((e) => ({ ...e }));
  }

  async saveEnvironments(envs: EnvironmentInfo[]) {
    this.data.environments = envs.map((e) => ({ ...e }));
    this.changed();
  }

  async listExperiments() {
    return this.data.experiments.map((e) => structuredClone(e));
  }

  async getExperiment(key: string) {
    const e = this.data.experiments.find((x) => x.key === key);
    return e ? structuredClone(e) : undefined;
  }

  async saveExperiment(exp: Experiment) {
    const i = this.data.experiments.findIndex((x) => x.key === exp.key);
    if (i >= 0) this.data.experiments[i] = structuredClone(exp);
    else this.data.experiments.push(structuredClone(exp));
    this.changed();
  }

  async deleteExperiment(key: string) {
    this.data.experiments = this.data.experiments.filter((x) => x.key !== key);
    for (const env of Object.keys(this.data.assignments)) delete this.data.assignments[env][key];
    for (const env of Object.keys(this.data.daily)) delete this.data.daily[env][key];
    this.changed();
  }

  async recordEvents(environment: string, events: ForkcastEvent[]) {
    const assignments = (this.data.assignments[environment] ??= {});
    const daily = (this.data.daily[environment] ??= {});
    const totals = (this.data.events[environment] ??= {});

    for (const ev of events) {
      const day = dayKey(ev.ts);
      if (ev.type === 'exposure') {
        const perExp = (assignments[ev.experiment] ??= {});
        const counts = ((daily[ev.experiment] ??= {})[day] ??= {});
        const bucket = (counts[ev.variant] ??= { exposures: 0, users: 0 });
        bucket.exposures++;
        const existing = perExp[ev.userId];
        if (existing) {
          existing.n++;
          continue;
        }
        bucket.users++;
        const attrs: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(ev.attributes ?? {})) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') attrs[k] = v;
        }
        perExp[ev.userId] = { v: ev.variant, t: ev.ts, n: 1, ...(Object.keys(attrs).length ? { a: attrs } : {}) };
      } else if (ev.type === 'track') {
        const value = typeof ev.value === 'number' && Number.isFinite(ev.value) ? ev.value : 0;
        const t = ((totals[day] ??= {})[ev.name] ??= { count: 0, value: 0 });
        t.count++;
        t.value += value;
        // Attribute the conversion to every experiment the user was exposed to before it happened.
        for (const perExp of Object.values(assignments)) {
          const rec = perExp[ev.userId];
          if (!rec || rec.t > ev.ts) continue;
          const m = ((rec.m ??= {})[ev.name] ??= { n: 0, v: 0, t: ev.ts });
          m.n++;
          m.v += value;
        }
      }
    }
    this.changed();
  }

  async getAssignments(environment: string, experiment: string): Promise<AssignmentRecord[]> {
    const perExp = this.data.assignments[environment]?.[experiment] ?? {};
    return Object.entries(perExp).map(([u, r]) => ({ u, ...r }));
  }

  async getDaily(environment: string, experiment: string): Promise<DailyCounts> {
    return structuredClone(this.data.daily[environment]?.[experiment] ?? {});
  }

  async getEventTotals(environment: string): Promise<EventTotals> {
    return structuredClone(this.data.events[environment] ?? {});
  }

  async resetResults(environment: string, experiment: string) {
    delete this.data.assignments[environment]?.[experiment];
    delete this.data.daily[environment]?.[experiment];
    this.changed();
  }

  async addAudit(entry: Omit<AuditEntry, 'id' | 'ts'> & { ts?: string }) {
    const full: AuditEntry = { id: randomBytes(6).toString('hex'), ts: entry.ts ?? new Date().toISOString(), ...entry } as AuditEntry;
    this.data.audit.unshift(full);
    if (this.data.audit.length > MAX_AUDIT) this.data.audit.length = MAX_AUDIT;
    this.changed();
    return full;
  }

  async listAudit(filter: { experiment?: string; limit?: number } = {}) {
    const list = filter.experiment ? this.data.audit.filter((a) => a.experiment === filter.experiment) : this.data.audit;
    return list.slice(0, filter.limit ?? 200);
  }

  async close() {}
}

/**
 * Persists everything to a single JSON file. Zero setup, fine for side projects,
 * internal tools and up to roughly 100k enrolled users. Writes are debounced and atomic.
 */
export class JsonFileStorage extends MemoryStorage {
  private timer?: ReturnType<typeof setTimeout>;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly debounceMs = 250,
  ) {
    super();
  }

  override async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as StoreData;
      this.data = { ...this.data, ...parsed };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      await this.writeNow();
    }
  }

  protected override changed(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.writeNow(), this.debounceMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  async writeNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data));
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }

  override async close(): Promise<void> {
    await this.writeNow();
  }
}
