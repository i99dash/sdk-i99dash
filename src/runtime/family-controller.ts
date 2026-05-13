/// Shared base for every native-capability family controller
/// (display, surface, cursor, gesture, magnify, pkg, boot, …).
///
/// Centralises:
///   * The bridge capability check ([isFamilyBridge]) +
///     `*UnavailableError` shaping.
///   * Idempotency-key generation per call (mini-app developers
///     should never have to think about retry tokens).
///   * Envelope unwrap (`{success, data | error}` → throw or
///     return).
///
/// One pattern, applied N times. Each concrete controller is ~30
/// lines: a class with typed methods that build params, call
/// [invoke], and decode the typed response.
///
/// Mirrors the unified `CarController` shape so SDK consumers see
/// one mental model — the only difference is the underlying bridge
/// method.

import { ensureHostEvents, isFamilyBridge, type Bridge, type FamilyBridge } from './bridge.js';
import { SDKError } from './errors.js';

/// Cleanup closure returned by every `*.onChange` / subscribe API.
/// Calling it twice is a no-op.
export type UnsubscribeFn = () => void;

/// Generic envelope the host's [FamilyExecutor] returns. Mirrors
/// admin-sdk's `AdminOpResponse` so a single decoder handles both.
export type FamilyResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

/// Failure envelope from the host. Subclasses surface stable codes
/// like `permission_denied`, `surface_denied`, `step_up_required`
/// — see each family's docs for the per-handler list.
export class FamilyOpError extends SDKError {
  readonly errorCode: string;
  readonly familyId: string;
  readonly op: string;
  constructor(familyId: string, op: string, code: string, message: string) {
    super(
      'FamilyOpError',
      'FAMILY_OP_FAILED',
      'docs/api-ref/families.md#family_op_failed',
      `${familyId}.${op} failed: ${code} — ${message}`,
    );
    this.errorCode = code;
    this.familyId = familyId;
    this.op = op;
  }
}

/// Thrown when the host doesn't ship a family the SDK is asking
/// about. Use `client.has(scope)` to feature-detect at app start
/// and avoid this on legitimate runs.
export class FamilyUnavailableError extends SDKError {
  readonly familyId: string;
  constructor(familyId: string, message?: string) {
    super(
      'FamilyUnavailableError',
      'FAMILY_UNAVAILABLE',
      'docs/api-ref/families.md#family_unavailable',
      message ??
        `host does not ship the "${familyId}" family — ` +
          `feature-detect via client.has(scope) before calling`,
    );
    this.familyId = familyId;
  }
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export interface InvokeFamilyOptions {
  /// Caller-supplied retry token. The host's audit-chain replays the
  /// prior envelope when (appId, key) collides — so a network
  /// retry from the SDK doesn't double-execute the op. The base
  /// controller generates one automatically when omitted.
  idempotencyKey?: string;
}

/// Single-source decode for a family envelope. Throws
/// [FamilyOpError] on `{success: false}`; returns `data` on
/// `{success: true}`. Defined as a free function so concrete
/// controllers can reuse it without inheriting an abstract base
/// (lighter typing, easier tree-shaking).
export function decodeFamilyEnvelope<T>(familyId: string, op: string, raw: unknown): T {
  const env = raw as FamilyResponse<T>;
  if (env && typeof env === 'object' && 'success' in env) {
    if (env.success) return env.data;
    throw new FamilyOpError(familyId, op, env.error?.code ?? 'unknown', env.error?.message ?? '');
  }
  throw new FamilyOpError(
    familyId,
    op,
    'invalid_response',
    `host returned a payload that doesn't match the {success, data|error} envelope`,
  );
}

/// Base class concrete controllers extend. Holds the bridge +
/// the static family id; concrete controllers implement typed
/// methods that compose [invoke].
export abstract class BaseFamilyController {
  protected readonly bridge: FamilyBridge;
  protected readonly familyId: string;

  protected constructor(bridge: Bridge, familyId: string) {
    if (!isFamilyBridge(bridge)) {
      throw new FamilyUnavailableError(
        familyId,
        `bridge does not implement FamilyBridge — host build is too old`,
      );
    }
    this.bridge = bridge;
    this.familyId = familyId;
  }

  protected async invoke<T>(
    op: string,
    params?: Record<string, unknown>,
    opts: InvokeFamilyOptions = {},
  ): Promise<T> {
    const key = opts.idempotencyKey ?? newIdempotencyKey();
    const raw = await this.bridge.callFamily(this.familyId, op, params, key);
    return decodeFamilyEnvelope<T>(this.familyId, op, raw);
  }

  /// Subscribe to the host's event channel for this family. Calls
  /// the family's `subscribe` op (returning `{id}`), registers a
  /// listener on `__i99dashEvents` for `this.familyId`, and returns
  /// an [UnsubscribeFn] that:
  ///   1. Removes the in-process listener (immediate stop).
  ///   2. Fires the family's `unsubscribe` op with the host-issued
  ///      id (host-side cleanup).
  ///
  /// Idempotent: calling the returned closure twice is a no-op. The
  /// caller's `handler` is invoked once per native push with the
  /// already-typed payload — concrete controllers (e.g.
  /// `DisplayController.onChange`) wrap this with a typed cast.
  ///
  /// Errors during the host-side subscribe call propagate
  /// (`FamilyOpError` / `FamilyUnavailableError`) — that's the same
  /// surface every other family op uses; consumers don't need a
  /// separate error model for subscriptions.
  protected async subscribe(handler: (payload: unknown) => void): Promise<UnsubscribeFn> {
    const events = ensureHostEvents();
    // Wire the in-process listener BEFORE the host-side call so an
    // event that fires between the subscribe RPC returning and us
    // installing the listener doesn't get lost.
    const offLocal = events.on(this.familyId, handler);

    let hostId: string | undefined;
    try {
      const data = await this.invoke<{ id: string }>('subscribe', {});
      hostId = data.id;
    } catch (err) {
      // Roll back the local listener; we never bound a host id, so
      // there's no host-side state to release.
      offLocal();
      throw err;
    }

    let off = false;
    return () => {
      if (off) return;
      off = true;
      offLocal();
      // Fire-and-forget: the local listener is already detached, so
      // even if the host call fails the consumer gets the cleanup
      // semantics they expect. The host-side bus also self-detaches
      // on the next event if the WebView is gone.
      void this.invoke<{ ok: boolean }>('unsubscribe', { id: hostId }).catch(() => {
        /* swallow — see comment above */
      });
    };
  }
}
