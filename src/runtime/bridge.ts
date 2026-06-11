import type { MiniAppContext } from '../types/index.js';

import { BridgeTransportError, NotInsideHostError } from './errors.js';

/// Port implemented by anything that can talk to (or simulate) the host.
///
/// The real `HostBridge` below proxies to a host-injected global that
/// exposes `callHandler(name, ...args)`. The dev-server injects a shim
/// that points at its local `/_sdk/*` endpoints. Tests use ad-hoc
/// objects that satisfy this interface — no mocking framework required.
export interface Bridge {
  getContext(): Promise<unknown>;
}

/// Capability extension for hosts that ship the `capabilities`
/// handshake handler. Added to support forward-compat: an SDK that
/// asks for a family the host doesn't yet implement can degrade
/// gracefully via `client.has(scope)` instead of failing at first call.
///
/// Optional on purpose — older hosts that pre-date the handshake
/// don't expose this handler; the SDK falls back to "best effort
/// known set" when absent.
export interface CapabilitiesBridge extends Bridge {
  capabilities(): Promise<unknown>;
}

export function isCapabilitiesBridge(b: Bridge): b is CapabilitiesBridge {
  return typeof (b as Partial<CapabilitiesBridge>).capabilities === 'function';
}

/// Capability extension for hosts that ship the v2 unified `car.*`
/// bridge surface — `car.list`, `car.read`, `car.subscribe`,
/// `car.unsubscribe`, `car.command`, `car.identity`, `car.asset`,
/// `car.connection.subscribe`, `car.connection.unsubscribe`. All
/// of these route through a raw `callHandler(name, payload)` channel;
/// the [CarController] reaches the channel via this extension. A
/// bridge that doesn't expose `callHandler` is opting out of car-
/// data entirely — older hosts that pre-date v2 fall in this bucket.
export interface CarBridge extends Bridge {
  callHandler(name: string, ...args: unknown[]): Promise<unknown>;
}

/// Type guard for [CarBridge]. Mini-app code does not normally call
/// this; the [CarController] handles capability detection internally.
export function isCarBridge(b: Bridge): b is CarBridge {
  return typeof (b as Partial<CarBridge>).callHandler === 'function';
}

/// Capability extension for hosts that ship the native-capability
/// family registry (display, surface, cursor, gesture, magnify, pkg,
/// boot, …). Mini-apps invoke through `callFamily(familyId, op, …)`,
/// which the host routes through its [BridgeFamilyRegistry] +
/// [FamilyExecutor] (single chokepoint with the same cert / consent /
/// cap / audit gates as `_admin.exec`).
///
/// Wire shape: the JS handler name is `<familyId>.<op>`; the host
/// returns the standard `{success, data | error}` envelope —
/// identical to admin-sdk's `AdminOpResponse`. Adding a new family on
/// the host doesn't bump this interface, only the family list in the
/// `capabilities` handshake.
export interface FamilyBridge extends Bridge {
  callFamily(
    familyId: string,
    op: string,
    params?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<unknown>;
}

export function isFamilyBridge(b: Bridge): b is FamilyBridge {
  return typeof (b as Partial<FamilyBridge>).callFamily === 'function';
}

/// Narrow shape of the host-injected global. Deliberately loose —
/// only `callHandler` is part of the contract; anything else the host
/// attaches is an internal detail we never read.
///
/// Exported (renamed at index) so other packages in this monorepo
/// (admin-sdk, dev-server) can talk to the same global without
/// redefining the shape.
export interface HostBridgeApi {
  callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
}

/// The branded global the host attaches to `window` to expose the
/// bridge. Kept under-scored because mini-app authors should never
/// touch it directly — use `MiniAppClient.fromWindow()`.
export const HOST_GLOBAL = '__i99dashHost' as const;

/// Legacy global we also check as a silent fallback so older host
/// builds continue to work while the host-side rename lands. Not
/// documented; scheduled for removal once the host consistently ships
/// the branded name.
export const LEGACY_HOST_GLOBAL = 'flutter_inappwebview' as const;

export interface WindowWithHost {
  [HOST_GLOBAL]?: HostBridgeApi;
  [LEGACY_HOST_GLOBAL]?: HostBridgeApi;
}

/// Resolve the host bridge from a window-like object. Returns
/// undefined if no compatible global is reachable. Centralised so
/// the admin SDK and any future privileged-bridge consumer hits the
/// same selection logic — diverging implementations would let an
/// attacker bypass the legacy-fallback rule by speaking only one of
/// the names.
export function resolveHostApi(windowLike: WindowWithHost): HostBridgeApi | undefined {
  const branded = windowLike[HOST_GLOBAL];
  if (branded?.callHandler) return branded;
  const legacy = windowLike[LEGACY_HOST_GLOBAL];
  if (legacy?.callHandler) return legacy;
  return undefined;
}

/// Browser global the host pushes events into. The mini-app's first
/// `client.car.subscribe` (or `client.car.connectionSubscribe`)
/// installs a tiny dispatcher under this name; the host's
/// `evaluateJavaScript` then calls
/// `window.__i99dashEvents.dispatch('car.signal', payload)`.
///
/// Idempotent install — multiple SDK instances on the same page
/// share the dispatcher. Exposed for tests; mini-app authors should
/// never read it directly.
export const HOST_EVENTS_GLOBAL = '__i99dashEvents' as const;

/// Public for the same reason as [ensureHostEvents] — controllers in
/// this package use the typed surface.
export interface HostEventsApi {
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
  dispatch: (channel: string, payload: unknown) => void;
}

interface WindowWithEvents {
  [HOST_EVENTS_GLOBAL]?: HostEventsApi;
}

/// Install the per-window event dispatcher if it isn't already there.
/// Returns the api so callers can grab a fresh handle synchronously.
///
/// Exported so other controllers in this package (the
/// `BaseFamilyController.subscribe` helper) can register listeners
/// without redefining the lookup. Mini-app code should never call
/// this directly — go through a typed controller.
export function ensureHostEvents(): HostEventsApi {
  if (typeof window === 'undefined') {
    throw new NotInsideHostError('window is undefined — cannot install __i99dashEvents');
  }
  const w = window as WindowWithEvents;
  const existing = w[HOST_EVENTS_GLOBAL];
  if (existing) return existing;

  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const api: HostEventsApi = {
    on(channel, handler) {
      let bucket = handlers.get(channel);
      if (!bucket) {
        bucket = new Set();
        handlers.set(channel, bucket);
      }
      bucket.add(handler);
      return () => {
        bucket?.delete(handler);
      };
    },
    dispatch(channel, payload) {
      const bucket = handlers.get(channel);
      if (!bucket) return;
      // Snapshot so a handler that unsubscribes mid-dispatch
      // doesn't mutate the iterator.
      for (const h of [...bucket]) {
        try {
          h(payload);
        } catch (e) {
          // One handler's bug must not silence the others.
          console.error('[i99dash] event handler threw:', e);
        }
      }
    },
  };
  w[HOST_EVENTS_GLOBAL] = api;
  return api;
}

/// Bridge impl backed by the host-injected global. Constructing this
/// throws [NotInsideHostError] if no bridge is reachable — callers
/// usually go through `MiniAppClient.fromWindow()` which does the
/// same check and wraps this for you.
///
/// Implements [Bridge] (the always-required surface), [CarBridge]
/// (the v2 unified car-data surface — the `client.car` controller
/// reaches into `callHandler`), [CapabilitiesBridge] (handshake),
/// and [FamilyBridge] (native-capability families: display, surface,
/// cursor, gesture, pkg, boot). Older hosts that don't support a
/// given handler will reject the `callHandler` call; the SDK
/// surfaces that as `BridgeTransportError`.
export class HostBridge implements Bridge, CapabilitiesBridge, CarBridge, FamilyBridge {
  private readonly api: HostBridgeApi;

  constructor(windowLike?: WindowWithHost) {
    const w =
      windowLike ?? (typeof window !== 'undefined' ? (window as WindowWithHost) : undefined);
    if (!w) throw new NotInsideHostError('window is undefined');
    const api = resolveHostApi(w);
    if (!api) {
      throw new NotInsideHostError('host bridge is not present on window');
    }
    this.api = api;
  }

  async getContext(): Promise<unknown> {
    try {
      return await this.api.callHandler('getContext');
    } catch (cause) {
      throw new BridgeTransportError('getContext bridge call failed', cause);
    }
  }

  async capabilities(): Promise<unknown> {
    try {
      return await this.api.callHandler('capabilities');
    } catch (cause) {
      throw new BridgeTransportError('capabilities bridge call failed', cause);
    }
  }

  /// Raw `callHandler` proxy. The [CarController] uses this to reach
  /// the v2 `car.*` handler surface without having a typed wrapper
  /// per handler — the unified name-keyed contract makes the typed
  /// shim layer redundant. Errors are wrapped in
  /// [BridgeTransportError].
  async callHandler(name: string, ...args: unknown[]): Promise<unknown> {
    try {
      return await this.api.callHandler(name, ...args);
    } catch (cause) {
      throw new BridgeTransportError(`${name} bridge call failed`, cause);
    }
  }

  /// Generic family op. Routes to the host's `<familyId>.<op>`
  /// JS handler, which the host wires up to its
  /// [BridgeFamilyRegistry] + [FamilyExecutor]. Returns the host's
  /// success/error envelope verbatim — the controller decodes it.
  async callFamily(
    familyId: string,
    op: string,
    params?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const handlerName = `${familyId}.${op}`;
    const payload: Record<string, unknown> = {};
    if (params !== undefined) payload.params = params;
    if (idempotencyKey !== undefined) payload.idempotencyKey = idempotencyKey;
    try {
      return await this.api.callHandler(handlerName, payload);
    } catch (cause) {
      throw new BridgeTransportError(`${handlerName} bridge call failed`, cause);
    }
  }
}

/// Re-export the context type so consumers only need the one import.
export type { MiniAppContext };
