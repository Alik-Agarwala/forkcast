import { useState } from 'react';
import { api } from '../api';
import { envColor, fmt, useData } from '../components/ui';

export function ActivityPage() {
  const { data } = useData(() => api.audit(), [], 10000);
  const [q, setQ] = useState('');
  const rows = (data ?? []).filter((a) => !q || [a.actor, a.action, a.experiment, a.environment, a.detail].some((x) => x?.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row">
        <div>
          <h1>Activity</h1>
          <p className="text-2">Every change to every experiment: who did it, when, and in which environment.</p>
        </div>
        <input className="input right" style={{ maxWidth: 260 }} placeholder="Filter by person, action, key…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter activity" />
      </div>
      <div className="card">
        {data && rows.length === 0 && <div className="empty">No activity yet.</div>}
        <ul className="timeline">
          {rows.map((a) => (
            <li key={a.id}>
              <span className="small muted" title={new Date(a.ts).toLocaleString()}>
                {new Date(a.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                <br />
                {fmt.ago(a.ts)}
              </span>
              <span>
                <b>{a.actor}</b> <span className="tag">{a.action}</span>{' '}
                {a.experiment && <a href={`#/e/${encodeURIComponent(a.experiment)}`} className="mono">{a.experiment}</a>}
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
    </div>
  );
}
