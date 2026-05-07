/// Generic privileged-op client — Phase-9 thin shape.
///
/// Phase-9 refactor: the SDK no longer manages capability tokens at
/// all. The Flutter host owns the session cap (and the per-action
/// step-up cap when needed) in its SQLite store and attaches it
/// internally before dispatching the op. The SDK is now exactly:
///
///     await admin.invoke('pm.disable_user', {
///       user: 0,
///       package: 'com.byd.trafficmonitor',
///     });
///
/// One round-trip into the host's ``_admin.exec`` handler. No HTTP
/// from the mini-app, ever — the host decides whether to call
/// ``/runtime/cap`` (step-up) and the mini-app never sees the cap
/// envelope. That's the security property: a compromised mini-app
/// bundle has no cap to leak.

import { SDKError, withTimeout } from '../runtime/index.js';

import type { AdminBridge, AdminExecRequest } from './bridge.js';
import { HostAdminBridge } from './bridge.js';
import type { AdminOpResponse, CatalogSnapshot, CommandTemplate } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/// Required context the host injects via the regular ``getContext``
/// bridge. Used here only for `appId` so a mini-app calling on a
/// stale catalog can detect drift; the host's dispatcher carries
/// the authoritative (user, bydDeviceId, cert_hash) tuple.
///
/// **v3.1 rename:** `vin` was renamed to `bydDeviceId`. Both fields
/// remain accepted during the v3.x line — pass either or both, and
/// the SDK normalizes internally (preferring `bydDeviceId` when both
/// are present). The legacy `vin` will be removed in v4.0.
/// See MIGRATING.md.
export interface AdminClientContext {
  appId: string;
  /// BYD media/cloud device handle for the active car. NOT the chassis
  /// VIN — see MIGRATING.md. Required when `vin` is not provided.
  /// @since 3.1.0
  bydDeviceId?: string;
  /**
   * @deprecated Renamed to `bydDeviceId` in v3.1. Still accepted as
   * input; will be removed in v4.0. See MIGRATING.md.
   */
  vin?: string;
}

/// Per-call options.
export interface InvokeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/// Construction options. Phase-9 dropped the cap-related fields.
export interface AdminClientOptions {
  bridge: AdminBridge;
  /// Mini-app context. Pass either `bydDeviceId` (preferred) or the
  /// legacy `vin` field; the SDK accepts both during the v3.x line.
  context: AdminClientContext;
  /// Catalog snapshot — fetched once at boot from the host's
  /// catalog-mirror endpoint, then handed to the client. The host's
  /// dispatcher uses its own SQLite-cached catalog as the
  /// authoritative source; this catalog drives client-side
  /// affordances (template metadata for UIs).
  catalog: CatalogSnapshot;
}

function uuidish(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export class UnknownTemplateError extends SDKError {
  readonly templateId: string;
  constructor(templateId: string) {
    super(
      'UnknownTemplateError',
      'UNKNOWN_TEMPLATE',
      'docs/api-ref/admin-templates.md#unknown_template',
      `admin SDK: unknown template id "${templateId}" — not present in the catalog snapshot. ` +
        `Refresh the catalog (the host's dispatcher may have a newer version) ` +
        `(see docs/api-ref/admin-templates.md#unknown_template)`,
    );
    this.templateId = templateId;
  }
}

export class AdminClient {
  private readonly bridge: AdminBridge;
  private readonly context: AdminClientContext;
  private readonly catalog: CatalogSnapshot;

  private constructor(opts: AdminClientOptions) {
    this.bridge = opts.bridge;
    this.context = opts.context;
    this.catalog = opts.catalog;
  }

  /// Production constructor: pulls the host bridge from ``window``.
  static fromWindow(opts: { context: AdminClientContext; catalog: CatalogSnapshot }): AdminClient {
    return new AdminClient({
      bridge: new HostAdminBridge(),
      context: opts.context,
      catalog: opts.catalog,
    });
  }

  /// Test constructor — wire up a custom bridge.
  static withBridge(opts: AdminClientOptions): AdminClient {
    return new AdminClient(opts);
  }

  /// Lookup helper for UIs that want to render "available commands"
  /// lists. Reads the client-side catalog snapshot (informational —
  /// the host's dispatcher consults its own copy authoritatively).
  listTemplates(): readonly CommandTemplate[] {
    return Array.from(this.catalog.templates.values());
  }

  /// Invoke an op. The host attaches whatever cap is needed
  /// (session cap for tier-2 non-step-up, per-action cap for
  /// step-up) and returns the result envelope.
  async invoke<T = unknown>(
    templateId: string,
    params?: Record<string, unknown>,
    opts: InvokeOptions = {},
  ): Promise<AdminOpResponse<T>> {
    if (this.catalog.templates.get(templateId) === undefined) {
      throw new UnknownTemplateError(templateId);
    }

    const idempotencyKey = uuidish();
    const req: AdminExecRequest = {
      templateId,
      params,
      idempotencyKey,
    };

    return withTimeout(
      `_admin.exec(${templateId})`,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      () => this.bridge.exec<T>(req),
      opts.signal,
    );
  }

  // ── Convenience wrappers (BYD-specific commands) ────────────────
  // Each thin wrapper just calls ``invoke`` with a known id +
  // type-narrowed params. New BYD commands ship as a server-side
  // migration AND a wrapper here in the same PR — wrappers are
  // optional but improve callsite readability.
  //
  // Every wrapper accepts a trailing `InvokeOptions` so callers can
  // override timeout / pass an AbortSignal without dropping into
  // generic `invoke()`.

  async tailLogs(
    input: { lines?: number } = {},
    opts?: InvokeOptions,
  ): Promise<AdminOpResponse<{ lines: string[] }>> {
    return this.invoke('diag.tail_logs', input, opts);
  }

  async mqttStatus(
    opts?: InvokeOptions,
  ): Promise<AdminOpResponse<{ connected: boolean; lastMessageAt: string | null }>> {
    return this.invoke('diag.mqtt_status', undefined, opts);
  }

  async listUsers(opts?: InvokeOptions): Promise<AdminOpResponse<{ users: string[] }>> {
    return this.invoke('pm.list_users', undefined, opts);
  }

  async listPackages(opts?: InvokeOptions): Promise<AdminOpResponse<{ packages: string[] }>> {
    return this.invoke('pm.list_packages', undefined, opts);
  }

  async disableUser(
    input: { user: 0 | 999; package: string },
    opts?: InvokeOptions,
  ): Promise<AdminOpResponse<{ disabled: true }>> {
    return this.invoke('pm.disable_user', input, opts);
  }

  async enableUser(
    input: { user: 0 | 999; package: string },
    opts?: InvokeOptions,
  ): Promise<AdminOpResponse<{ enabled: true }>> {
    return this.invoke('pm.enable_user', input, opts);
  }

  async restartMqtt(opts?: InvokeOptions): Promise<AdminOpResponse<{ reconnectedAt: string }>> {
    return this.invoke('diag.restart_mqtt', undefined, opts);
  }

  async clearCache(opts?: InvokeOptions): Promise<AdminOpResponse<{ bytesFreed: number }>> {
    return this.invoke('diag.clear_cache', undefined, opts);
  }

  async reboot(opts?: InvokeOptions): Promise<AdminOpResponse<{ schedulingAt: string }>> {
    return this.invoke('sys.reboot', undefined, opts);
  }

  async installApk(
    input: { user: 0 | 999; apkPath: string },
    opts?: InvokeOptions,
  ): Promise<AdminOpResponse<{ packageName: string }>> {
    return this.invoke('pm.install', { user: input.user, apk_path: input.apkPath }, opts);
  }
}

// Re-export the timeout error from the public SDK so admin callers
// can ``catch (e instanceof BridgeTimeoutError)`` without a second
// import.
export { BridgeTimeoutError } from '../runtime/index.js';
