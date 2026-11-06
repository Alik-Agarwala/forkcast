import { useRef, useState } from 'react';
import { api, type ForkcastConfig } from '../api';
import { useEnv } from '../App';
import { Code, CopyButton, envColor, Icon, Modal, useToast } from '../components/ui';

export function EnvironmentsPage() {
  const { environments, reloadEnvironments } = useEnv();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rotate, setRotate] = useState<string>();
  const origin = location.origin + location.pathname.replace(/\/[^/]*$/, '');

  async function download() {
    const config = await api.exportConfig();
    const blob = new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'forkcast.config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(file: File) {
    try {
      const config = JSON.parse(await file.text()) as ForkcastConfig;
      const res = await api.importConfig(config);
      toast(`Imported ${res.imported} experiments`);
    } catch (err) {
      toast((err as Error).message, true);
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1>Environments & keys</h1>
        <p className="text-2">
          Each environment has its own on/off state and traffic for every experiment, and its own public client key. Use the development key while building, production in your
          deployed app.
        </p>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {environments.map((e) => (
          <div className="card" key={e.key}>
            <div className="card-head">
              <span className="env-dot" style={{ background: envColor(e.key) }} />
              <h2>{e.name}</h2>
              <code className="muted">{e.key}</code>
            </div>
            <div className="card-pad stack" style={{ gap: 10 }}>
              <label className="small text-2">Client key (public, safe in frontend bundles)</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <code className="input" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.clientKey}
                </code>
                <CopyButton text={e.clientKey} />
              </div>
              <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setRotate(e.key)}>
                <Icon name="refresh" size={14} /> Rotate key
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card card-pad stack">
        <h2>Quick start</h2>
        <Code>{`npm install forkcast`}</Code>
        <Code>{`import { createForkcast } from 'forkcast';

const forkcast = createForkcast({
  apiUrl: '${origin}',
  clientKey: import.meta.env.DEV
    ? '${environments.find((e) => e.key === 'development')?.clientKey ?? '<development key>'}'
    : '${environments.find((e) => e.key === 'production')?.clientKey ?? '<production key>'}',
  user: { id: user.id, country: user.country },
});

if (forkcast.getTreatment('new-checkout') === 'T1') { /* new code path */ }`}</Code>
      </div>

      <div className="card card-pad stack">
        <div>
          <h2>Config as code</h2>
          <p className="small text-2">
            Export every experiment to <code>forkcast.config.json</code> to review changes in pull requests, seed another server, or run the SDK fully offline with{' '}
            <code>createForkcast({'{ config }'})</code>.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={download}>
            <Icon name="download" size={14} /> Export config
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14} /> Import config
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
      </div>

      {rotate && (
        <Modal
          title="Rotate client key?"
          onClose={() => setRotate(undefined)}
          footer={
            <>
              <button className="btn" onClick={() => setRotate(undefined)}>
                Cancel
              </button>
              <button
                className="btn btn-danger-solid"
                onClick={async () => {
                  await api.rotateKey(rotate);
                  setRotate(undefined);
                  reloadEnvironments();
                  toast('Key rotated. Update your apps.');
                }}
              >
                Rotate
              </button>
            </>
          }
        >
          <p>Apps using the old key for {rotate} will stop receiving config and fall back to C until you deploy the new key.</p>
        </Modal>
      )}
    </div>
  );
}
