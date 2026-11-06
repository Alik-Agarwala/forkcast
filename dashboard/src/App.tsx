import { createContext, useContext, useEffect, useState } from 'react';
import { api, ApiError, session, type EnvironmentInfo } from './api';
import { envColor, Icon, Logo, ToastProvider } from './components/ui';
import { ActivityPage } from './pages/Activity';
import { EnvironmentsPage } from './pages/Environments';
import { ExperimentPage } from './pages/Experiment';
import { ExperimentsPage } from './pages/Experiments';
import { NewExperimentPage } from './pages/NewExperiment';

// ---------- hash router ----------
export function useRoute(): string[] {
  const parse = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

// ---------- environment context ----------
interface EnvCtx {
  env: string;
  setEnv: (e: string) => void;
  environments: EnvironmentInfo[];
  reloadEnvironments: () => void;
}
const EnvContext = createContext<EnvCtx>({ env: 'production', setEnv: () => {}, environments: [], reloadEnvironments: () => {} });
export const useEnv = () => useContext(EnvContext);

function readEnv(): string {
  try {
    return localStorage.getItem('forkcast:env') || 'development';
  } catch {
    return 'development';
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try {
          localStorage.setItem('forkcast:theme', next);
        } catch {
          /* ignore */
        }
        setTheme(next);
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form
        className="card card-pad stack"
        style={{ width: 'min(400px, 100%)' }}
        onSubmit={async (e) => {
          e.preventDefault();
          session.token = token.trim();
          try {
            await api.environments();
            onDone();
          } catch {
            session.token = null;
            setError('That token was not accepted.');
          }
        }}
      >
        <div className="row">
          <Logo />
          <h1>Forkcast</h1>
        </div>
        <p className="text-2">This dashboard is protected. Enter the admin token the server was started with.</p>
        <div className="field">
          <label htmlFor="token">Admin token</label>
          <input id="token" className="input" type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} />
          {error && <span className="error-text">{error}</span>}
        </div>
        <button className="btn btn-primary" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [env, setEnvState] = useState(readEnv);
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([]);
  const [auth, setAuth] = useState<'checking' | 'ok' | 'login'>('checking');
  const [actor, setActor] = useState(session.actor);

  const loadEnvs = () =>
    api.environments().then(
      (envs) => {
        setEnvironments(envs);
        setAuth('ok');
        if (envs.length && !envs.some((e) => e.key === env)) setEnvState(envs[0].key);
      },
      (err) => setAuth(err instanceof ApiError && err.status === 401 ? 'login' : 'ok'),
    );

  useEffect(() => {
    void loadEnvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEnv = (e: string) => {
    setEnvState(e);
    try {
      localStorage.setItem('forkcast:env', e);
    } catch {
      /* ignore */
    }
  };

  if (auth === 'checking') return null;
  if (auth === 'login') return <Login onDone={() => void loadEnvs()} />;

  const [page, param] = route;
  const nav = [
    { href: '#/', label: 'Experiments', icon: 'flask', active: !page || page === 'e' || page === 'new' },
    { href: '#/activity', label: 'Activity', icon: 'activity', active: page === 'activity' },
    { href: '#/environments', label: 'Environments & keys', icon: 'key', active: page === 'environments' },
  ];

  let content;
  let crumb = 'Experiments';
  if (page === 'new') {
    content = <NewExperimentPage />;
    crumb = 'Experiments / New';
  } else if (page === 'e' && param) {
    content = <ExperimentPage key={param} expKey={param} />;
    crumb = `Experiments / ${param}`;
  } else if (page === 'activity') {
    content = <ActivityPage />;
    crumb = 'Activity';
  } else if (page === 'environments') {
    content = <EnvironmentsPage />;
    crumb = 'Environments & keys';
  } else content = <ExperimentsPage />;

  return (
    <EnvContext.Provider value={{ env, setEnv, environments, reloadEnvironments: () => void loadEnvs() }}>
      <ToastProvider>
        <div className="app">
          <aside className="sidebar">
            <div className="brand">
              <Logo />
              Forkcast
              <small>v0.1</small>
            </div>
            <nav className="nav" aria-label="Main">
              {nav.map((n) => (
                <a key={n.href} href={n.href} className={n.active ? 'active' : ''}>
                  <Icon name={n.icon} />
                  {n.label}
                </a>
              ))}
              <a href="https://github.com/alikagarwala/forkcast#readme" target="_blank" rel="noreferrer">
                <Icon name="book" />
                Docs
              </a>
            </nav>
            <div className="spacer" />
            <div className="sidebar-foot">
              <label className="small muted" htmlFor="actor">
                Your name (for the audit log)
              </label>
              <input
                id="actor"
                className="input"
                style={{ height: 30 }}
                value={actor}
                onChange={(e) => {
                  setActor(e.target.value);
                  session.actor = e.target.value;
                }}
              />
              <ThemeToggle />
            </div>
          </aside>
          <div className="main">
            <header className="topbar">
              <div className="crumbs">{crumb}</div>
              <div className="seg" role="tablist" aria-label="Environment">
                {environments.map((e) => (
                  <button key={e.key} role="tab" aria-selected={env === e.key} className={env === e.key ? 'on' : ''} onClick={() => setEnv(e.key)}>
                    <span className="env-dot" style={{ background: envColor(e.key) }} />
                    {e.name}
                  </button>
                ))}
              </div>
            </header>
            <main className="content">{content}</main>
          </div>
        </div>
      </ToastProvider>
    </EnvContext.Provider>
  );
}
