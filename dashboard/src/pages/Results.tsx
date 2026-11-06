import { useState } from 'react';
import { api, type Experiment, type ExperimentResults } from '../api';
import { useEnv } from '../App';
import { CiBar, LineChart, SplitBar } from '../components/charts';
import { fmt, Icon, useData, useToast, variantColor } from '../components/ui';

function VerdictBanner({ r }: { r: ExperimentResults }) {
  const v = r.verdict;
  const map = {
    winner: ['banner-good', 'trophy', 'Winner found'],
    loser: ['banner-critical', 'arrowDown', 'Treatments are underperforming'],
    srm: ['banner-critical', 'alert', 'Sample ratio mismatch'],
    no_difference: ['banner-neutral', 'minus', 'No significant difference yet'],
    collecting: ['banner-warning', 'clock', 'Collecting data'],
    not_started: ['banner-neutral', 'info', 'No data yet'],
    rollout: ['banner-neutral', 'users', 'Gradual rollout'],
  } as const;
  const [cls, icon, title] = map[v.status];
  return (
    <div className={`banner ${cls}`} role="status">
      <span className="icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <span className="text-2">{v.message}</span>
      </div>
    </div>
  );
}

export function ResultsTab({ exp, env }: { exp: Experiment; env: string }) {
  const { environments } = useEnv();
  const toast = useToast();
  const { data: r, reload } = useData(() => api.results(exp.key, env), [exp.key, env], 5000);
  const [metricName, setMetricName] = useState<string>();
  const envName = environments.find((e) => e.key === env)?.name ?? env;

  if (!r) return <p className="muted">Loading results…</p>;

  const metric = r.metrics.find((m) => m.name === metricName) ?? r.metrics[0];
  const treatments = metric?.variants.filter((v) => v.key !== 'C' && v.test) ?? [];
  const domain = Math.max(0.1, ...treatments.flatMap((v) => [Math.abs(v.test!.liftLow), Math.abs(v.test!.liftHigh)])) * 1.1;
  const color = (k: string) => variantColor(exp, k);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <VerdictBanner r={r} />

      <div className="grid-4">
        <div className="card stat">
          <span className="label">Users in experiment</span>
          <span className="value">{fmt.int(r.totalUsers)}</span>
          <span className="sub">{fmt.int(r.totalExposures)} exposures in {envName}</span>
        </div>
        {r.variants.slice(0, 3).map((v) => (
          <div className="card stat" key={v.key}>
            <span className="label row" style={{ gap: 6 }}>
              <i className="swatch" style={{ background: color(v.key) }} />
              {v.key} · {v.name}
            </span>
            <span className="value">{fmt.int(v.users)}</span>
            <span className="sub">
              {fmt.pct(v.share)} of users · expected {fmt.pct(v.expectedShare, 0)}
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <h2>Metrics</h2>
          {r.metrics.length > 1 && (
            <select className="select" style={{ width: 'auto' }} value={metric?.name} onChange={(e) => setMetricName(e.target.value)} aria-label="Metric">
              {r.metrics.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.primary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {!metric ? (
          <div className="empty">
            <Icon name="activity" size={24} />
            <h3>No conversion events yet</h3>
            <p>
              Call <code>forkcast.track('purchase', {'{ value: 49 }'})</code> in your app. Conversions are attributed to the treatment each user saw.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Treatment</th>
                  <th className="num">Users</th>
                  <th className="num">Converted</th>
                  <th className="num">Conv. rate</th>
                  <th className="num">Lift vs C</th>
                  <th>95% confidence</th>
                  <th className="num">p-value</th>
                  {metric.hasValue && <th className="num">Value / user</th>}
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {metric.variants.map((v) => {
                  const name = exp.variants.find((x) => x.key === v.key)?.name;
                  const up = v.test && v.test.lift > 0;
                  return (
                    <tr key={v.key}>
                      <td>
                        <span className="row nowrap" style={{ gap: 8 }}>
                          <i className="swatch" style={{ background: color(v.key) }} />
                          <b>{v.key}</b>
                          <span className="text-2">{name}</span>
                        </span>
                      </td>
                      <td className="num">{fmt.int(v.users)}</td>
                      <td className="num">{fmt.int(v.conversions)}</td>
                      <td className="num">{fmt.pct(v.rate, 2)}</td>
                      <td className="num">{v.key === 'C' ? <span className="muted">baseline</span> : v.test ? <b>{fmt.lift(v.test.lift)}</b> : '—'}</td>
                      <td>{v.test ? <CiBar low={v.test.liftLow} high={v.test.liftHigh} point={v.test.lift} color={color(v.key)} domain={domain} /> : null}</td>
                      <td className="num">{v.test ? fmt.p(v.test.pValue) : '—'}</td>
                      {metric.hasValue && (
                        <td className="num">
                          {fmt.money(v.valuePerUser)}
                          {v.valueTest && <div className="small muted">{fmt.lift(v.valueTest.lift)}</div>}
                        </td>
                      )}
                      <td>
                        {v.key === 'C' ? (
                          <span className="badge badge-neutral">Control</span>
                        ) : v.significant ? (
                          <span className={`badge ${up ? 'badge-good' : 'badge-bad'}`}>
                            <Icon name={up ? 'arrowUp' : 'arrowDown'} size={14} />
                            {up ? 'Significant win' : 'Significant loss'}
                          </span>
                        ) : (
                          <span className="badge badge-neutral">
                            <Icon name="minus" size={14} />
                            Not significant
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Users enrolled over time</h2>
            <span className="small muted">cumulative</span>
          </div>
          <div className="card-pad">
            {r.timeseries.length ? (
              <LineChart
                ariaLabel="Cumulative users per treatment"
                labels={r.timeseries.map((t) => t.date)}
                series={r.variants.map((v) => ({ key: v.key, label: `${v.key} · ${v.name}`, color: color(v.key), values: r.timeseries.map((t) => t.cumulative[v.key] ?? 0) }))}
              />
            ) : (
              <div className="empty">No exposures yet.</div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Users by country</h2>
            <span className="small muted">split by treatment</span>
          </div>
          {r.breakdowns.country?.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {r.breakdowns.country.slice(0, 8).map((c) => (
                    <tr key={c.value}>
                      <td style={{ width: 60 }}>
                        <b>{c.value}</b>
                      </td>
                      <td style={{ width: '100%' }}>
                        <SplitBar
                          title={c.value}
                          total={c.users}
                          parts={r.variants.map((v) => ({ key: v.key, label: v.key, value: c.byVariant[v.key] ?? 0, color: color(v.key) }))}
                        />
                      </td>
                      <td className="num">{fmt.int(c.users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty small">
              Pass <code>country</code> on the user context to see a geographic breakdown.
            </div>
          )}
        </div>
      </div>

      <div className="card card-pad row">
        <div>
          <h3>Sample ratio check</h3>
          <p className="small text-2">
            χ² = {r.srm.chiSquare.toFixed(2)}, p = {fmt.p(r.srm.pValue)}.{' '}
            {r.srm.ok ? 'The observed split matches the configured weights.' : 'The split does not match the weights. Look for redirects, caching or bot traffic affecting one treatment.'}
          </p>
        </div>
        <button
          className="btn btn-danger right"
          onClick={async () => {
            if (!confirm(`Clear all collected results for ${exp.key} in ${envName}? Users keep their treatments.`)) return;
            await api.reset(exp.key, env);
            toast('Results cleared');
            reload();
          }}
        >
          <Icon name="refresh" size={14} /> Reset results
        </button>
      </div>
    </div>
  );
}
