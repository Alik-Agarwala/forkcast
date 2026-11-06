import { evaluate } from './evaluate';
import { CONTROL } from './types';
import type {
  Evaluation,
  Experiment,
  ForkcastConfig,
  ForkcastEvent,
  Treatment,
  UserContext,
} from './types';

export interface ForkcastOptions {
  /** The user being evaluated. Add any attributes you want to target on (country, plan, appVersion...). */
  user?: UserContext;

  // ---- Remote mode: talk to a Forkcast server --------------------------------
  /** Base URL of your Forkcast server, e.g. `https://flags.example.com`. */
  apiUrl?: string;
  /** Public client key of an environment (shown in the dashboard under Environments). */
  clientKey?: string;

  // ---- Local mode: no server, config-as-code ---------------------------------
  /** Experiments defined in code / a JSON file. Enables fully offline evaluation. */
  config?: ForkcastConfig | Experiment[];
  /** Environment to evaluate in local mode. Default: `development` in dev mode, else `production`. */
  environment?: string;

  /**
   * Dev mode enables overrides (URL param, devtools panel, localStorage) and debug logs.
   * Default: auto-detected (`NODE_ENV !== 'production'` or a localhost hostname).
   */
  devMode?: boolean;
  /** Allow treatment overrides. Default: same as `devMode`. Enable in prod only for QA builds. */
  allowOverrides?: boolean;
  /** Static overrides applied at start, e.g. `{ 'new-checkout': 'T1' }`. */
  overrides?: Record<string, Treatment>;
  /** Record exposures automatically when a treatment is read. Default `true`. */
  trackExposures?: boolean;
  /** Receive config changes instantly over Server-Sent Events. Default `true` where available. */
  realtime?: boolean;
  /** Poll for config changes every N ms when realtime is unavailable. 0 disables. Default 30000. */
  refreshInterval?: number;
  /** Flush queued events every N ms. Default 2000. */
  flushInterval?: number;
  /** Config to use before the first fetch finishes (e.g. server-rendered). */
  bootstrap?: ForkcastConfig | Experiment[];
  /** Custom fetch implementation (tests, older runtimes). */
  fetch?: typeof fetch;
  /** Persist anonymous id and overrides in localStorage. Default `true` in browsers. */
  persist?: boolean;
  debug?: boolean;
  onError?: (error: unknown) => void;
}

export type Listener = () => void;

const ANON_KEY = 'forkcast:anonId';
const OVERRIDES_KEY = 'forkcast:overrides';
export const OVERRIDE_QUERY_PARAM = 'forkcast';

function safeStorage(): Storage | undefined {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return undefined;
    const probe = '__forkcast__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return undefined;
  }
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Best effort dev-mode detection that works in Node, bundlers and plain browsers. */
export function detectDevMode(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (env && env.NODE_ENV) return env.NODE_ENV !== 'production';
  } catch {
    /* ignore */
  }
  try {
    const host = (globalThis as { location?: Location }).location?.hostname;
    if (host) {
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.local');
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Parse `?forkcast=new-checkout:T1,dark-mode:C` into an overrides map. */
export function parseOverrideParam(value: string | null | undefined): Record<string, Treatment> | 'reset' | null {
  if (!value) return null;
  if (value === 'reset' || value === 'clear') return 'reset';
  const out: Record<string, Treatment> = {};
  for (const pair of value.split(',')) {
    const [k, v] = pair.split(':').map((s) => s && s.trim());
    if (k && v) out[k] = v;
  }
  return out;
}

function toExperiments(config?: ForkcastConfig | Experiment[]): Experiment[] {
  if (!config) return [];
  return Array.isArray(config) ? config : config.experiments ?? [];
}

/** A lightweight evaluator bound to one user. Ideal for servers handling many requests. */
export interface ScopedForkcast {
  readonly user: UserContext;
  getTreatment(key: string): Treatment;
  getVariant<P = unknown>(key: string): Evaluation<P>;
  isEnabled(key: string): boolean;
  getPayload<P = unknown>(key: string): P | undefined;
  getAllTreatments(): Record<string, Treatment>;
  track(name: string, props?: { value?: number; [k: string]: unknown }): void;
}

export class ForkcastClient {
  readonly devMode: boolean;
  readonly overridesAllowed: boolean;
  private opts: ForkcastOptions;
  private experiments = new Map<string, Experiment>();
  private environment: string;
  private user: UserContext;
  private overrides: Record<string, Treatment> = {};
  private listeners = new Set<Listener>();
  private queue: ForkcastEvent[] = [];
  private exposed = new Set<string>();
  private flushTimer?: ReturnType<typeof setInterval>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private source?: EventSource;
  private readyPromise: Promise<void>;
  private isReady = false;
  private version = 0;
  private storage?: Storage;
  private closed = false;
  private configVersion?: string;
  private inflight: Promise<void> = Promise.resolve();

  constructor(options: ForkcastOptions = {}) {
    this.opts = options;
    this.devMode = options.devMode ?? detectDevMode();
    this.overridesAllowed = options.allowOverrides ?? this.devMode;
    this.environment = options.environment ?? (this.devMode ? 'development' : 'production');
    this.storage = options.persist === false ? undefined : safeStorage();
    this.user = this.withId(options.user ?? {});

    for (const e of toExperiments(options.bootstrap ?? options.config)) this.experiments.set(e.key, e);
    if (this.overridesAllowed) this.loadOverrides(options.overrides);

    if (this.isRemote) {
      this.readyPromise = this.refresh().then(
        () => this.markReady(),
        (err) => {
          this.handleError(err);
          this.markReady(); // Never block the app: unknown experiments evaluate to C.
        },
      );
      this.startSync();
      const interval = options.flushInterval ?? 2000;
      if (interval > 0) {
        this.flushTimer = setInterval(() => void this.flush(), interval);
        (this.flushTimer as { unref?: () => void }).unref?.();
      }
      this.listenForPageHide();
    } else {
      this.isReady = true;
      this.readyPromise = Promise.resolve();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Resolves once the first config fetch finished (or failed). Never rejects. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  get initialized(): boolean {
    return this.isReady;
  }

  /** The treatment for an experiment: `C`, `T1`, `T2`... Always `C` when unknown or off. */
  getTreatment(key: string): Treatment {
    return this.getVariant(key).variant;
  }

  /** Full evaluation result including payload and the reason for the decision. */
  getVariant<P = unknown>(key: string): Evaluation<P> {
    return this.evaluateFor(this.user, key) as Evaluation<P>;
  }

  /** Feature-flag helper: true when the user gets anything other than `C`. */
  isEnabled(key: string): boolean {
    return this.getTreatment(key) !== CONTROL;
  }

  /** The JSON payload attached to the user's treatment, if any. */
  getPayload<P = unknown>(key: string): P | undefined {
    return this.getVariant<P>(key).payload;
  }

  /** Evaluate every known experiment without recording exposures. */
  getAllTreatments(): Record<string, Treatment> {
    const out: Record<string, Treatment> = {};
    for (const key of this.experiments.keys()) out[key] = this.peek(key).variant;
    return out;
  }

  /** Evaluate without recording an exposure (for debugging and devtools). */
  peek(key: string): Evaluation {
    return evaluate(this.experiments.get(key), key, this.user, {
      environment: this.environment,
      overrides: this.overridesAllowed ? this.overrides : undefined,
    });
  }

  /** Record a conversion / business event, e.g. `track('purchase', { value: 49.99 })`. */
  track(name: string, props: { value?: number; [k: string]: unknown } = {}): void {
    this.trackFor(this.user, name, props);
  }

  /** Bind an evaluator to another user (server-side rendering, API handlers). */
  forUser(user: UserContext): ScopedForkcast {
    const u = { ...user, id: user.id != null ? String(user.id) : undefined };
    return {
      user: u,
      getTreatment: (key) => this.evaluateFor(u, key).variant,
      getVariant: <P>(key: string) => this.evaluateFor(u, key) as Evaluation<P>,
      isEnabled: (key) => this.evaluateFor(u, key).variant !== CONTROL,
      getPayload: <P>(key: string) => this.evaluateFor(u, key).payload as P | undefined,
      getAllTreatments: () => {
        const out: Record<string, Treatment> = {};
        for (const key of this.experiments.keys()) {
          out[key] = evaluate(this.experiments.get(key), key, u, { environment: this.environment }).variant;
        }
        return out;
      },
      track: (name, props) => this.trackFor(u, name, props ?? {}),
    };
  }

  setUser(user: UserContext): void {
    this.user = this.withId(user);
    this.exposed.clear();
    this.emit();
  }

  getUser(): UserContext {
    return { ...this.user };
  }

  getEnvironment(): string {
    return this.environment;
  }

  getExperiments(): Experiment[] {
    return [...this.experiments.values()];
  }

  /** Force a treatment locally. Pass `null` to remove. Ignored unless overrides are allowed. */
  override(key: string, variant: Treatment | null): void {
    if (!this.overridesAllowed) {
      this.log('override ignored: overrides are disabled (production build?)');
      return;
    }
    if (variant == null) delete this.overrides[key];
    else this.overrides[key] = variant;
    this.saveOverrides();
    this.emit();
  }

  getOverrides(): Record<string, Treatment> {
    return { ...this.overrides };
  }

  clearOverrides(): void {
    this.overrides = {};
    this.saveOverrides();
    this.emit();
  }

  /** Subscribe to config / user / override changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Monotonic counter that changes whenever evaluation results might change. */
  getVersion(): number {
    return this.version;
  }

  /** Replace experiments (local mode, tests, or bootstrapping). */
  setConfig(config: ForkcastConfig | Experiment[]): void {
    this.experiments = new Map(toExperiments(config).map((e) => [e.key, e]));
    this.emit();
  }

  /** Fetch the latest config from the server now. */
  async refresh(): Promise<void> {
    if (!this.isRemote) return;
    const res = await this.fetchImpl(`${this.base}/api/sdk/config`, {
      headers: { 'x-forkcast-key': this.opts.clientKey! },
    });
    if (!res.ok) throw new Error(`Forkcast: config request failed with ${res.status}`);
    const body = (await res.json()) as { environment: string; version: string; experiments: Experiment[] };
    this.applyRemote(body);
  }

  /** Send queued events now. Resolves once everything queued so far (including in-flight batches) was sent. */
  flush(): Promise<void> {
    this.inflight = this.inflight.then(() => this.sendQueued());
    return this.inflight;
  }

  private async sendQueued(): Promise<void> {
    if (!this.isRemote || this.queue.length === 0) return;
    const events = this.queue.splice(0, this.queue.length);
    try {
      const res = await this.fetchImpl(`${this.base}/api/sdk/events`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ clientKey: this.opts.clientKey, events }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(`Forkcast: events request failed with ${res.status}`);
    } catch (err) {
      // Put events back (bounded) so a flaky network does not lose data.
      this.queue.unshift(...events.slice(-500));
      this.handleError(err);
    }
  }

  /** Stop timers and connections, flushing pending events. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.source?.close();
    await this.flush();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private get isRemote(): boolean {
    return Boolean(this.opts.apiUrl && this.opts.clientKey);
  }

  private get base(): string {
    return String(this.opts.apiUrl).replace(/\/+$/, '');
  }

  private get fetchImpl(): typeof fetch {
    const f = this.opts.fetch ?? (globalThis.fetch as typeof fetch | undefined);
    if (!f) throw new Error('Forkcast: no fetch available. Pass `fetch` in options.');
    return f;
  }

  private evaluateFor(user: UserContext, key: string): Evaluation {
    const ev = evaluate(this.experiments.get(key), key, user, {
      environment: this.environment,
      overrides: this.overridesAllowed && user === this.user ? this.overrides : undefined,
    });
    if (ev.inExperiment && this.opts.trackExposures !== false && user.id) {
      const dedupe = `${user.id}|${key}|${ev.variant}`;
      if (!this.exposed.has(dedupe)) {
        this.exposed.add(dedupe);
        if (this.exposed.size > 50_000) this.exposed.clear();
        this.enqueue({
          type: 'exposure',
          experiment: key,
          variant: ev.variant,
          userId: String(user.id),
          ts: Date.now(),
          attributes: pickAttributes(user),
        });
      }
    }
    if (this.opts.debug) this.log(`${key} -> ${ev.variant} (${ev.reason})`);
    return ev;
  }

  private trackFor(user: UserContext, name: string, props: { value?: number; [k: string]: unknown }): void {
    if (!user.id) return;
    const { value, ...properties } = props;
    this.enqueue({
      type: 'track',
      name,
      userId: String(user.id),
      value: typeof value === 'number' && Number.isFinite(value) ? value : undefined,
      ts: Date.now(),
      properties: Object.keys(properties).length ? properties : undefined,
    });
  }

  private enqueue(event: ForkcastEvent): void {
    if (!this.isRemote) return;
    this.queue.push(event);
    if (this.queue.length >= 100) void this.flush();
  }

  private applyRemote(body: { environment: string; version?: string; experiments: Experiment[] }): void {
    if (body.version && body.version === this.configVersion) return;
    this.configVersion = body.version;
    this.environment = body.environment || this.environment;
    this.experiments = new Map(body.experiments.map((e) => [e.key, e]));
    this.emit();
  }

  private startSync(): void {
    const ES = (globalThis as { EventSource?: typeof EventSource }).EventSource;
    if (this.opts.realtime !== false && ES) {
      try {
        const url = `${this.base}/api/sdk/stream?key=${encodeURIComponent(this.opts.clientKey!)}`;
        this.source = new ES(url);
        this.source.addEventListener('config', (e) => {
          try {
            this.applyRemote(JSON.parse((e as MessageEvent).data));
          } catch (err) {
            this.handleError(err);
          }
        });
        return;
      } catch (err) {
        this.handleError(err);
      }
    }
    const interval = this.opts.refreshInterval ?? 30_000;
    if (interval > 0) {
      this.pollTimer = setInterval(() => {
        if (!this.closed) this.refresh().catch((err) => this.handleError(err));
      }, interval);
      (this.pollTimer as { unref?: () => void }).unref?.();
    }
  }

  private listenForPageHide(): void {
    const w = globalThis as { addEventListener?: typeof addEventListener; navigator?: Navigator };
    if (typeof w.addEventListener !== 'function' || !w.navigator?.sendBeacon) return;
    w.addEventListener('pagehide', () => {
      if (this.queue.length === 0) return;
      const events = this.queue.splice(0, this.queue.length);
      const blob = new Blob([JSON.stringify({ clientKey: this.opts.clientKey, events })], { type: 'text/plain' });
      w.navigator!.sendBeacon(`${this.base}/api/sdk/events`, blob);
    });
  }

  private markReady(): void {
    this.isReady = true;
    this.emit();
  }

  private withId(user: UserContext): UserContext {
    if (user.id != null && user.id !== '') return { ...user, id: String(user.id) };
    if (!this.storage) return { ...user };
    let anon = this.storage.getItem(ANON_KEY);
    if (!anon) {
      anon = randomId();
      this.storage.setItem(ANON_KEY, anon);
    }
    return { ...user, id: anon, anonymous: true };
  }

  private loadOverrides(initial?: Record<string, Treatment>): void {
    try {
      const saved = this.storage?.getItem(OVERRIDES_KEY);
      if (saved) this.overrides = JSON.parse(saved);
    } catch {
      /* ignore corrupt storage */
    }
    if (initial) Object.assign(this.overrides, initial);
    try {
      const search = (globalThis as { location?: Location }).location?.search;
      if (search) {
        const parsed = parseOverrideParam(new URLSearchParams(search).get(OVERRIDE_QUERY_PARAM));
        if (parsed === 'reset') this.overrides = {};
        else if (parsed) Object.assign(this.overrides, parsed);
        if (parsed) this.saveOverrides();
      }
    } catch {
      /* ignore */
    }
  }

  private saveOverrides(): void {
    try {
      if (Object.keys(this.overrides).length) this.storage?.setItem(OVERRIDES_KEY, JSON.stringify(this.overrides));
      else this.storage?.removeItem(OVERRIDES_KEY);
    } catch {
      /* ignore */
    }
  }

  private emit(): void {
    this.version++;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (err) {
        this.handleError(err);
      }
    }
  }

  private handleError(err: unknown): void {
    if (this.opts.onError) this.opts.onError(err);
    else if (this.devMode || this.opts.debug) console.warn('[forkcast]', err);
  }

  private log(msg: string): void {
    if (this.devMode || this.opts.debug) console.debug('[forkcast]', msg);
  }
}

/** Only a few well-known, non-identifying attributes are sent with exposures (for breakdowns). */
function pickAttributes(user: UserContext): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const k of ['country', 'platform', 'device', 'browser', 'plan', 'appVersion']) {
    if (user[k] != null && typeof user[k] !== 'object') out[k] = user[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Create a Forkcast client. See {@link ForkcastOptions}. */
export function createForkcast(options: ForkcastOptions = {}): ForkcastClient {
  return new ForkcastClient(options);
}
