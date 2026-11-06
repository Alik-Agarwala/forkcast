import type { ForkcastClient } from '../core/client';

export interface DevtoolsOptions {
  /** Corner to anchor the launcher button. Default `bottom-right`. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Mount even when the client is not in dev mode (e.g. an internal QA build). */
  force?: boolean;
  /** Start with the panel open. */
  open?: boolean;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.launcher { position: fixed; z-index: 2147483646; width: 44px; height: 44px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12);
  background: #0f172a; color: #fff; cursor: pointer; display: grid; place-items: center; box-shadow: 0 8px 24px rgba(15,23,42,.35);
  font: 600 13px/1 ui-sans-serif, system-ui; letter-spacing: .02em; }
.launcher:hover { background: #1e293b; }
.badge { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; border-radius: 9px; background: #6366f1; font-size: 11px;
  display: grid; place-items: center; padding: 0 5px; }
.panel { position: fixed; z-index: 2147483647; width: min(380px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 90px)); overflow: hidden;
  display: flex; flex-direction: column; background: #fff; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 14px;
  box-shadow: 0 20px 50px rgba(15,23,42,.25); font-size: 13px; }
.head { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px; }
.title { font-weight: 650; font-size: 14px; flex: 1; }
.env { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-weight: 600; }
.user { padding: 8px 14px; color: #64748b; font-size: 12px; border-bottom: 1px solid #f1f5f9; word-break: break-all; }
.list { overflow: auto; padding: 6px 0; }
.row { padding: 8px 14px; display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; }
.row:hover { background: #f8fafc; }
.key { font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.reason { grid-column: 1 / 2; color: #64748b; font-size: 11px; }
.reason.override { color: #b45309; font-weight: 600; }
select { font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; grid-row: 1 / 3; grid-column: 2; }
.foot { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
button.btn { font: inherit; font-size: 12px; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; cursor: pointer; }
button.btn:hover { background: #f1f5f9; }
.empty { padding: 18px 14px; color: #64748b; }
.close { border: 0; background: transparent; font-size: 18px; line-height: 1; cursor: pointer; color: #64748b; }
@media (prefers-color-scheme: dark) {
  .panel { background: #0f172a; color: #e2e8f0; border-color: #1e293b; }
  .head, .foot { border-color: #1e293b; } .foot { background: #0b1222; } .user { border-color: #1e293b; }
  .row:hover { background: #111c33; } select, button.btn { background: #1e293b; color: #e2e8f0; border-color: #334155; }
  .env { background: #312e81; color: #c7d2fe; }
}
`;

const REASONS: Record<string, string> = {
  override: 'overridden locally',
  assigned: 'randomly assigned',
  launched: 'launched to everyone',
  off: 'off in this environment',
  forced: 'forced for this user id',
  not_targeted: 'outside the audience',
  not_in_traffic: 'outside the traffic %',
  no_user: 'no user id',
  archived: 'archived',
  not_found: 'not found',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Mount a floating panel that lists every experiment, shows the current
 * treatment and why, and lets you switch treatments locally.
 *
 * Does nothing in production builds unless `force: true`. Returns an unmount function.
 */
export function mountDevtools(client: ForkcastClient, options: DevtoolsOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  if (!client.overridesAllowed && !options.force) return () => {};

  const host = el('div', { 'data-forkcast-devtools': '' });
  const root = host.attachShadow({ mode: 'open' });
  root.appendChild(el('style', {}, STYLE));
  const pos = options.position ?? 'bottom-right';
  const [v, h] = pos.split('-') as ['top' | 'bottom', 'left' | 'right'];

  const launcher = el('button', { class: 'launcher', title: 'Forkcast devtools', 'aria-label': 'Open Forkcast devtools' }, 'FC');
  launcher.style[v] = '16px';
  launcher.style[h] = '16px';
  const badge = el('span', { class: 'badge' });
  launcher.appendChild(badge);

  const panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Forkcast devtools' });
  panel.style[v] = '70px';
  panel.style[h] = '16px';
  let open = options.open ?? false;

  function render() {
    const overrides = client.getOverrides();
    const count = Object.keys(overrides).length;
    badge.textContent = String(count);
    badge.style.display = count ? 'grid' : 'none';
    panel.style.display = open ? 'flex' : 'none';
    panel.replaceChildren();

    const head = el('div', { class: 'head' });
    head.append(el('span', { class: 'title' }, 'Forkcast'), el('span', { class: 'env' }, client.getEnvironment()));
    const close = el('button', { class: 'close', 'aria-label': 'Close' }, '×');
    close.onclick = () => {
      open = false;
      render();
    };
    head.append(close);
    panel.append(head);

    const user = client.getUser();
    panel.append(el('div', { class: 'user' }, `user ${user.id ?? '(none)'}${user.country ? ' · ' + user.country : ''}`));

    const list = el('div', { class: 'list' });
    const experiments = client.getExperiments().sort((a, b) => a.key.localeCompare(b.key));
    if (!experiments.length) list.append(el('div', { class: 'empty' }, client.initialized ? 'No experiments in this environment.' : 'Loading…'));
    for (const exp of experiments) {
      const ev = client.peek(exp.key);
      const row = el('div', { class: 'row' });
      row.append(el('span', { class: 'key', title: exp.name }, exp.key));
      const select = el('select', { 'aria-label': `Treatment for ${exp.key}` });
      select.append(el('option', { value: '' }, `auto (${ev.reason === 'override' ? '…' : ev.variant})`));
      for (const variant of exp.variants) {
        const opt = el('option', { value: variant.key }, variant.name ? `${variant.key} · ${variant.name}` : variant.key);
        if (overrides[exp.key] === variant.key) opt.selected = true;
        select.append(opt);
      }
      select.onchange = () => client.override(exp.key, select.value || null);
      row.append(select);
      row.append(el('span', { class: `reason ${ev.reason}` }, `${ev.variant} — ${REASONS[ev.reason] ?? ev.reason}`));
      list.append(row);
    }
    panel.append(list);

    const foot = el('div', { class: 'foot' });
    const reset = el('button', { class: 'btn' }, 'Reset overrides');
    reset.onclick = () => client.clearOverrides();
    const copy = el('button', { class: 'btn' }, 'Copy share link');
    copy.title = 'URL that reproduces these treatments (?forkcast=key:T1,...)';
    copy.onclick = async () => {
      const url = new URL(location.href);
      const value = Object.entries(client.getOverrides()).map(([k, t]) => `${k}:${t}`).join(',');
      if (value) url.searchParams.set('forkcast', value);
      else url.searchParams.delete('forkcast');
      try {
        await navigator.clipboard.writeText(url.toString());
        copy.textContent = 'Copied!';
        setTimeout(() => (copy.textContent = 'Copy share link'), 1200);
      } catch {
        prompt('Share link', url.toString());
      }
    };
    foot.append(reset, copy);
    panel.append(foot);
  }

  launcher.onclick = () => {
    open = !open;
    render();
  };

  root.append(launcher, panel);
  document.body.appendChild(host);
  const unsubscribe = client.subscribe(render);
  render();

  return () => {
    unsubscribe();
    host.remove();
  };
}
