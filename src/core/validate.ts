import { OPERATORS } from './targeting';
import { CONTROL, type Experiment, type ForkcastConfig } from './types';

export const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Turn "New Checkout Flow!" into "new-checkout-flow". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Returns a list of human-readable problems. Empty list = valid. */
export function validateExperiment(exp: Partial<Experiment>): string[] {
  const errors: string[] = [];
  if (!exp || typeof exp !== 'object') return ['experiment must be an object'];

  if (!exp.key || !KEY_PATTERN.test(exp.key)) {
    errors.push('key must be 1-64 chars of lowercase letters, digits, ".", "_" or "-", starting with a letter or digit');
  }
  if (!exp.name || !String(exp.name).trim()) errors.push('name is required');
  if (exp.type && exp.type !== 'experiment' && exp.type !== 'flag') errors.push('type must be "experiment" or "flag"');

  const variants = Array.isArray(exp.variants) ? exp.variants : [];
  if (variants.length < 2) errors.push('at least two variants are required (C plus one treatment)');
  if (!variants.some((v) => v.key === CONTROL)) errors.push('variants must include the control "C"');
  const seen = new Set<string>();
  for (const v of variants) {
    if (!v.key || !/^[A-Za-z0-9_-]{1,16}$/.test(v.key)) errors.push(`invalid variant key "${v.key}"`);
    if (seen.has(v.key)) errors.push(`duplicate variant key "${v.key}"`);
    seen.add(v.key);
    if (typeof v.weight !== 'number' || !Number.isFinite(v.weight) || v.weight < 0) {
      errors.push(`variant "${v.key}" weight must be a number >= 0`);
    }
  }
  if (variants.length && variants.reduce((s, v) => s + (Number(v.weight) || 0), 0) <= 0) {
    errors.push('at least one variant needs a weight above 0');
  }

  for (const [env, s] of Object.entries(exp.environments ?? {})) {
    if (!['off', 'running', 'launched'].includes(s.status)) errors.push(`${env}: status must be off, running or launched`);
    if (typeof s.traffic !== 'number' || s.traffic < 0 || s.traffic > 100) {
      errors.push(`${env}: traffic must be between 0 and 100`);
    }
    if (s.status === 'launched' && !seen.has(s.launchedVariant ?? '')) {
      errors.push(`${env}: launchedVariant must be one of the variants`);
    }
  }

  for (const c of exp.audience?.conditions ?? []) {
    if (!c.attribute) errors.push('audience condition is missing an attribute');
    if (!OPERATORS.includes(c.operator)) errors.push(`unknown operator "${c.operator}"`);
  }
  for (const f of exp.forced ?? []) {
    if (!seen.has(f.variant)) errors.push(`forced variant "${f.variant}" does not exist`);
  }
  return errors;
}

export function validateConfig(config: Partial<ForkcastConfig>): string[] {
  if (!config || !Array.isArray(config.experiments)) return ['config.experiments must be an array'];
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const exp of config.experiments) {
    const prefix = exp?.key ? `[${exp.key}] ` : '';
    for (const e of validateExperiment(exp)) errors.push(prefix + e);
    if (exp?.key && keys.has(exp.key)) errors.push(`duplicate experiment key "${exp.key}"`);
    if (exp?.key) keys.add(exp.key);
  }
  return errors;
}

/** Fill in defaults so partially written experiments are usable. */
export function normalizeExperiment(input: Partial<Experiment> & { key: string; name?: string }): Experiment {
  const now = new Date().toISOString();
  const type = input.type ?? 'experiment';
  const variants =
    input.variants && input.variants.length
      ? input.variants.map((v) => ({ ...v, weight: Number(v.weight ?? 0) }))
      : [
          { key: CONTROL, name: type === 'flag' ? 'Off' : 'Control', weight: 50 },
          { key: 'T1', name: type === 'flag' ? 'On' : 'Treatment 1', weight: 50 },
        ];
  return {
    ...input,
    key: input.key,
    name: input.name ?? input.key,
    type,
    variants,
    environments: input.environments ?? {},
    metrics: input.metrics ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
