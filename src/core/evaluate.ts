import { BUCKETS, bucketOf } from './hash';
import { matchAudience } from './targeting';
import { CONTROL, type Evaluation, type Experiment, type Treatment, type UserContext } from './types';

export interface EvaluateOptions {
  /** Environment whose status/traffic applies, e.g. `production`. */
  environment: string;
  /** Developer overrides (`experimentKey -> treatment`). Only pass these in dev/QA. */
  overrides?: Record<string, Treatment>;
}

function result(
  exp: Experiment | undefined,
  key: string,
  variant: Treatment,
  reason: Evaluation['reason'],
  inExperiment = false,
): Evaluation {
  const payload = exp?.variants.find((v) => v.key === variant)?.payload;
  return { experiment: key, variant, payload, reason, inExperiment };
}

/** Pick a treatment for a bucket according to the variant weights. */
export function pickVariant(exp: Experiment, bucket: number): Treatment {
  const variants = exp.variants.filter((v) => v.weight > 0);
  const total = variants.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return CONTROL;
  const point = (bucket / BUCKETS) * total;
  let acc = 0;
  for (const v of variants) {
    acc += v.weight;
    if (point < acc) return v.key;
  }
  return variants[variants.length - 1].key;
}

/**
 * Decide which treatment `user` sees for `exp`.
 *
 * Order of precedence (first match wins):
 *  1. experiment missing / archived  -> C
 *  2. developer override             -> that treatment
 *  3. environment off                -> C   (kill switch)
 *  4. environment launched           -> launchedVariant for everyone
 *  5. forced user list               -> that treatment (QA / dogfooding)
 *  6. audience does not match        -> C
 *  7. outside traffic %              -> C
 *  8. otherwise                      -> weighted random, sticky per user
 *
 * Only (8) counts as "in experiment" and is recorded as an exposure.
 *
 * Traffic and variant use *independent* hashes. Raising traffic from 10% to
 * 50% therefore only adds users; nobody already in the experiment switches
 * treatment.
 */
export function evaluate(
  exp: Experiment | undefined,
  key: string,
  user: UserContext,
  options: EvaluateOptions,
): Evaluation {
  if (!exp) return result(undefined, key, CONTROL, 'not_found');
  if (exp.archived) return result(exp, key, CONTROL, 'archived');

  const override = options.overrides?.[key];
  if (override && exp.variants.some((v) => v.key === override)) {
    return result(exp, key, override, 'override');
  }

  const env = exp.environments?.[options.environment];
  if (!env || env.status === 'off') return result(exp, key, CONTROL, 'off');

  if (env.status === 'launched') {
    const launched = env.launchedVariant ?? CONTROL;
    return result(exp, key, launched, 'launched');
  }

  const userId = user.id != null ? String(user.id) : '';
  if (userId && exp.forced) {
    for (const f of exp.forced) {
      if (f.userIds.includes(userId) && exp.variants.some((v) => v.key === f.variant)) {
        return result(exp, key, f.variant, 'forced');
      }
    }
  }

  if (!matchAudience(user, exp.audience)) return result(exp, key, CONTROL, 'not_targeted');
  if (!userId) return result(exp, key, CONTROL, 'no_user');

  const salt = exp.salt || exp.key;
  const traffic = Math.max(0, Math.min(100, Number(env.traffic) || 0));
  if (bucketOf(`${salt}:traffic`, userId) >= traffic * (BUCKETS / 100)) {
    return result(exp, key, CONTROL, 'not_in_traffic');
  }

  const variant = pickVariant(exp, bucketOf(`${salt}:variant`, userId));
  return result(exp, key, variant, 'assigned', true);
}
