#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from '../core/validate';
import type { ForkcastConfig } from '../core/types';
import { createForkcastServer } from '../server/server';

const VERSION = '0.1.0';

const HELP = `
forkcast ${VERSION} — self-hosted A/B testing & feature flags

Usage
  forkcast start [options]        Start the API + dashboard
  forkcast init [file]            Create a starter forkcast.config.json
  forkcast validate [file]        Validate a config file
  forkcast --version | --help

Options for start
  -p, --port <n>          Port (default 4400, env FORKCAST_PORT / PORT)
      --host <host>       Host to bind (default 0.0.0.0, env FORKCAST_HOST)
  -d, --data <file>       JSON data file (default .forkcast/data.json, env FORKCAST_DATA)
      --seed <file>       Config to import when the store is empty (env FORKCAST_SEED)
      --admin-token <t>   Protect dashboard + admin API (env FORKCAST_ADMIN_TOKEN)
      --memory            Keep everything in memory (nothing written to disk)
      --no-dashboard      API only

Examples
  npx forkcast start
  npx forkcast start --port 8080 --admin-token "$(openssl rand -hex 16)"
  npx forkcast init && npx forkcast start --seed forkcast.config.json
`;

const STARTER: ForkcastConfig = {
  version: 1,
  experiments: [
    {
      key: 'new-checkout',
      name: 'New checkout flow',
      description: 'One-click checkout vs the current cart page',
      hypothesis: 'Removing the cart step increases purchases',
      type: 'experiment',
      variants: [
        { key: 'C', name: 'Current checkout', weight: 50 },
        { key: 'T1', name: 'One-click checkout', weight: 50 },
      ],
      metrics: ['purchase'],
      environments: {
        development: { status: 'running', traffic: 100 },
        staging: { status: 'running', traffic: 100 },
        production: { status: 'off', traffic: 10 },
      },
    },
    {
      key: 'dark-mode',
      name: 'Dark mode',
      type: 'flag',
      variants: [
        { key: 'C', name: 'Off', weight: 0 },
        { key: 'T1', name: 'On', weight: 100 },
      ],
      environments: {
        development: { status: 'launched', traffic: 100, launchedVariant: 'T1' },
        production: { status: 'off', traffic: 0 },
      },
    },
  ],
};

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const alias: Record<string, string> = { p: 'port', d: 'data', h: 'help', v: 'version' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--no-')) flags[a.slice(5)] = false;
    else if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      let name = a.replace(/^-+/, '');
      let value: string | boolean = true;
      if (name.includes('=')) [name, value] = name.split(/=(.*)/s) as [string, string];
      else if (argv[i + 1] && !argv[i + 1].startsWith('-')) value = argv[++i];
      flags[alias[name] ?? name] = value;
    } else positional.push(a);
  }
  return { flags, positional };
}

function readConfig(file: string): ForkcastConfig {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`Config file not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as ForkcastConfig;
}

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

async function start(flags: Record<string, string | boolean>) {
  const port = Number(flags.port ?? process.env.FORKCAST_PORT ?? process.env.PORT ?? 4400);
  const host = String(flags.host ?? process.env.FORKCAST_HOST ?? '0.0.0.0');
  const dataFile = flags.memory ? undefined : resolve(String(flags.data ?? process.env.FORKCAST_DATA ?? '.forkcast/data.json'));
  const seedFile = (flags.seed as string | undefined) ?? process.env.FORKCAST_SEED;
  const adminToken = (flags['admin-token'] as string | undefined) ?? process.env.FORKCAST_ADMIN_TOKEN;

  const server = await createForkcastServer({
    dataFile,
    adminToken,
    dashboard: flags.dashboard !== false,
    seed: seedFile ? readConfig(seedFile) : undefined,
    logger: (m) => console.log(c.dim(`[forkcast] ${m}`)),
  });
  const { url } = await server.listen(port, host);
  const envs = await server.storage.getEnvironments();

  console.log(`\n  ${c.bold('Forkcast')} ${c.dim('v' + VERSION)} is running\n`);
  console.log(`  ${c.green('➜')}  Dashboard   ${c.cyan(url)}`);
  console.log(`  ${c.green('➜')}  API         ${c.cyan(url + '/api')}`);
  console.log(`  ${c.green('➜')}  Storage     ${dataFile ?? 'memory (not persisted)'}`);
  console.log(`  ${c.green('➜')}  Admin auth  ${adminToken ? 'enabled' : c.red('disabled (set --admin-token in production)')}\n`);
  console.log(`  ${c.bold('Client keys')} ${c.dim('(public, safe to ship in frontend code)')}`);
  for (const e of envs) console.log(`    ${e.name.padEnd(12)} ${e.clientKey}`);
  console.log('');

  const shutdown = async () => {
    console.log(c.dim('\n  Shutting down, flushing data...'));
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);

  if (!command || command === '--help' || command === '-h' || command === 'help') return void console.log(HELP);
  if (command === '--version' || command === '-v') return void console.log(VERSION);

  if (command === 'start') return start(flags);

  if (command === 'init') {
    const file = resolve(positional[0] ?? 'forkcast.config.json');
    if (existsSync(file) && !flags.force) throw new Error(`${file} already exists (use --force to overwrite)`);
    writeFileSync(file, JSON.stringify(STARTER, null, 2) + '\n');
    console.log(`${c.green('✔')} Created ${file}`);
    console.log(`  Next: ${c.cyan(`npx forkcast start --seed ${positional[0] ?? 'forkcast.config.json'}`)}`);
    return;
  }

  if (command === 'validate') {
    const file = positional[0] ?? 'forkcast.config.json';
    const errors = validateConfig(readConfig(file));
    if (errors.length) {
      console.error(`${c.red('✖')} ${file} has ${errors.length} problem(s):`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(`${c.green('✔')} ${file} is valid`);
    return;
  }

  console.error(`Unknown command "${command}"`);
  console.log(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error(c.red(`✖ ${err instanceof Error ? err.message : err}`));
  process.exit(1);
});
