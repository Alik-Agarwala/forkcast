import { useEffect, useState } from 'react';
import { api, type EnvironmentStatus, type Experiment } from '../api';
import { navigate, useEnv } from '../App';
import { CopyButton, envColor, fmt, Icon, Modal, startTraffic, StatusPill, TypeTag, useData, useToast, variantColor } from '../components/ui';
import { IntegrateTab } from './Integrate';
import { ResultsTab } from './Results';
import { SetupTab, TargetingTab } from './Setup';

type Tab = 'results' | 'setup' | 'targeting' | 'integrate' | 'history';

function RolloutControl({ exp, onChange }: { exp: Experiment; onChange: (e: Experiment) => void }) {
  const { env, environments } = useEnv();
  const toast = useToast();
  const settings = exp.environments[env] ?? { status: 'off' as const, traffic: 0 };
  const [traffic, setTraffic] = useState(settings.traffic);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const envName = environments.find((e) => e.key === env)?.name ?? env;
  useEffect(() => setTraffic(settings.traffic), [settings.traffic, env]);

  async function patch(p: { status?: EnvironmentStatus; traffic?: number; launchedVariant?: string }, message: string) {
    setBusy(true);
    try {
      onChange(await api.setEnv(exp.key, env, p));
      toast(message);
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const status = settings.status;
  return (
    <div className="card">
      <div className="card-head">
        <span className="env-dot" style={{ background: envColor(env) }} />
        <h2>Rollout in {envName}</h2>
        <StatusPill status={status} archived={exp.archived} />
      </div>
      <div className="card-pad stack">
        <div className="row" style={{ gap: 8 }}>
          <div className="seg" role="radiogroup" aria-label="Status">
            <button role="radio" aria-checked={status === 'off'} className={status === 'off' ? 'on' : ''} disabled={busy || exp.archived} onClick={() => patch({ status: 'off' }, `Turned off in ${envName}. Everyone gets C.`)}>
              <Icon name="power" size={14} /> Off
            </button>
            <button
              role="radio"
              aria-checked={status === 'running'}
              className={status === 'running' ? 'on' : ''}
              disabled={busy || exp.archived}
              onClick={() => {
                const t = startTraffic(env, traffic);
                void patch({ status: 'running', traffic: t }, `Running in ${envName} for ${t}% of users`);
              }}
            >
              <span className="env-dot" style={{ background: 'var(--good)' }} /> Running
            </button>
            <button role="radio" aria-checked={status === 'launched'} className={status === 'launched' ? 'on' : ''} disabled={busy || exp.archived} onClick={() => setLaunchOpen(true)}>
              <Icon name="rocket" size={14} /> Launched
            </button>
          </div>
          {status !== 'off' && !exp.archived && (
            <button className="btn btn-danger-solid right" disabled={busy} onClick={() => patch({ status: 'off' }, `Kill switch: ${exp.key} is off in ${envName}`)}>
              <Icon name="power" size={14} /> Kill switch
            </button>
          )}
        </div>

        {status === 'running' && (
          <div className="field">
            <label htmlFor="traffic">
              Traffic: <span className="tnum">{traffic}%</span> of eligible users enter the experiment
            </label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                id="traffic"
                className="slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={traffic}
                onChange={(e) => setTraffic(Number(e.target.value))}
                onPointerUp={() => traffic !== settings.traffic && patch({ traffic }, `Traffic set to ${traffic}%`)}
                onKeyUp={() => traffic !== settings.traffic && patch({ traffic }, `Traffic set to ${traffic}%`)}
              />
              {[1, 5, 10, 25, 50, 100].map((t) => (
                <button key={t} className={`btn btn-sm ${settings.traffic === t ? 'btn-primary' : ''}`} disabled={busy} onClick={() => (setTraffic(t), patch({ traffic: t }, `Traffic set to ${t}%`))}>
                  {t}%
                </button>
              ))}
            </div>
            <span className="hint">Users outside the traffic always get C and are not counted. Raising traffic never moves existing users to another treatment.</span>
          </div>
        )}
        {status === 'launched' && (
          <div className="banner banner-neutral">
            <span className="icon">
              <Icon name="rocket" />
            </span>
            <div>
              <strong>
                Everyone in {envName} gets {settings.launchedVariant}
                {exp.variants.find((v) => v.key === settings.launchedVariant)?.name ? ` · ${exp.variants.find((v) => v.key === settings.launchedVariant)?.name}` : ''}
              </strong>
              <span className="text-2">Exposures are no longer recorded. Once the code path is cleaned up you can archive this experiment.</span>
            </div>
          </div>
        )}
        {status === 'off' && <p className="text-2">Off: every user gets <b>C</b> (the control). Turn it on to start bucketing users.</p>}

        <div className="table-wrap">
          <table className="table" aria-label="All environments">
            <thead>
              <tr>
                <th>Environment</th>
                <th>Status</th>
                <th className="num">Traffic</th>
              </tr>
            </thead>
            <tbody>
              {environments.map((e) => {
                const s = exp.environments[e.key];
                return (
                  <tr key={e.key}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <span className="env-dot" style={{ background: envColor(e.key) }} />
                        {e.name}
                      </span>
                    </td>
                    <td>
                      <StatusPill status={s?.status} />
                      {s?.status === 'launched' && <span className="small muted"> {s.launchedVariant}</span>}
                    </td>
                    <td className="num">{s?.status === 'running' ? `${s.traffic}%` : s?.status === 'launched' ? '100%' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {launchOpen && (
        <Modal title={`Launch in ${envName}`} onClose={() => setLaunchOpen(false)}>
          <p className="text-2">Pick the treatment every user should get. This ends the experiment in {envName}.</p>
          {exp.variants.map((v) => (
            <button
              key={v.key}
              className="btn"
              style={{ justifyContent: 'flex-start', height: 44 }}
              onClick={() => {
                setLaunchOpen(false);
                void patch({ status: 'launched', launchedVariant: v.key }, `Launched ${v.key} to everyone in ${envName}`);
              }}
            >
              <i className="swatch" style={{ background: variantColor(exp, v.key) }} />
              <b>{v.key}</b> {v.name}
            </button>
          ))}
        </Modal>
      )}
    </div>
  );
}

function HistoryTab({ expKey }: { expKey: string }) {
  const { data } = useData(() => api.audit(expKey), [expKey], 10000);
  return (
    <div className="card">
      {data && data.length === 0 && <div className="empty">No changes recorded yet.</div>}
      <ul className="timeline">
        {data?.map((a) => (
          <li key={a.id}>
            <span className="small muted" title={new Date(a.ts).toLocaleString()}>
              {fmt.ago(a.ts)}
            </span>
            <span>
              <b>{a.actor}</b> <span className="tag">{a.action}</span>
              {a.environment && (
                <span className="small text-2">
                  {' '}
                  in <span className="env-dot" style={{ background: envColor(a.environment) }} /> {a.environment}
                </span>
              )}
              {a.detail && <div className="small text-2">{a.detail}</div>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExperimentPage({ expKey }: { expKey: string }) {
  const { env } = useEnv();
  const toast = useToast();
  const { data: exp, error, setData } = useData(() => api.experiment(expKey), [expKey]);
  const [tab, setTab] = useState<Tab>('results');

  if (error) {
    return (
      <div className="card empty">
        <h3>Could not load “{expKey}”</h3>
        <p>{error.message}</p>
        <a className="btn" href="#/">
          Back to experiments
        </a>
      </div>
    );
  }
  if (!exp) return <p className="muted">Loading…</p>;

  const tabs: Array<[Tab, string]> = [
    ['results', 'Results'],
    ['setup', 'Setup'],
    ['targeting', 'Targeting'],
    ['integrate', 'Integrate'],
    ['history', 'History'],
  ];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 8 }}>
        <a href="#/" className="small row" style={{ gap: 4 }}>
          <Icon name="back" size={14} /> All experiments
        </a>
        <div className="row">
          <h1>{exp.name}</h1>
          <TypeTag type={exp.type} />
          {exp.archived && <StatusPill archived />}
        </div>
        <div className="row small text-2">
          <code>{exp.key}</code>
          <CopyButton text={exp.key} label="Copy key" />
          {exp.owner && <span>· Owner {exp.owner}</span>}
          {exp.updatedAt && <span>· Updated {fmt.ago(exp.updatedAt)}</span>}
          {(exp.tags ?? []).map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
        {exp.description && <p className="text-2" style={{ maxWidth: 760 }}>{exp.description}</p>}
        {exp.hypothesis && (
          <p className="small text-2" style={{ maxWidth: 760 }}>
            <b>Hypothesis:</b> {exp.hypothesis}
          </p>
        )}
      </div>

      <RolloutControl exp={exp} onChange={setData} />

      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'results' && <ResultsTab exp={exp} env={env} />}
      {tab === 'setup' && (
        <SetupTab
          exp={exp}
          onSaved={setData}
          onArchive={async (archived) => {
            setData(await api.archive(exp.key, archived));
            toast(archived ? 'Archived. It now returns C everywhere.' : 'Restored');
          }}
          onDelete={async () => {
            await api.remove(exp.key);
            toast(`Deleted ${exp.key}`);
            navigate('/');
          }}
        />
      )}
      {tab === 'targeting' && <TargetingTab exp={exp} onSaved={setData} />}
      {tab === 'integrate' && <IntegrateTab exp={exp} />}
      {tab === 'history' && <HistoryTab expKey={exp.key} />}
    </div>
  );
}
