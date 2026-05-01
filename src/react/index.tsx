/// React bindings for `@i99dash/sdk`. Single entry point — there's
/// nothing here that wouldn't be tree-shaken if a consumer only uses
/// one hook, so a flat export keeps the public surface visible at a
/// glance.
///
/// Hooks accept an optional `fallback` so the component renders a
/// sane shape when the bridge isn't reachable (SSR, Storybook, jsdom,
/// or a host that hasn't shipped the family yet) — same DX trap the
/// "loading-forever" component falls into in vanilla SDK code. See
/// `docs/recipes/react.mdx` for end-to-end patterns.

import {
  type CallApiRequest,
  type CarStatus,
  CallApiFailedError,
  CarStatusUnavailableError,
  type ClimateSnapshot,
  ClimateUnavailableError,
  type ConnectivitySnapshot,
  ConnectivityUnavailableError,
  type LocationSnapshot,
  LocationUnavailableError,
  type MediaSnapshot,
  MediaUnavailableError,
  type MiniAppClient,
  type MiniAppContext,
  type NavigationSnapshot,
  NavigationUnavailableError,
  NotInsideHostError,
  type SystemSnapshot,
  SystemUnavailableError,
  type VehicleDiagnosticsSnapshot,
  VehicleDiagnosticsUnavailableError,
  type VehicleEnvironmentSnapshot,
  VehicleEnvironmentUnavailableError,
} from '../runtime/index.js';
import {
  createContext,
  useCallback,
  useContext as useReactContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

const ClientContext = createContext<MiniAppClient | null>(null);

export interface MiniAppProviderProps {
  /// The bound client. `null` is a first-class value — pass `null` when
  /// the host bridge isn't reachable (SSR, jsdom, a Storybook story);
  /// every hook accepts the `null` case via its `fallback` option.
  ///
  /// Idiomatic: `<MiniAppProvider client={createClientOrSSR()}>`.
  client: MiniAppClient | null;
}

export function MiniAppProvider({
  client,
  children,
}: PropsWithChildren<MiniAppProviderProps>): React.ReactElement {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/// Returns the [MiniAppClient] mounted by the closest [MiniAppProvider],
/// or `null` if outside one (or if the parent provider mounted with
/// `client={null}` because the bridge was unreachable). Most consumers
/// reach for one of the higher-level hooks below; this is the escape
/// hatch for one-off callApi flows that don't fit the `useCallApi`
/// shape.
export function useClient(): MiniAppClient | null {
  return useReactContext(ClientContext);
}

interface FallbackOpt<T> {
  /// Returned when the client is null, the bridge throws
  /// `NotInsideHostError` / `CarStatusUnavailableError`, or the data
  /// hasn't loaded yet. Stable — the hook does not re-render once it
  /// has a real value, even if the fallback reference changes.
  fallback?: T;
}

interface UseContextResult<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/// Returns the host context. While the first `getContext()` call is
/// in flight, `loading: true` and `data: undefined` (or `data: fallback`
/// if provided). On success, the hook stops re-rendering — the host
/// context is effectively immutable for a mini-app session.
export function useMiniAppContext(
  opts?: FallbackOpt<MiniAppContext>,
): UseContextResult<MiniAppContext> {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<UseContextResult<MiniAppContext>>(() => ({
    data: fallback,
    error: null,
    loading: client !== null,
  }));

  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null, loading: false });
      return;
    }
    let cancelled = false;
    client.getContext().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (e: unknown) => {
        if (cancelled) return;
        // NotInsideHostError shouldn't reach here (client wouldn't
        // have constructed) but cover it for safety.
        if (e instanceof NotInsideHostError) {
          setState({ data: fallback, error: null, loading: false });
        } else {
          setState({ data: fallback, error: e as Error, loading: false });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, fallback]);

  return state;
}

/// Subscribes to live car-status events. Renders `fallback` until the
/// first event arrives, switches to the live value on each push, and
/// unsubscribes automatically on unmount.
///
/// If the bridge doesn't ship the car-status capability (older host,
/// unit-test stub), the hook stays on `fallback` indefinitely without
/// throwing — same graceful-degradation contract as the other family
/// hooks.
export function useCarStatus(opts?: FallbackOpt<CarStatus>): {
  data: CarStatus | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{ data: CarStatus | undefined; error: Error | null }>(() => ({
    data: fallback,
    error: null,
  }));

  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.car.onStatusChange((s) => {
        setState({ data: s, error: null });
      });
    } catch (e) {
      if (e instanceof CarStatusUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => {
      off?.();
    };
  }, [client, fallback]);

  return state;
}

/// Subscribes to media events. Same shape and graceful-degradation
/// contract as [useCarStatus]: renders `fallback` until the first
/// event arrives (or indefinitely if the bridge doesn't ship the
/// `media.read` family — older host, unit-test stub).
export function useMedia(opts?: FallbackOpt<MediaSnapshot>): {
  data: MediaSnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{ data: MediaSnapshot | undefined; error: Error | null }>(
    () => ({ data: fallback, error: null }),
  );

  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.media.onChange((s) => {
        setState({ data: s, error: null });
      });
    } catch (e) {
      if (e instanceof MediaUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => {
      off?.();
    };
  }, [client, fallback]);

  return state;
}

/// Subscribes to cabin-climate events (`climate.read` family). Same
/// graceful-degradation contract as the other family hooks: stays on
/// `fallback` when the bridge doesn't ship the family.
export function useClimate(opts?: FallbackOpt<ClimateSnapshot>): {
  data: ClimateSnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{ data: ClimateSnapshot | undefined; error: Error | null }>(
    () => ({ data: fallback, error: null }),
  );
  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.climate.onChange((s) => setState({ data: s, error: null }));
    } catch (e) {
      if (e instanceof ClimateUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => off?.();
  }, [client, fallback]);
  return state;
}

/// Subscribes to vehicle-diagnostics events (`vehicle.diagnostics` family).
export function useVehicleDiagnostics(opts?: FallbackOpt<VehicleDiagnosticsSnapshot>): {
  data: VehicleDiagnosticsSnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{
    data: VehicleDiagnosticsSnapshot | undefined;
    error: Error | null;
  }>(() => ({ data: fallback, error: null }));
  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.vehicleDiagnostics.onChange((s) => setState({ data: s, error: null }));
    } catch (e) {
      if (e instanceof VehicleDiagnosticsUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => off?.();
  }, [client, fallback]);
  return state;
}

/// Subscribes to vehicle-environment events (`vehicle.environment` family).
export function useVehicleEnvironment(opts?: FallbackOpt<VehicleEnvironmentSnapshot>): {
  data: VehicleEnvironmentSnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{
    data: VehicleEnvironmentSnapshot | undefined;
    error: Error | null;
  }>(() => ({ data: fallback, error: null }));
  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.vehicleEnvironment.onChange((s) => setState({ data: s, error: null }));
    } catch (e) {
      if (e instanceof VehicleEnvironmentUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => off?.();
  }, [client, fallback]);
  return state;
}

/// Subscribes to host-system events (`system.read` family).
export function useSystem(opts?: FallbackOpt<SystemSnapshot>): {
  data: SystemSnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{ data: SystemSnapshot | undefined; error: Error | null }>(
    () => ({ data: fallback, error: null }),
  );
  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.system.onChange((s) => setState({ data: s, error: null }));
    } catch (e) {
      if (e instanceof SystemUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => off?.();
  }, [client, fallback]);
  return state;
}

/// Subscribes to connectivity events (`connectivity.read` family).
export function useConnectivity(opts?: FallbackOpt<ConnectivitySnapshot>): {
  data: ConnectivitySnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{
    data: ConnectivitySnapshot | undefined;
    error: Error | null;
  }>(() => ({ data: fallback, error: null }));
  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.connectivity.onChange((s) => setState({ data: s, error: null }));
    } catch (e) {
      if (e instanceof ConnectivityUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => off?.();
  }, [client, fallback]);
  return state;
}

/// Subscribes to location events (`location.read` family — PII tier).
/// The bridge gate is two-step: manifest declaration AND host consent;
/// hooks stay on `fallback` while either gate fails (no throw).
export function useLocation(opts?: FallbackOpt<LocationSnapshot>): {
  data: LocationSnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{ data: LocationSnapshot | undefined; error: Error | null }>(
    () => ({ data: fallback, error: null }),
  );
  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.location.onChange((s) => setState({ data: s, error: null }));
    } catch (e) {
      if (e instanceof LocationUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => off?.();
  }, [client, fallback]);
  return state;
}

/// Subscribes to navigation events (`nav.read` family — PII tier).
export function useNavigation(opts?: FallbackOpt<NavigationSnapshot>): {
  data: NavigationSnapshot | undefined;
  error: Error | null;
} {
  const client = useClient();
  const fallback = opts?.fallback;
  const [state, setState] = useState<{
    data: NavigationSnapshot | undefined;
    error: Error | null;
  }>(() => ({ data: fallback, error: null }));
  useEffect(() => {
    if (!client) {
      setState({ data: fallback, error: null });
      return;
    }
    let off: (() => void) | undefined;
    try {
      off = client.navigation.onChange((s) => setState({ data: s, error: null }));
    } catch (e) {
      if (e instanceof NavigationUnavailableError) {
        setState({ data: fallback, error: null });
        return;
      }
      setState({ data: fallback, error: e as Error });
      return;
    }
    return () => off?.();
  }, [client, fallback]);
  return state;
}

interface UseCallApiResult<T> {
  data: T | undefined;
  /// Either a `CallApiFailedError` (the host returned `success: false`)
  /// or a transport error (timeout, malformed envelope). Inspect
  /// `err instanceof CallApiFailedError` and `err.errorCode` to branch
  /// between protocol failures and genuine bugs.
  error: Error | null;
  loading: boolean;
  /// Re-run the call with the same request shape. Useful for retry
  /// buttons; the previous data is preserved in `data` until the new
  /// call settles.
  refetch: () => void;
}

interface UseCallApiOptions<T> extends FallbackOpt<T> {
  /// Skip the call until this is `true`. Idiomatic for "wait until I
  /// have the user input" patterns: `enabled: query !== ''`.
  enabled?: boolean;
}

/// Fetches `req` through `callApiOrThrow` and exposes the result in
/// React state. Call shape mirrors the popular `useQuery`-family
/// patterns but keeps zero external deps.
///
/// The request is keyed by `JSON.stringify(req)` — change the request
/// object identity in render and the hook re-runs. For more complex
/// invalidation, lift the call into a `useEffect` and use
/// `client.callApiOrThrow` directly.
export function useCallApi<T = unknown>(
  req: CallApiRequest,
  opts: UseCallApiOptions<T> = {},
): UseCallApiResult<T> {
  const client = useClient();
  const fallback = opts.fallback;
  const enabled = opts.enabled !== false;
  const reqKey = useMemo(() => JSON.stringify(req), [req]);
  // Stash the latest req in a ref so refetch always sees the current
  // shape without forcing the closure to re-run.
  const reqRef = useRef(req);
  reqRef.current = req;

  const [state, setState] = useState<UseCallApiResult<T>>(() => ({
    data: fallback,
    error: null,
    loading: enabled && client !== null,
    refetch: () => {},
  }));
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!client || !enabled) {
      setState((s) => ({ ...s, loading: false, refetch }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, refetch }));
    client.callApiOrThrow<T>(reqRef.current).then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false, refetch });
      },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof CallApiFailedError) {
          setState({ data: fallback, error: e, loading: false, refetch });
        } else {
          setState({ data: fallback, error: e as Error, loading: false, refetch });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // reqKey already encodes req identity; refetch is stable. The
    // exhaustive-deps rule isn't installed in this monorepo's eslint
    // config — the deps list is hand-audited.
  }, [client, enabled, reqKey, tick, fallback, refetch]);

  return state;
}
