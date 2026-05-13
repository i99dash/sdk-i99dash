/// Unified `client.car` controller — wraps every `car.*` bridge
/// handler exposed by the host's v2 `CarBridgeService`.
///
/// The host owns one name-keyed catalog per brand (BYD today, more
/// brands later); mini-apps read by name, write by `actionId`. This
/// controller is the only SDK surface for car data; per-family
/// shims (climate, media, location, …) were removed in v5.
///
/// API at a glance:
///
///   const list   = await client.car.list({ category: 'climate' });
///   const snap   = await client.car.read(['ac_power', 'speed_kmh']);
///   const off    = await client.car.subscribe({
///                    names: ['speed_kmh'],
///                    onEvent: e => render(e.value),
///                  });
///   const ok     = await client.car.command('climate.power.toggle');
///   const ident  = await client.car.identity();   // memoised per car
///   const asset  = await client.car.asset('assets/3d/leopard8.glb');
///   const offC   = await client.car.connectionSubscribe(
///                    state => banner(state),
///                  );
///
/// All wire shapes are Zod-validated on receipt; consumer types are
/// derived from the schemas in `../types/car.ts`.

import {
  CarAssetResponseSchema,
  type CarCatalogList,
  CarCatalogListSchema,
  type CarCommandResponse,
  CarCommandResponseSchema,
  type CarConnectionState,
  CarConnectionPushEnvelopeSchema,
  type CarIdentity,
  CarIdentitySchema,
  type CarReadResponse,
  CarReadResponseSchema,
  type CarSignalEvent,
  CarSignalPushEnvelopeSchema,
  CarSubscribeResponseSchema,
} from '../types/car.js';

import { ensureHostEvents, type Bridge, type HostEventsApi } from './bridge.js';
import { BridgeTransportError, InvalidResponseError } from './errors.js';

/// Cap mirrors the host's `kMaxNamesPerSubscription`. Both sides
/// enforce; the SDK rejects locally so consumers get a typed error
/// instead of a generic bridge round-trip failure.
export const CAR_MAX_NAMES = 64;

export type CarSignalListener = (event: CarSignalEvent) => void;
export type CarConnectionListener = (state: CarConnectionState) => void;

/// Re-export the wire types from the SDK's runtime entry-point so a
/// consumer only needs one import.
export type {
  CarAssetResponse,
  CarCatalogEntry,
  CarCatalogList,
  CarCommandResponse,
  CarConnectionState,
  CarIdentity,
  CarReadResponse,
  CarSignalEvent,
  CarSubscribeResponse,
} from '../types/car.js';

/// Decoded asset payload — bytes already base64-decoded. The raw
/// `bytesBase64` string never reaches consumer code.
export interface CarAssetBytes {
  path: string;
  contentType: string;
  size: number;
  bytes: Uint8Array;
}

interface CarBridgeApi {
  callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
}

/// Mini-app facing controller. One instance per [MiniAppClient];
/// lazily instantiated on first access.
///
/// All bridge calls go through the same `callHandler` channel the
/// host exposes via `window.__i99dashHost.callHandler`. Push events
/// (`car.signal`, `car.connection`) arrive on `__i99dashEvents` —
/// the controller installs the dispatcher lazily on the first
/// `subscribe`.
export class CarController {
  private readonly bridge: Bridge;
  /// Memoised identity. Cleared when the connection-state listener
  /// observes `'disconnected'` so a swap-car flow picks up the new
  /// brand/model on the next call.
  private _identityCache: CarIdentity | null = null;
  /// Local per-subscriptionId → listener routing for `car.signal`.
  private _signalRoutes = new Map<string, CarSignalListener>();
  /// Local per-subscriptionId → listener routing for `car.connection`.
  private _connectionRoutes = new Map<string, CarConnectionListener>();
  /// Single shared bus listeners, installed once the first
  /// subscribe lands. Storing the unsubscribe fn lets us tear the
  /// page-global handler down only after every per-id route is gone.
  private _signalBusOff: (() => void) | null = null;
  private _connectionBusOff: (() => void) | null = null;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  // ── car.list ─────────────────────────────────────────────────────

  async list(opts: { category?: string; threeDOnly?: boolean } = {}): Promise<CarCatalogList> {
    const payload: Record<string, unknown> = {};
    if (opts.category !== undefined) payload.category = opts.category;
    if (opts.threeDOnly !== undefined) payload.threeDOnly = opts.threeDOnly;
    const raw = await this._call('car.list', payload);
    return _parse(CarCatalogListSchema, raw, 'car.list');
  }

  // ── car.read ─────────────────────────────────────────────────────

  async read(names: string[]): Promise<CarReadResponse> {
    if (names.length > CAR_MAX_NAMES) {
      throw new Error(`signals.too_many_names: requested ${names.length}, max ${CAR_MAX_NAMES}`);
    }
    const raw = await this._call('car.read', { names });
    if (_isErrorEnvelope(raw)) {
      throw new Error(`car.read returned error: ${_errString(raw)}`);
    }
    return _parse(CarReadResponseSchema, raw, 'car.read');
  }

  // ── car.subscribe / car.unsubscribe ──────────────────────────────

  /// Subscribe to the host's name-keyed signal stream. Returns an
  /// async unsubscribe closure — idempotent (calling twice is a
  /// no-op). The optional `signal` aborts the subscription
  /// synchronously when fired.
  ///
  /// Rejects with `Error('signals.too_many_names')` when
  /// `names.length > 64` so consumers don't pay for a round-trip to
  /// see the host's `too_many_names` envelope.
  async subscribe(opts: {
    names: string[];
    onEvent: CarSignalListener;
    signal?: AbortSignal;
  }): Promise<() => void> {
    if (opts.names.length > CAR_MAX_NAMES) {
      throw new Error('signals.too_many_names');
    }
    const idempotencyKey = _newUuid();
    this._ensureSignalBus();
    const raw = await this._call('car.subscribe', {
      names: opts.names,
      idempotencyKey,
    });
    if (_isErrorEnvelope(raw)) {
      throw new Error(`car.subscribe returned error: ${_errString(raw)}`);
    }
    const parsed = _parse(CarSubscribeResponseSchema, raw, 'car.subscribe');
    const subscriptionId = parsed.subscriptionId;
    this._signalRoutes.set(subscriptionId, opts.onEvent);

    let off = false;
    const unsubscribe = (): void => {
      if (off) return;
      off = true;
      this._signalRoutes.delete(subscriptionId);
      this._maybeTearDownSignalBus();
      void this._call('car.unsubscribe', { subscriptionId }).catch(() => {
        // Local routing is already gone; the host-side cleanup
        // failing is bounded — the next dispose-all wipes it.
      });
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        unsubscribe();
      } else {
        opts.signal.addEventListener('abort', unsubscribe, { once: true });
      }
    }

    return unsubscribe;
  }

  // ── car.command ──────────────────────────────────────────────────

  async command(
    actionId: string,
    args: Record<string, unknown> = {},
    opts: { idempotencyKey?: string } = {},
  ): Promise<CarCommandResponse> {
    const idempotencyKey = opts.idempotencyKey ?? _newUuid();
    const raw = await this._call('car.command', {
      actionId,
      args,
      idempotencyKey,
    });
    return _parse(CarCommandResponseSchema, raw, 'car.command');
  }

  // ── car.identity ─────────────────────────────────────────────────

  /// Returns the brand / model / 3D-asset descriptor. Memoised per
  /// car for the lifetime of the controller — cleared automatically
  /// when the connection-state subscriber observes
  /// `'disconnected'`, so a swap-car flow picks up the new identity
  /// on the next call.
  async identity(): Promise<CarIdentity> {
    if (this._identityCache) return this._identityCache;
    const raw = await this._call('car.identity', {});
    const parsed = _parse(CarIdentitySchema, raw, 'car.identity');
    this._identityCache = parsed;
    return parsed;
  }

  // ── car.asset ────────────────────────────────────────────────────

  /// Load a bundle-resident asset (3D model / texture) and return
  /// its bytes already base64-decoded. Throws on a host-emitted error
  /// envelope (`disallowed_path`, `asset_not_found`, `asset_too_large`).
  async asset(path: string): Promise<CarAssetBytes> {
    const raw = await this._call('car.asset', { path });
    if (_isErrorEnvelope(raw)) {
      throw new Error(`car.asset returned error: ${_errString(raw)}`);
    }
    const parsed = _parse(CarAssetResponseSchema, raw, 'car.asset');
    return {
      path: parsed.path,
      contentType: parsed.contentType,
      size: parsed.size,
      bytes: _decodeBase64(parsed.bytesBase64),
    };
  }

  // ── car.connection.subscribe / unsubscribe ───────────────────────

  /// Subscribe to host connection-state transitions. The host emits
  /// the initial state on a microtask, then again on every flip.
  /// On `'disconnected'` the identity cache is invalidated so a
  /// later car swap re-fetches.
  async connectionSubscribe(onChange: CarConnectionListener): Promise<() => void> {
    this._ensureConnectionBus();
    const raw = await this._call('car.connection.subscribe', {});
    if (_isErrorEnvelope(raw)) {
      throw new Error(`car.connection.subscribe returned error: ${_errString(raw)}`);
    }
    const subscriptionId = _extractSubscriptionId(raw);
    if (!subscriptionId) {
      throw new BridgeTransportError(
        'car.connection.subscribe response missing subscriptionId',
        raw,
      );
    }
    const wrapped: CarConnectionListener = (state) => {
      if (state === 'disconnected') this._identityCache = null;
      onChange(state);
    };
    this._connectionRoutes.set(subscriptionId, wrapped);
    let off = false;
    return () => {
      if (off) return;
      off = true;
      this._connectionRoutes.delete(subscriptionId);
      this._maybeTearDownConnectionBus();
      void this._call('car.connection.unsubscribe', { subscriptionId }).catch(() => {});
    };
  }

  // ── Internals ────────────────────────────────────────────────────

  private async _call(handler: string, payload: unknown): Promise<unknown> {
    const api = _hostApi(this.bridge);
    try {
      return await api.callHandler(handler, payload);
    } catch (cause) {
      throw new BridgeTransportError(`${handler} bridge call failed`, cause);
    }
  }

  private _ensureSignalBus(): void {
    if (this._signalBusOff) return;
    const events: HostEventsApi = ensureHostEvents();
    this._signalBusOff = events.on('car.signal', (payload) => {
      const env = _parseSafe(CarSignalPushEnvelopeSchema, payload);
      if (!env) return; // malformed, drop
      const route = this._signalRoutes.get(env.subscriptionId);
      if (!route) return;
      try {
        route(env.data);
      } catch (e) {
        console.error('[i99dash] car.signal listener threw:', e);
      }
    });
  }

  private _maybeTearDownSignalBus(): void {
    if (this._signalRoutes.size > 0) return;
    this._signalBusOff?.();
    this._signalBusOff = null;
  }

  private _ensureConnectionBus(): void {
    if (this._connectionBusOff) return;
    const events: HostEventsApi = ensureHostEvents();
    this._connectionBusOff = events.on('car.connection', (payload) => {
      const env = _parseSafe(CarConnectionPushEnvelopeSchema, payload);
      if (!env) return;
      const route = this._connectionRoutes.get(env.subscriptionId);
      if (!route) return;
      try {
        route(env.state);
      } catch (e) {
        console.error('[i99dash] car.connection listener threw:', e);
      }
    });
  }

  private _maybeTearDownConnectionBus(): void {
    if (this._connectionRoutes.size > 0) return;
    this._connectionBusOff?.();
    this._connectionBusOff = null;
  }
}

// ── module-private helpers ─────────────────────────────────────────

function _parse<T>(
  schema: {
    safeParse: (raw: unknown) => { success: true; data: T } | { success: false; error: unknown };
  },
  raw: unknown,
  label: string,
): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new InvalidResponseError(`${label} payload did not match schema`, result.error);
  }
  return result.data;
}

function _parseSafe<T>(
  schema: {
    safeParse: (raw: unknown) => { success: true; data: T } | { success: false; error: unknown };
  },
  raw: unknown,
): T | null {
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}

function _isErrorEnvelope(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && 'error' in (raw as Record<string, unknown>);
}

function _errString(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return String(raw);
  const o = raw as Record<string, unknown>;
  return JSON.stringify(o);
}

function _extractSubscriptionId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw as Record<string, unknown>).subscriptionId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function _newUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122 v4-ish fallback. Not security-grade; the host's
  // audit chain doesn't care because the key is per-call.
  let s = '';
  for (let i = 0; i < 32; i++) {
    const r = (Math.random() * 16) | 0;
    s += r.toString(16);
    if (i === 7 || i === 11 || i === 15 || i === 19) s += '-';
  }
  return s;
}

function _decodeBase64(b64: string): Uint8Array {
  // Browser path — `atob` plus a manual byte unpack. Node 16+ also
  // has `atob` on globalThis. Avoid `Buffer` so the dev-server's
  // browser-bundle path stays clean.
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Older Node (shouldn't happen, package.json pins >=20).
  // Use globalThis.Buffer to avoid pulling Node types into the
  // browser bundle.
  const g = globalThis as unknown as {
    Buffer?: {
      from: (
        s: string,
        enc: string,
      ) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    };
  };
  if (g.Buffer) {
    const buf = g.Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  throw new Error('no base64 decoder available — runtime missing atob and Buffer');
}

/// Reach into the bridge object for the raw `callHandler` API. Every
/// `Bridge` is built on top of one — `HostBridge` exposes it as a
/// private; `FetchBridge` re-implements it; test stubs provide one
/// shaped like `{callHandler}` when needed. The car controller does
/// not use the per-family typed surface; it speaks the raw protocol.
function _hostApi(bridge: Bridge): CarBridgeApi {
  // Test path: the bridge directly exposes `callHandler`.
  const direct = bridge as Partial<CarBridgeApi> & { callHandler?: unknown };
  if (typeof direct.callHandler === 'function') {
    return direct as CarBridgeApi;
  }
  // Production path: `HostBridge` exposes its `api: HostBridgeApi`
  // privately. Cast through the typed structural shape we know
  // about (it's an in-package implementation detail; the production
  // bridge construction goes through `HostBridge`).
  const internal = bridge as unknown as { api?: { callHandler?: unknown } };
  if (internal.api && typeof internal.api.callHandler === 'function') {
    return internal.api as CarBridgeApi;
  }
  throw new BridgeTransportError(
    'bridge does not expose a callHandler — cannot reach v2 car.* handlers',
    bridge,
  );
}
