import {
  type CallApiRequest,
  type CallApiResponse,
  CallApiResponseSchema,
  type HostCapabilities,
  HostCapabilitiesSchema,
  type MiniAppContext,
  MiniAppContextSchema,
} from '../types/index.js';

import type { Bridge } from './bridge.js';
import { HostBridge, isCapabilitiesBridge, isCarBridge } from './bridge.js';
import { CarController } from './car.js';
import { BootController } from './boot.js';
import { CursorController } from './cursor.js';
import { DisplayController } from './display.js';
import { GestureController } from './gesture.js';
import { PkgController } from './pkg.js';
import { SurfaceController } from './surface.js';
import { CallApiFailedError, InvalidResponseError, NotInsideHostError } from './errors.js';
import { PermissionDeniedAggregator, type PermissionDeniedListener } from './permission-denied.js';
import { withTimeout } from './util/timeout.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface CallOptions {
  /// Abort the in-flight call when this signal fires. Rejects with
  /// the signal's reason; default DOM-standard behaviour.
  signal?: AbortSignal;
  /// Per-call timeout override (milliseconds). Defaults to 10_000.
  /// A timeout rejects with `BridgeTimeoutError`.
  timeoutMs?: number;
}

/// High-level typed client over a [Bridge].
///
/// Construction paths:
///
///   - `MiniAppClient.fromWindow()` — for production use inside the
///     host. Throws `NotInsideHostError` if no bridge is present,
///     which is the common "running in Storybook / Jest" tripwire.
///
///   - `MiniAppClient.withBridge(bridge)` — for tests, SSR, or the
///     local dev-server. Pass any object that satisfies [Bridge].
///
/// The client is stateless and cheap; construct once per app / per
/// test and re-use.
export class MiniAppClient {
  private constructor(private readonly bridge: Bridge) {}

  /// Unified car-data surface. Wraps every `car.*` bridge handler
  /// the host exposes via v2 `CarBridgeService`: `list`, `read`,
  /// `subscribe`, `command`, `identity`, `asset`,
  /// `connectionSubscribe`. Read by name, write by `actionId` — see
  /// the host's per-brand public catalog for the full name list.
  ///
  /// Lazy — instance is not created until first access. Throws
  /// `BridgeTransportError` from individual methods when the bridge
  /// doesn't ship `callHandler` (older host pre-v2, plain test stub).
  get car(): CarController {
    this._car ??= new CarController(this.bridge);
    return this._car;
  }
  private _car: CarController | undefined;

  /// Display enumeration (`display.read` scope, tier-1). Returns the
  /// list of addressable displays — the head unit's primary IVI, the
  /// instrument cluster, and any passenger / HUD virtual displays the
  /// vehicle exposes. Required to call `client.surface.create`.
  get display(): DisplayController {
    this._display ??= new DisplayController(this.bridge);
    return this._display;
  }
  private _display: DisplayController | undefined;

  /// Multi-display rendering (`surface.write` scope, tier-2 with
  /// install-time consent). Open a Presentation / overlay surface on
  /// a target display so the mini-app can render outside the IVI
  /// (e.g. a custom widget on the instrument cluster). Falls back to
  /// `TYPE_APPLICATION_OVERLAY` when the platform denies a
  /// Presentation; reports `path` so diagnostics can branch.
  get surface(): SurfaceController {
    this._surface ??= new SurfaceController(this.bridge);
    return this._surface;
  }
  private _surface: SurfaceController | undefined;

  /// Synthetic-input surface (`gesture.dispatch` scope, tier-2 with
  /// per-action step-up). Inject taps / swipes / longPresses on a
  /// target display via the host's RemoteControlAccessibilityService.
  /// The realistic "remote control of cluster" capability when pixel
  /// rendering is signature-gated (Leopard 8 — see PHASE_B_PLAN.md).
  get gesture(): GestureController {
    this._gesture ??= new GestureController(this.bridge);
    return this._gesture;
  }
  private _gesture: GestureController | undefined;

  /// IVI-side cursor surface (`cursor.write` scope, tier-2 with
  /// 5-second hot-path bypass on `move`). Mounts a touchpad-style
  /// indicator on the IVI as visual feedback for where the eventual
  /// `gesture.dispatch` will land. Pairs with [gesture] for "drive
  /// cluster apps from the IVI" mini-apps.
  get cursor(): CursorController {
    this._cursor ??= new CursorController(this.bridge);
    return this._cursor;
  }
  private _cursor: CursorController | undefined;

  /// Package surface (`pkg.read` tier-1 + `pkg.launch` tier-2).
  /// Read-side handlers (`list`, `foreground`, `usage`) are
  /// available on a secondary surface; the launch handler is
  /// IVI-only.  Powers "open this app on the cluster" launchers
  /// and "now playing on IVI" widgets.
  get pkg(): PkgController {
    this._pkg ??= new PkgController(this.bridge);
    return this._pkg;
  }
  private _pkg: PkgController | undefined;

  /// Boot-launch surface (`boot.write` tier-2). Declare which
  /// packages auto-launch on cold boot, optionally pinned to a
  /// non-default display.  Persists across reboots in the host's
  /// admin DB; per-mini-app isolation prevents cross-app
  /// snooping of declarations.
  get boot(): BootController {
    this._boot ??= new BootController(this.bridge);
    return this._boot;
  }
  private _boot: BootController | undefined;

  static fromWindow(): MiniAppClient {
    if (typeof window === 'undefined') {
      throw new NotInsideHostError('window is undefined (SSR or Node)');
    }
    // HostBridge's constructor does the same check; calling it surfaces
    // the specific reason (missing global vs. missing callHandler) in
    // the error message.
    return new MiniAppClient(new HostBridge());
  }

  static withBridge(bridge: Bridge): MiniAppClient {
    return new MiniAppClient(bridge);
  }

  /// Returns the current host context. Schema-validated — a host that
  /// ships a newer shape with new fields stays compatible (zod strips
  /// unknown properties by default on `.parse`), but a host that drops
  /// a required field throws `InvalidResponseError` here rather than
  /// propagating a half-typed value.
  async getContext(opts?: CallOptions): Promise<MiniAppContext> {
    const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const raw = await withTimeout(
      'getContext',
      timeout,
      () => this.bridge.getContext(),
      opts?.signal,
    );
    const parsed = MiniAppContextSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidResponseError('getContext payload did not match schema', parsed.error);
    }
    return parsed.data;
  }

  /// Proxies [req] through the host's allow-listed `callApi`.
  ///
  /// NOTE: this method does **not** throw on `{success: false}`
  /// responses. A `disallowed_path` response is a legitimate thing the
  /// caller can handle — surfacing it as an exception would force
  /// consumers to `try/catch` the happy path too. Genuine errors
  /// (bridge transport, timeout, malformed envelope) do throw.
  async callApi<T = unknown>(req: CallApiRequest, opts?: CallOptions): Promise<CallApiResponse<T>> {
    const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const raw = await withTimeout('callApi', timeout, () => this.bridge.callApi(req), opts?.signal);
    const parsed = CallApiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidResponseError('callApi envelope did not match schema', parsed.error);
    }
    const env = parsed.data as CallApiResponse<T>;
    // Forward permission-denied envelopes to the SDK-wide aggregator
    // so app code can wire a single analytics handler instead of
    // branching on every call site.
    if (!env.success && env.error.code === 'permission_denied') {
      this._permissionDenied.emit(`callApi:${req.path}`);
    }
    return env;
  }

  /// Like [callApi] but lifts a `{success: false}` envelope into a
  /// thrown [CallApiFailedError]. The original protocol error code is
  /// preserved on `err.errorCode` so a `try/catch` consumer can still
  /// branch on it.
  ///
  /// Use this when the failure is genuinely exceptional and the
  /// envelope-unwrap noise is worse than the throw — e.g. inside a
  /// React `useQuery`, a Suspense boundary, or any code that wants
  /// the typed-data path uncluttered. Stick with [callApi] for code
  /// that wants happy/sad-path symmetry.
  async callApiOrThrow<T = unknown>(req: CallApiRequest, opts?: CallOptions): Promise<T> {
    const r = await this.callApi<T>(req, opts);
    if (r.success) return r.data;
    throw new CallApiFailedError(r.error.code, r.error.message);
  }

  /// Bridge-capability handshake. Returns the host's declared
  /// `bridgeVersion` and the set of permission/family scopes it has
  /// handlers for.
  ///
  /// Older hosts that pre-date the handshake handler don't expose
  /// `capabilities` — calling this on such a host returns the SDK's
  /// best-effort fallback (`bridgeVersion: 'unknown'`, families
  /// derived from the bridge's structural capabilities). That keeps
  /// `client.has(scope)` deterministic across host versions.
  async capabilities(opts?: CallOptions): Promise<HostCapabilities> {
    if (this._capsCache) return this._capsCache;
    const bridge = this.bridge;
    if (!isCapabilitiesBridge(bridge)) {
      // Fallback: derive from what we can see structurally on the bridge.
      // Pre-handshake hosts that ship the v2 `callHandler` surface
      // declare the `car` family; tests with a plain stub get [].
      const families: string[] = [];
      if (isCarBridge(bridge)) families.push('car');
      this._capsCache = { bridgeVersion: 'unknown', families };
      return this._capsCache;
    }
    const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const raw = await withTimeout(
      'capabilities',
      timeout,
      () => bridge.capabilities(),
      opts?.signal,
    );
    const parsed = HostCapabilitiesSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidResponseError('capabilities payload did not match schema', parsed.error);
    }
    this._capsCache = parsed.data;
    return parsed.data;
  }
  private _capsCache: HostCapabilities | undefined;

  /// Predicate over the host's capabilities. Memoised by
  /// [capabilities]; first call hits the bridge, subsequent calls are
  /// in-process. Cheap to call from render paths.
  ///
  /// Idiomatic use:
  ///
  ///   if (await client.has('car')) { ... } else { ... }
  async has(scope: string): Promise<boolean> {
    const caps = await this.capabilities();
    return caps.families.includes(scope);
  }

  /// Subscribe an analytics-style handler to every `permission_denied`
  /// failure the SDK observes — across `callApi` and (in a future
  /// release) any new family controller. Returns an idempotent
  /// unsubscribe fn.
  ///
  /// `scope` argument forwarded to the listener identifies which
  /// surface produced the denial — e.g. `callApi:/api/v1/foo`,
  /// `car`. App code typically forwards to its analytics pipeline:
  ///
  ///   client.onPermissionDenied(scope => analytics.track('denied', { scope }));
  onPermissionDenied(listener: PermissionDeniedListener): () => void {
    return this._permissionDenied.on(listener);
  }
  private readonly _permissionDenied = new PermissionDeniedAggregator();
}
