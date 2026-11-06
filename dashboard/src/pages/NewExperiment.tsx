import { useState } from 'react';
import type { Variant } from '../../../src/core/types';
import { api, ApiError } from '../api';
import { navigate } from '../App';
import { Icon, useToast } from '../components/ui';
import { VariantsEditor } from './Setup';

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

const PRESETS: Record<string, Variant[]> = {
  flag: [
    { key: 'C', name: 'Off', weight: 0 },
    { key: 'T1', name: 'On', weight: 100 },
  ],
  ab: [
    { key: 'C', name: 'Control', weight: 50 },
    { key: 'T1', name: 'Treatment 1', weight: 50 },
  ],
  abc: [
    { key: 'C', name: 'Control', weight: 34 },
    { key: 'T1', name: 'Treatment 1', weight: 33 },
    { key: 'T2', name: 'Treatment 2', weight: 33 },
  ],
};

export function NewExperimentPage() {
  const toast = useToast();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<'experiment' | 'flag'>('experiment');
  const [variants, setVariants] = useState<Variant[]>(PRESETS.ab);
  const [metric, setMetric] = useState('');
  const [description, setDescription] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [error, setError] = useState<ApiError | Error>();
  const [busy, setBusy] = useState(false);

  const finalKey = keyTouched ? key : slugify(name);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const exp = await api.create({
        key: finalKey,
        name: name.trim(),
        type,
        variants,
        description: description || undefined,
        hypothesis: hypothesis || undefined,
        metrics: metric.split(',').map((m) => m.trim()).filter(Boolean),
      });
      toast(`Created ${exp.key}. It is off everywhere until you turn it on.`);
      navigate(`/e/${encodeURIComponent(exp.key)}`);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 20, maxWidth: 860 }} onSubmit={create}>
      <div>
        <a href="#/" className="small row" style={{ gap: 4 }}>
          <Icon name="back" size={14} /> All experiments
        </a>
        <h1 style={{ marginTop: 8 }}>New experiment</h1>
        <p className="text-2">It starts off in every environment, so creating it never changes what users see.</p>
      </div>

      {error && (
        <div className="banner banner-critical" role="alert">
          <span className="icon">
            <Icon name="alert" />
          </span>
          <div>
            <strong>{error.message}</strong>
            {error instanceof ApiError && error.details?.map((d) => <div key={d} className="small">{d}</div>)}
          </div>
        </div>
      )}

      <div className="grid-2">
        {(
          [
            ['experiment', 'flask', 'A/B test', 'Compare C against one or more treatments and measure a metric.'],
            ['flag', 'flag', 'Feature flag', 'Ship code dark, roll it out gradually, kill it with one click.'],
          ] as const
        ).map(([t, icon, title, text]) => (
          <button
            type="button"
            key={t}
            className="card card-pad"
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: type === t ? 'var(--accent)' : undefined, boxShadow: type === t ? '0 0 0 3px var(--accent-soft)' : undefined }}
            onClick={() => {
              setType(t);
              setVariants(t === 'flag' ? PRESETS.flag : PRESETS.ab);
            }}
            aria-pressed={type === t}
          >
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <Icon name={icon} />
              <h3>{title}</h3>
            </div>
            <p className="small text-2">{text}</p>
          </button>
        ))}
      </div>

      <div className="card card-pad stack">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" required autoFocus placeholder="New checkout flow" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="key">Key (used in code)</label>
            <input
              id="key"
              className="input mono"
              required
              placeholder="new-checkout-flow"
              value={finalKey}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(slugify(e.target.value));
              }}
            />
            <span className="hint">Lowercase letters, digits, dashes. Cannot be changed later.</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea id="description" className="textarea" placeholder="What changes for the user?" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {type === 'experiment' && (
          <div className="grid-2">
            <div className="field">
              <label htmlFor="hypothesis">Hypothesis</label>
              <input id="hypothesis" className="input" placeholder="One-click checkout increases purchases" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="metric">Primary metric</label>
              <input id="metric" className="input mono" placeholder="purchase" value={metric} onChange={(e) => setMetric(e.target.value)} />
              <span className="hint">The event name you send with track(). Add more separated by commas.</span>
            </div>
          </div>
        )}
      </div>

      <div className="card card-pad stack">
        <div className="row">
          <h2 style={{ flex: 1 }}>Treatments</h2>
          {type === 'experiment' && (
            <div className="seg">
              <button type="button" className={variants.length === 2 ? 'on' : ''} onClick={() => setVariants(PRESETS.ab)}>
                C / T1
              </button>
              <button type="button" className={variants.length === 3 ? 'on' : ''} onClick={() => setVariants(PRESETS.abc)}>
                C / T1 / T2
              </button>
            </div>
          )}
        </div>
        <p className="small text-2">
          {type === 'flag'
            ? 'For flags, T1 = on. Weight 100 on T1 means everyone inside the traffic % gets the feature; use traffic to roll out gradually.'
            : 'Weights split users inside the experiment. Traffic (set per environment after creating) decides how many users enter at all.'}
        </p>
        <VariantsEditor exp={{ variants }} variants={variants} onChange={setVariants} />
      </div>

      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim() || !finalKey}>
          Create {type === 'flag' ? 'flag' : 'experiment'}
        </button>
        <a className="btn btn-ghost" href="#/">
          Cancel
        </a>
      </div>
    </form>
  );
}
