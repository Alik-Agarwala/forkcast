/**
 * Core data model for Forkcast.
 *
 * Vocabulary (borrowed from large-scale experimentation platforms):
 *  - **Experiment**: a named switch in your code, e.g. `new-checkout`.
 *  - **Treatment / variant**: one arm of the experiment. `C` is always the
 *    control (today's behaviour). `T1`, `T2`, ... are new treatments.
 *  - **Traffic**: the % of eligible users that enter the experiment at all.
 *    Users outside the traffic always get `C` and are *not* counted in results.
 *  - **Weights**: how users *inside* the experiment are split across treatments.
 *  - **Environment**: development / staging / production. Each environment has
 *    its own on/off status and traffic, so you can test in dev while prod is off.
 */

/** A treatment key such as `C`, `T1`, `T2`. */
export type Treatment = string;

/** The control treatment. Returned whenever anything is off, missing or failing. */
export const CONTROL: Treatment = 'C';

/** Status of an experiment in a single environment. */
export type EnvironmentStatus =
  /** Nobody sees the experiment. Everyone gets `C`. This is the kill switch. */
  | 'off'
  /** Users are bucketed by traffic % and weights. Exposures are recorded. */
  | 'running'
  /** The experiment is decided: everyone gets `launchedVariant`. */
  | 'launched';

export type ExperimentType =
  /** A/B/n test with a success metric. */
  | 'experiment'
  /** Feature flag: `C` = off, `T1` = on. Used for gradual rollouts and kill switches. */
  | 'flag';

export interface Variant {
  /** Short key, e.g. `C`, `T1`. */
  key: Treatment;
  /** Human friendly name, e.g. "One-click checkout". */
  name?: string;
  /** Relative weight inside the experiment. Weights do not need to sum to 100. */
  weight: number;
  /** Optional JSON payload delivered with the treatment (copy, colours, limits...). */
  payload?: unknown;
}

export type Operator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'regex'
  | 'exists'
  | 'notExists'
  | 'semverGte'
  | 'semverLt';

export type ConditionValue = string | number | boolean | Array<string | number>;

export interface Condition {
  /** Attribute on the user context, e.g. `country`, `plan`, `appVersion`. Dot paths allowed. */
  attribute: string;
  operator: Operator;
  value?: ConditionValue;
}

export interface Audience {
  /** `all` = every condition must match (AND). `any` = at least one (OR). */
  match: 'all' | 'any';
  conditions: Condition[];
}

/** Pin specific users to a treatment (QA, internal dogfooding, VIPs). */
export interface ForcedAssignment {
  variant: Treatment;
  userIds: string[];
}

export interface EnvironmentSettings {
  status: EnvironmentStatus;
  /** 0-100. Percentage of eligible users that enter the experiment. */
  traffic: number;
  /** Treatment served to everyone when status is `launched`. */
  launchedVariant?: Treatment;
}

export interface Experiment {
  /** Stable identifier used in code. Lowercase, digits, `-`, `_`, `.`. */
  key: string;
  name: string;
  description?: string;
  hypothesis?: string;
  type: ExperimentType;
  /** Must contain `C`. */
  variants: Variant[];
  /**
   * Hashing salt. Defaults to `key`. Changing it re-randomises every user,
   * so only change it to deliberately restart an experiment.
   */
  salt?: string;
  audience?: Audience;
  forced?: ForcedAssignment[];
  /** Per-environment state. A missing environment means `off`. */
  environments: Record<string, EnvironmentSettings>;
  /** Event names analysed in results. The first one is the primary metric. */
  metrics?: string[];
  owner?: string;
  tags?: string[];
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Config-as-code file format (`forkcast.config.json`). */
export interface ForkcastConfig {
  version: 1;
  experiments: Experiment[];
  /** Optional environments (used by the server when seeding). */
  environments?: EnvironmentInfo[];
}

export interface EnvironmentInfo {
  key: string;
  name: string;
  /** Public key used by SDKs to fetch config and send events for this environment. */
  clientKey: string;
  color?: string;
}

/** Who is being evaluated. Any extra attribute can be used for targeting. */
export interface UserContext {
  /** Stable user id. If omitted in browsers, an anonymous id is generated and persisted. */
  id?: string;
  country?: string;
  [attribute: string]: unknown;
}

export type EvaluationReason =
  | 'not_found'
  | 'archived'
  | 'override'
  | 'off'
  | 'launched'
  | 'forced'
  | 'not_targeted'
  | 'not_in_traffic'
  | 'no_user'
  | 'assigned';

export interface Evaluation<P = unknown> {
  experiment: string;
  variant: Treatment;
  payload?: P;
  reason: EvaluationReason;
  /** True only when the user was randomly bucketed and counts towards results. */
  inExperiment: boolean;
}

/** Events the SDK sends to the server. */
export type ForkcastEvent =
  | {
      type: 'exposure';
      experiment: string;
      variant: Treatment;
      userId: string;
      ts: number;
      attributes?: Record<string, unknown>;
    }
  | {
      type: 'track';
      name: string;
      userId: string;
      value?: number;
      ts: number;
      properties?: Record<string, unknown>;
    };
