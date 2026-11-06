import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createForkcast, type ForkcastClient, type ForkcastOptions } from '../core/client';
import { CONTROL, type Evaluation, type Treatment } from '../core/types';

const ForkcastContext = createContext<ForkcastClient | null>(null);

export interface ForkcastProviderProps {
  /** An existing client (recommended: create it once, outside React). */
  client?: ForkcastClient;
  /** Or let the provider create one. Changing options after mount has no effect. */
  options?: ForkcastOptions;
  children?: ReactNode;
}

export function ForkcastProvider({ client, options, children }: ForkcastProviderProps) {
  const ref = useRef<ForkcastClient | null>(client ?? null);
  if (!ref.current) ref.current = createForkcast(options);
  const owned = !client;
  useEffect(() => {
    const c = ref.current;
    return () => {
      if (owned) void c?.close();
    };
  }, [owned]);
  return <ForkcastContext.Provider value={ref.current}>{children}</ForkcastContext.Provider>;
}

/** The underlying client. Throws when used outside `<ForkcastProvider>`. */
export function useForkcast(): ForkcastClient {
  const client = useContext(ForkcastContext);
  if (!client) throw new Error('useForkcast must be used inside <ForkcastProvider>');
  return client;
}

/** Re-render whenever config, user or overrides change. */
function useVersion(client: ForkcastClient): number {
  return useSyncExternalStore(
    useCallback((cb) => client.subscribe(cb), [client]),
    () => client.getVersion(),
    () => client.getVersion(),
  );
}

/** `true` once the first config fetch completed (or failed). */
export function useForkcastReady(): boolean {
  const client = useForkcast();
  useVersion(client);
  return client.initialized;
}

/** Full evaluation (variant, payload, reason). Records an exposure. */
export function useVariant<P = unknown>(key: string): Evaluation<P> {
  const client = useForkcast();
  const version = useVersion(client);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => client.getVariant<P>(key), [client, key, version]);
}

/** `'C' | 'T1' | ...` for the current user. */
export function useTreatment(key: string): Treatment {
  return useVariant(key).variant;
}

/** Feature-flag style boolean: `true` when the treatment is not `C`. */
export function useFlag(key: string): boolean {
  return useTreatment(key) !== CONTROL;
}

/** Payload attached to the user's treatment. */
export function usePayload<P = unknown>(key: string): P | undefined {
  return useVariant<P>(key).payload;
}

/** Stable `track(name, props)` function. */
export function useTrack(): ForkcastClient['track'] {
  const client = useForkcast();
  return useCallback((name, props) => client.track(name, props), [client]);
}

export interface VariantProps {
  /** Treatment key this branch renders for, e.g. `T1`. Use `C` for the control/default branch. */
  name: Treatment;
  children?: ReactNode;
}

/** Marker component used inside `<Experiment>`. */
export function Variant({ children }: VariantProps): ReactElement {
  return <>{children}</>;
}

export interface ExperimentProps {
  /** Experiment key. */
  name: string;
  children?: ReactNode;
  /** Rendered while the client is loading for the first time. Defaults to the `C` branch. */
  loading?: ReactNode;
}

/**
 * Declarative branching:
 *
 * ```tsx
 * <Experiment name="new-checkout">
 *   <Variant name="C"><OldCheckout /></Variant>
 *   <Variant name="T1"><OneClickCheckout /></Variant>
 * </Experiment>
 * ```
 * Falls back to the `C` branch when the treatment has no matching `<Variant>`.
 */
export function Experiment({ name, children, loading }: ExperimentProps) {
  const ready = useForkcastReady();
  const treatment = useTreatment(name);
  const branches = Children.toArray(children).filter(
    (c): c is ReactElement<VariantProps> => isValidElement(c) && typeof (c.props as VariantProps).name === 'string',
  );
  if (!ready && loading !== undefined) return <>{loading}</>;
  const match = branches.find((b) => b.props.name === treatment) ?? branches.find((b) => b.props.name === CONTROL);
  return match ? <>{match}</> : null;
}

export interface FeatureProps {
  /** Flag key. */
  flag: string;
  children?: ReactNode;
  /** Rendered when the flag is off (`C`). */
  fallback?: ReactNode;
}

/** Render children only when a flag is on. */
export function Feature({ flag, children, fallback = null }: FeatureProps) {
  return <>{useFlag(flag) ? children : fallback}</>;
}

export { createForkcast };
export type { ForkcastClient, ForkcastOptions };
