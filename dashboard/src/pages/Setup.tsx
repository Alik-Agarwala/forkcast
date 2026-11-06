import { useState } from 'react';
import type { Condition, Operator, Variant } from '../../../src/core/types';
import { api, ApiError, type Experiment } from '../api';
import { Icon, Modal, useToast, variantColor } from '../components/ui';

function Errors({ error }: { error?: ApiError | Error }) {
  if (!error) return null;
  const details = error instanceof ApiError ? error.details : undefined;
  return (
    <div className="banner banner-critical" role="alert">
      <span className="icon">
        <Icon name="alert" />
      </span>
      <div>
        <strong>{error.message}</strong>
        {details?.map((d) => (
          <div key={d} className="small">
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}

export function VariantsEditor({ exp, variants, onChange }: { exp: Pick<Experiment, 'variants'>; variants: Variant[]; onChange: (v: Variant[]) => void }) {
  const total = variants.reduce((s, v) => s + (Number(v.weight) || 0), 0) || 1;
  const update = (i: number, patch: Partial<Variant>) => onChange(variants.map((v, j) => (i === j ? { ...v, ...patch } : v)));
  const [payloadText, setPayloadText] = useState<Record<number, string>>({});
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="split-bar" style={{ height: 10 }} aria-hidden="true">
        {variants.map((v) => (Number(v.weight) > 0 ? <span key={v.key} style={{ width: `${(Number(v.weight) / total) * 100}%`, background: variantColor({ variants }, v.key) }} /> : null))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th className="num">Weight</th>
              <th>Payload (JSON, optional)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={i}>
                <td style={{ width: 90 }}>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <i className="swatch" style={{ background: variantColor(exp, v.key) }} />
                    <input className="input mono" style={{ width: 64 }} value={v.key} disabled={v.key === 'C'} onChange={(e) => update(i, { key: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} aria-label="Variant key" />
                  </div>
                </td>
                <td>
                  <input className="input" value={v.name ?? ''} placeholder={v.key === 'C' ? 'Control' : 'Treatment'} onChange={(e) => update(i, { name: e.target.value })} aria-label="Variant name" />
                </td>
                <td style={{ width: 130 }}>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <input className="input tnum" type="number" min={0} style={{ width: 72 }} value={v.weight} onChange={(e) => update(i, { weight: Math.max(0, Number(e.target.value)) })} aria-label="Weight" />
                    <span className="small muted tnum">{Math.round(((Number(v.weight) || 0) / total) * 100)}%</span>
                  </div>
                </td>
                <td>
                  <input
                    className="input mono"
                    placeholder='{"label": "Buy now"}'
                    value={payloadText[i] ?? (v.payload === undefined ? '' : JSON.stringify(v.payload))}
                    onChange={(e) => {
                      const text = e.target.value;
                      setPayloadText((p) => ({ ...p, [i]: text }));
                      if (!text.trim()) return update(i, { payload: undefined });
                      try {
                        update(i, { payload: JSON.parse(text) });
                      } catch {
                        /* keep typing */
                      }
                    }}
                    aria-label="Payload"
                  />
                </td>
                <td style={{ width: 40 }}>
                  {v.key !== 'C' && variants.length > 2 && (
                    <button className="icon-btn" onClick={() => onChange(variants.filter((_, j) => j !== i))} aria-label={`Remove ${v.key}`}>
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button
          className="btn btn-sm"
          onClick={() => {
            let n = 1;
            while (variants.some((v) => v.key === `T${n}`)) n++;
            onChange([...variants, { key: `T${n}`, name: `Treatment ${n}`, weight: Math.round(total / variants.length) }]);
          }}
        >
          <Icon name="plus" size={14} /> Add treatment
        </button>
      </div>
    </div>
  );
}

export function SetupTab({ exp, onSaved, onArchive, onDelete }: { exp: Experiment; onSaved: (e: Experiment) => void; onArchive: (a: boolean) => Promise<void>; onDelete: () => Promise<void> }) {
  const toast = useToast();
  const [draft, setDraft] = useState({
    name: exp.name,
    description: exp.description ?? '',
    hypothesis: exp.hypothesis ?? '',
    owner: exp.owner ?? '',
    tags: (exp.tags ?? []).join(', '),
    metrics: (exp.metrics ?? []).join(', '),
    salt: exp.salt ?? '',
    variants: exp.variants,
  });
  const [error, setError] = useState<Error>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function save() {
    setError(undefined);
    try {
      const saved = await api.update(exp.key, {
        name: draft.name,
        description: draft.description || undefined,
        hypothesis: draft.hypothesis || undefined,
        owner: draft.owner || undefined,
        tags: list(draft.tags),
        metrics: list(draft.metrics),
        salt: draft.salt || undefined,
        variants: draft.variants,
      });
      onSaved(saved);
      toast('Saved. Connected apps pick up the change immediately.');
    } catch (err) {
      setError(err as Error);
    }
  }

  const weightsChanged = JSON.stringify(draft.variants.map((v) => v.weight)) !== JSON.stringify(exp.variants.map((v) => v.weight));

  return (
    <div className="stack">
      <Errors error={error} />
      <div className="card card-pad stack">
        <h2>Details</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="owner">Owner</label>
            <input id="owner" className="input" value={draft.owner} onChange={(e) => set({ owner: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="desc">Description</label>
          <textarea id="desc" className="textarea" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="hyp">Hypothesis</label>
          <input id="hyp" className="input" placeholder="If we … then … because …" value={draft.hypothesis} onChange={(e) => set({ hypothesis: e.target.value })} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="metrics">Metrics</label>
            <input id="metrics" className="input mono" placeholder="purchase, add_to_cart" value={draft.metrics} onChange={(e) => set({ metrics: e.target.value })} />
            <span className="hint">Event names sent with track(). The first one is the primary metric.</span>
          </div>
          <div className="field">
            <label htmlFor="tags">Tags</label>
            <input id="tags" className="input" placeholder="checkout, q4" value={draft.tags} onChange={(e) => set({ tags: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="card card-pad stack">
        <div>
          <h2>Treatments</h2>
          <p className="small text-2">C is the control: what users get when the experiment is off, missing or the server is unreachable.</p>
        </div>
        <VariantsEditor exp={exp} variants={draft.variants} onChange={(variants) => set({ variants })} />
        {weightsChanged && (
          <div className="banner banner-warning">
            <span className="icon">
              <Icon name="alert" />
            </span>
            <div>
              <strong>Changing weights on a running experiment moves some users between treatments.</strong>
              <span className="text-2 small">Users keep the treatment they were first counted in for results, but what they see changes. Prefer changing traffic.</span>
            </div>
          </div>
        )}
        <details>
          <summary className="small text-2" style={{ cursor: 'pointer' }}>
            Advanced
          </summary>
          <div className="field" style={{ marginTop: 10, maxWidth: 380 }}>
            <label htmlFor="salt">Hashing salt</label>
            <input id="salt" className="input mono" placeholder={exp.key} value={draft.salt} onChange={(e) => set({ salt: e.target.value })} />
            <span className="hint">Changing the salt re-randomises every user. Only do this to restart an experiment from scratch.</span>
          </div>
        </details>
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={save}>
          Save changes
        </button>
      </div>

      <div className="card card-pad stack">
        <h2>Danger zone</h2>
        <div className="row">
          <p className="text-2" style={{ flex: 1, minWidth: 220 }}>
            {exp.archived ? 'Restore this experiment so it can be turned on again.' : 'Archive when the experiment is finished and the code is cleaned up. Archived experiments always return C.'}
          </p>
          <button className="btn" onClick={() => onArchive(!exp.archived)}>
            <Icon name="archive" size={14} /> {exp.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>

      {confirmDelete && (
        <Modal
          title={`Delete ${exp.key}?`}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="btn btn-danger-solid" onClick={onDelete}>
                Delete permanently
              </button>
            </>
          }
        >
          <p>This deletes the experiment and all of its results in every environment. Apps still calling it will get C.</p>
        </Modal>
      )}
    </div>
  );
}

const OPS: Array<[Operator, string]> = [
  ['eq', 'equals'],
  ['neq', 'does not equal'],
  ['in', 'is one of'],
  ['notIn', 'is not one of'],
  ['contains', 'contains'],
  ['notContains', 'does not contain'],
  ['startsWith', 'starts with'],
  ['endsWith', 'ends with'],
  ['gt', '>'],
  ['gte', '≥'],
  ['lt', '<'],
  ['lte', '≤'],
  ['regex', 'matches regex'],
  ['semverGte', 'version ≥'],
  ['semverLt', 'version <'],
  ['exists', 'is set'],
  ['notExists', 'is not set'],
];

function valueToText(v: Condition['value']): string {
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
}

export function TargetingTab({ exp, onSaved }: { exp: Experiment; onSaved: (e: Experiment) => void }) {
  const toast = useToast();
  const [match, setMatch] = useState<'all' | 'any'>(exp.audience?.match ?? 'all');
  const [rows, setRows] = useState(() => (exp.audience?.conditions ?? []).map((c) => ({ attribute: c.attribute, operator: c.operator, text: valueToText(c.value) })));
  const [forced, setForced] = useState<Record<string, string>>(() => Object.fromEntries(exp.variants.map((v) => [v.key, (exp.forced?.find((f) => f.variant === v.key)?.userIds ?? []).join('\n')])));
  const [error, setError] = useState<Error>();

  async function save() {
    setError(undefined);
    const conditions: Condition[] = rows
      .filter((r) => r.attribute.trim())
      .map((r) => {
        const list = r.operator === 'in' || r.operator === 'notIn';
        const numeric = ['gt', 'gte', 'lt', 'lte'].includes(r.operator);
        const value = r.operator === 'exists' || r.operator === 'notExists' ? undefined : list ? r.text.split(',').map((s) => s.trim()).filter(Boolean) : numeric ? Number(r.text) : r.text;
        return { attribute: r.attribute.trim(), operator: r.operator, value };
      });
    const forcedList = Object.entries(forced)
      .map(([variant, text]) => ({ variant, userIds: text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) }))
      .filter((f) => f.userIds.length);
    try {
      onSaved(await api.update(exp.key, { audience: conditions.length ? { match, conditions } : undefined, forced: forcedList }));
      toast('Targeting saved');
    } catch (err) {
      setError(err as Error);
    }
  }

  return (
    <div className="stack">
      <Errors error={error} />
      <div className="card card-pad stack">
        <div>
          <h2>Audience</h2>
          <p className="small text-2">
            Only users matching these rules can enter the experiment. Everyone else gets C. Attributes come from the user context you pass to the SDK, e.g.{' '}
            <code>{'{ id, country, plan, appVersion }'}</code>.
          </p>
        </div>
        <div className="row small">
          Users must match
          <select className="select" style={{ width: 'auto', height: 30 }} value={match} onChange={(e) => setMatch(e.target.value as 'all' | 'any')} aria-label="Match mode">
            <option value="all">all conditions</option>
            <option value="any">any condition</option>
          </select>
        </div>
        <datalist id="attrs">
          {['country', 'platform', 'device', 'browser', 'plan', 'appVersion', 'email', 'language', 'id'].map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        {rows.length === 0 && <p className="muted small">No conditions: everyone is eligible.</p>}
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input mono" list="attrs" placeholder="attribute" style={{ maxWidth: 170 }} value={r.attribute} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, attribute: e.target.value } : x)))} aria-label="Attribute" />
            <select className="select" style={{ maxWidth: 170 }} value={r.operator} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, operator: e.target.value as Operator } : x)))} aria-label="Operator">
              {OPS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {r.operator !== 'exists' && r.operator !== 'notExists' && (
              <input className="input" placeholder={r.operator === 'in' || r.operator === 'notIn' ? 'US, IN, GB' : 'value'} value={r.text} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label="Value" />
            )}
            <button className="icon-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove condition">
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
        <div className="row">
          <button className="btn btn-sm" onClick={() => setRows([...rows, { attribute: 'country', operator: 'in', text: '' }])}>
            <Icon name="plus" size={14} /> Add condition
          </button>
        </div>
      </div>

      <div className="card card-pad stack">
        <div>
          <h2>Forced users</h2>
          <p className="small text-2">Pin specific user ids to a treatment (QA, dogfooding, demos). Forced users are not counted in results. One id per line.</p>
        </div>
        <div className="grid-2">
          {exp.variants.map((v) => (
            <div className="field" key={v.key}>
              <label className="row" style={{ gap: 6 }}>
                <i className="swatch" style={{ background: variantColor(exp, v.key) }} />
                {v.key} {v.name && <span className="muted">· {v.name}</span>}
              </label>
              <textarea className="textarea mono" rows={3} value={forced[v.key] ?? ''} onChange={(e) => setForced({ ...forced, [v.key]: e.target.value })} />
            </div>
          ))}
        </div>
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={save}>
          Save targeting
        </button>
      </div>
    </div>
  );
}
