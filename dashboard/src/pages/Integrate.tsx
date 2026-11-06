import { useState } from 'react';
import type { Experiment } from '../api';
import { useEnv } from '../App';
import { Code, CopyButton, variantColor } from '../components/ui';

export function IntegrateTab({ exp }: { exp: Experiment }) {
  const { env, environments } = useEnv();
  const [lang, setLang] = useState<'react' | 'js' | 'node'>('react');
  const clientKey = environments.find((e) => e.key === env)?.clientKey ?? '<client-key>';
  const apiUrl = location.origin + location.pathname.replace(/\/[^/]*$/, '');
  const treatments = exp.variants.filter((v) => v.key !== 'C');
  const ident = exp.key.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
  const metric = exp.metrics?.[0] ?? 'purchase';

  const snippets = {
    react: `import { createForkcast } from 'forkcast';
import { ForkcastProvider, Experiment, Variant, useTreatment, useTrack } from 'forkcast/react';

const forkcast = createForkcast({
  apiUrl: '${apiUrl}',
  clientKey: '${clientKey}', // ${env}
  user: { id: currentUser.id, country: currentUser.country },
});

// Wrap your app once
<ForkcastProvider client={forkcast}><App /></ForkcastProvider>

// Declarative
<Experiment name="${exp.key}">
  <Variant name="C"><Current /></Variant>
${treatments.map((v) => `  <Variant name="${v.key}"><${v.name ? v.name.replace(/[^a-zA-Z0-9]/g, '') : v.key} /></Variant>`).join('\n')}
</Experiment>

// Or with hooks
const treatment = useTreatment('${exp.key}'); // 'C' | ${treatments.map((v) => `'${v.key}'`).join(' | ')}
const track = useTrack();
track('${metric}', { value: 49.99 });`,
    js: `import { createForkcast } from 'forkcast';

const forkcast = createForkcast({
  apiUrl: '${apiUrl}',
  clientKey: '${clientKey}', // ${env}
  user: { id: user.id, country: user.country },
});
await forkcast.ready();

const ${ident} = forkcast.getTreatment('${exp.key}');
if (${ident} === '${treatments[0]?.key ?? 'T1'}') {
  // new behaviour
} else {
  // C: existing behaviour (also the safe default)
}

forkcast.track('${metric}', { value: 49.99 });`,
    node: `import { createForkcast } from 'forkcast';

// Create once at startup; config stays in sync automatically.
const forkcast = createForkcast({
  apiUrl: '${apiUrl}',
  clientKey: process.env.FORKCAST_CLIENT_KEY, // ${clientKey}
});
await forkcast.ready();

app.get('/checkout', (req, res) => {
  const fc = forkcast.forUser({ id: req.user.id, country: req.headers['cf-ipcountry'] });
  const treatment = fc.getTreatment('${exp.key}');
  res.render(treatment === 'C' ? 'checkout' : 'checkout-v2');
});`,
  };

  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row">
          <h2 style={{ flex: 1 }}>Add it to your code</h2>
          <div className="seg" role="tablist" aria-label="Language">
            {(
              [
                ['react', 'React'],
                ['js', 'JavaScript'],
                ['node', 'Node.js'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={lang === k} className={lang === k ? 'on' : ''} onClick={() => setLang(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <Code>{'npm install forkcast'}</Code>
        <Code>{snippets[lang]}</Code>
      </div>

      <div className="card card-pad stack">
        <div>
          <h2>Preview a treatment (dev & QA)</h2>
          <p className="small text-2">
            In development builds, open your app with one of these query params to force a treatment for yourself. They are ignored in production unless you enable{' '}
            <code>allowOverrides</code>.
          </p>
        </div>
        {exp.variants.map((v) => {
          const q = `?forkcast=${exp.key}:${v.key}`;
          return (
            <div className="row" key={v.key}>
              <i className="swatch" style={{ background: variantColor(exp, v.key) }} />
              <b style={{ width: 28 }}>{v.key}</b>
              <code style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{q}</code>
              <CopyButton text={q} />
            </div>
          );
        })}
        <p className="small muted">
          Use <code>?forkcast=reset</code> to clear overrides, or the floating devtools panel from <code>forkcast/devtools</code>.
        </p>
      </div>
    </div>
  );
}
