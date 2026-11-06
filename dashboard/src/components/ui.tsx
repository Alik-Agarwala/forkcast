import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EnvironmentStatus, Experiment } from '../api';

// ---------- icons (inline, 16px, stroke) ----------
const paths: Record<string, ReactNode> = {
  flask: <path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3M7 15h10" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  key: <path d="M15 7a4 4 0 1 1-3.9 5H9v2H7v2H4v-3l5.1-5.1A4 4 0 0 1 15 7Zm1.5 2.5h.01" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <path d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />,
  copy: <path d="M9 9h10v10H9zM5 15V5h10" />,
  check: <path d="m5 12 5 5L20 7" />,
  back: <path d="M15 18 9 12l6-6" />,
  sun: <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />,
  alert: <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  info: <path d="M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
  clock: <path d="M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  minus: <path d="M5 12h14" />,
  power: <path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0" />,
  rocket: <path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 12l3 3M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L13 16l-5-5 6.5-6.5Z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />,
  archive: <path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" />,
  download: <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />,
  upload: <path d="M12 20V8M6 14l6-6 6 6M4 4h16" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />,
  book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
  flag: <path d="M4 22V4M4 4h12l-2 4 2 4H4" />,
  users: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
};

export function Icon({ name, size = 16, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M16 26V15M16 15L9 7M16 15l7-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="9" cy="7" r="2.4" fill="#fff" />
      <circle cx="23" cy="7" r="2.4" fill="#fff" />
      <circle cx="16" cy="26" r="2.4" fill="#fff" />
    </svg>
  );
}

// ---------- variant colours: fixed by position, never by rank ----------
export function variantColor(exp: Pick<Experiment, 'variants'>, key: string): string {
  const i = exp.variants.findIndex((v) => v.key === key);
  return `var(--series-${(i < 0 ? exp.variants.length : i) % 6 + 1})`;
}

/** Traffic used when switching on an experiment whose traffic is 0%: start small in production. */
export function startTraffic(env: string, current?: number): number {
  if (current && current > 0) return current;
  return env === 'production' ? 5 : 100;
}

export function envColor(env: string): string {
  return ['development', 'staging', 'production'].includes(env) ? `var(--env-${env})` : 'var(--muted)';
}

// ---------- formatting ----------
export const fmt = {
  int: (n: number) => new Intl.NumberFormat().format(Math.round(n)),
  compact: (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n),
  pct: (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`,
  lift: (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`,
  money: (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n),
  p: (p: number) => (p < 0.001 ? '<0.001' : p.toFixed(3)),
  ago: (iso: string) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  },
  date: (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
};

// ---------- small components ----------
export function StatusPill({ status, archived }: { status?: EnvironmentStatus; archived?: boolean }) {
  if (archived) return <span className="pill pill-archived">Archived</span>;
  const s = status ?? 'off';
  const label = s === 'running' ? 'Running' : s === 'launched' ? 'Launched' : 'Off';
  return (
    <span className={`pill pill-${s}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function TypeTag({ type }: { type: Experiment['type'] }) {
  return <span className="tag">{type === 'flag' ? 'Flag' : 'A/B test'}</span>;
}

export function CopyButton({ text, label, small = true }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${small ? 'btn-sm' : ''} copy`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt('Copy', text);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {label ?? (done ? 'Copied' : 'Copy')}
    </button>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <div className="code-wrap">
      <pre className="code">{children}</pre>
      <CopyButton text={children} />
    </div>
  );
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="body">{children}</div>
        {footer && <div className="foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- toasts ----------
type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(0);
  const push = useCallback((text: string, error?: boolean) => {
    const t = { id: ++id.current, text, error };
    setToasts((all) => [...all, t]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== t.id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- data hook with polling ----------
export function useData<T>(load: () => Promise<T>, deps: unknown[], pollMs = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    const run = () =>
      loadRef.current().then(
        (d) => alive && (setData(d), setError(undefined)),
        (e) => alive && setError(e),
      );
    run();
    const timer = pollMs ? setInterval(run, pollMs) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, pollMs]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}

export function Switch({ on, launched, onChange, disabled, label }: { on: boolean; launched?: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`switch ${on ? (launched ? 'on launched' : 'on') : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    />
  );
}

export type { EnvironmentStatus };
