import { useMemo, useState } from 'react';
import { api, type ExperimentSummary } from '../api';
import { navigate, useEnv } from '../App';
import { Bars, Sparkline } from '../components/charts';
import { fmt, Icon, startTraffic, StatusPill, Switch, TypeTag, useData, useToast, variantColor } from '../components/ui';

type Filter = 'all' | 'running' | 'launched' | 'off' | 'archived';

export function VerdictBadge({ exp }: { exp: ExperimentSummary }) {
  const v = exp.results.verdict;
  if (!exp.results.srmOk) {
    return (
      <span className="badge badge-bad">
        <Icon name="alert" size={14} />
        SRM check failed
      </span>
    );
  }
  if (v.status === 'winner') {
    return (
      <span className="badge badge-good">
        <Icon name="trophy" size={14} />
        {v.variant} {fmt.lift(v.lift ?? 0)}
      </span>
    );
  }
  if (v.status === 'loser') {
    return (
      <span className="badge badge-bad">
        <Icon name="arrowDown" size={14} />
        {v.variant} {fmt.lift(v.lift ?? 0)}
      </span>
    );
  }
  if (v.status === 'no_difference') {
    return (
      <span className="badge badge-neutral">
        <Icon name="minus" size={14} />
        No significant difference
      </span>
    );
  }
  if (v.status === 'rollout') {
    return (
      <span className="badge badge-neutral">
        <Icon name="users" size={14} />
        Rolling out
      </span>
    );
  }
  if (v.status === 'collecting') {
    return (
      <span className="badge badge-neutral">
        <Icon name="clock" size={14} />
        Collecting data
      </span>
    );
  }
  return <span className="badge badge-neutral">—</span>;
}

export function SplitPreview({ exp }: { exp: ExperimentSummary }) {
  const total = exp.variants.reduce((s, v) => s + v.weight, 0) || 1;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="split-bar" role="img" aria-label={exp.variants.map((v) => `${v.key} ${Math.round((v.weight / total) * 100)}%`).join(', ')}>
        {exp.variants.map((v) => (v.weight > 0 ? <span key={v.key} style={{ width: `${(v.weight / total) * 100}%`, background: variantColor(exp, v.key) }} /> : null))}
      </div>
      <div className="small text-2 nowrap">
        {exp.variants.map((v) => `${v.key} ${Math.round((v.weight / total) * 100)}%`).join(' · ')}
      </div>
    </div>
  );
}

export function ExperimentsPage() {
  const { env, environments } = useEnv();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useData(() => api.experiments(env), [env], 5000);
  const overview = useData(() => api.overview(env), [env], 5000);
  const envName = environments.find((e) => e.key === env)?.name ?? env;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? [])
      .filter((e) => {
        const status = e.environments[env]?.status ?? 'off';
        if (filter === 'archived') return e.archived;
        if (e.archived) return false;
        if (filter !== 'all' && status !== filter) return false;
        return !q || e.key.includes(q) || e.name.toLowerCase().includes(q) || (e.tags ?? []).some((t) => t.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const rank = { running: 0, launched: 1, off: 2 } as const;
        const ra = rank[a.environments[env]?.status ?? 'off'];
        const rb = rank[b.environments[env]?.status ?? 'off'];
        return ra - rb || b.results.totalUsers - a.results.totalUsers || a.name.localeCompare(b.name);
      });
  }, [list.data, query, filter, env]);

  async function toggle(exp: ExperimentSummary, on: boolean) {
    const current = exp.environments[env];
    const status = on ? 'running' : 'off';
    list.setData((all) => all?.map((e) => (e.key === exp.key ? { ...e, environments: { ...e.environments, [env]: { ...(current ?? { traffic: 0 }), status } } } : e)));
    try {
      const traffic = on ? startTraffic(env, current?.traffic) : current?.traffic;
      await api.setEnv(exp.key, env, { status, traffic });
      toast(on ? `${exp.key} is running in ${envName} for ${traffic}% of users` : `${exp.key} is off in ${envName}`);
    } catch (err) {
      toast((err as Error).message, true);
    }
    list.reload();
    overview.reload();
  }

  const o = overview.data;
  const days = o?.days ?? [];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row">
        <div>
          <h1>Experiments</h1>
          <p className="text-2">Feature flags and A/B tests in {envName}. Toggle one to turn it on or off instantly; connected apps update in real time.</p>
        </div>
        <a className="btn btn-primary right" href="#/new">
          <Icon name="plus" />
          New experiment
        </a>
      </div>

      <div className="grid-4">
        <div className="card stat">
          <span className="label">Running</span>
          <span className="value">{o?.counts.running ?? '–'}</span>
          <span className="sub">
            {o?.counts.launched ?? 0} launched · {o?.counts.off ?? 0} off
          </span>
        </div>
        <div className="card stat">
          <span className="label">Users enrolled</span>
          <span className="value">{o ? fmt.int(o.enrolledUsers) : '–'}</span>
          <span className="sub">across all experiments</span>
        </div>
        <div className="card stat">
          <span className="label">New enrolments · 14 days</span>
          <Bars labels={days.map((d) => d.date)} values={days.map((d) => d.users)} height={58} ariaLabel="Users enrolled" />
        </div>
        <div className="card stat">
          <span className="label">Events today</span>
          <span className="value">{o ? fmt.int(o.eventsToday) : '–'}</span>
          <span className="sub">{o?.topEvents.slice(0, 3).map((e) => e.name).join(', ') || 'Call track() to send events'}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="seg" role="tablist" aria-label="Filter by status">
            {(['all', 'running', 'launched', 'off', 'archived'] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="row right" style={{ position: 'relative', minWidth: 220 }}>
            <span style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted)' }}>
              <Icon name="search" size={15} />
            </span>
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search name, key or tag" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search experiments" />
          </div>
        </div>

        {list.error && <div className="empty error-text">{list.error.message}</div>}
        {list.data && rows.length === 0 && (
          <div className="empty">
            <Icon name="flask" size={28} />
            <h3>{list.data.length ? 'Nothing matches' : 'No experiments yet'}</h3>
            <p>{list.data.length ? 'Try another filter.' : 'Create a feature flag or A/B test, then read it from your app with getTreatment().'}</p>
            {!list.data.length && (
              <a className="btn btn-primary" href="#/new">
                <Icon name="plus" /> New experiment
              </a>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>On</th>
                  <th>Experiment</th>
                  <th>Status</th>
                  <th className="num">Traffic</th>
                  <th>Split</th>
                  <th className="num">Users</th>
                  <th>Trend · 14d</th>
                  <th>Result{' '}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const s = e.environments[env];
                  const status = s?.status ?? 'off';
                  return (
                    <tr key={e.key} className="clickable" onClick={() => navigate(`/e/${encodeURIComponent(e.key)}`)}>
                      <td>
                        <Switch on={status !== 'off'} launched={status === 'launched'} disabled={e.archived} onChange={(v) => toggle(e, v)} label={`Turn ${e.key} ${status === 'off' ? 'on' : 'off'} in ${envName}`} />
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <strong>{e.name}</strong>
                          <TypeTag type={e.type} />
                        </div>
                        <div className="mono muted">{e.key}</div>
                      </td>
                      <td>
                        <StatusPill status={status} archived={e.archived} />
                        {status === 'launched' && <div className="small muted">serving {s?.launchedVariant}</div>}
                      </td>
                      <td className="num">{status === 'running' ? `${s?.traffic ?? 0}%` : status === 'launched' ? '100%' : '—'}</td>
                      <td>
                        <SplitPreview exp={e} />
                      </td>
                      <td className="num">{fmt.int(e.results.totalUsers)}</td>
                      <td>
                        <Sparkline values={e.results.spark} label={`${e.key} new users`} />
                      </td>
                      <td>
                        <VerdictBadge exp={e} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
