import { describe, expect, it } from 'vitest';
import { normalizeExperiment, slugify, validateConfig, validateExperiment } from '../src/core/validate';

describe('validateExperiment', () => {
  it('accepts a normalized experiment', () => {
    expect(validateExperiment(normalizeExperiment({ key: 'dark-mode', name: 'Dark mode', type: 'flag' }))).toEqual([]);
  });

  it('reports useful errors', () => {
    const errors = validateExperiment({
      key: 'Bad Key',
      name: '',
      variants: [{ key: 'T1', weight: -1 }],
      environments: { production: { status: 'launched', traffic: 120, launchedVariant: 'T7' } },
    });
    expect(errors.join('\n')).toMatch(/key must be/);
    expect(errors.join('\n')).toMatch(/name is required/);
    expect(errors.join('\n')).toMatch(/include the control "C"/);
    expect(errors.join('\n')).toMatch(/traffic must be between/);
    expect(errors.join('\n')).toMatch(/launchedVariant/);
  });

  it('detects duplicate experiment keys in a config', () => {
    const e = normalizeExperiment({ key: 'a', name: 'A' });
    expect(validateConfig({ version: 1, experiments: [e, e] })).toContain('duplicate experiment key "a"');
  });
});

describe('slugify', () => {
  it('creates valid keys', () => {
    expect(slugify('  New Checkout Flow! ')).toBe('new-checkout-flow');
  });
});
