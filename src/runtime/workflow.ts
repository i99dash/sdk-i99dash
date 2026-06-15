/// Mini-app-facing controller for the host's `workflow.*` handlers.
///
/// Read-only Tier-1; no consent prompt. The first member is
/// `workflow.catalog` — the authorable ACTION palette for the workflow
/// canvas. `car.list` returns readable signals only (for triggers /
/// conditions); the writable command registry has no other SDK surface,
/// so this is the gap-fill. Future `workflow.*` reads (engine support
/// descriptor, run history) live here too.
///
///     const { actions } = await client.workflow.catalog();
///     const dangerous = actions.filter((a) => a.securityClass !== 'none');
///
/// Wire shapes are Zod-validated on receipt; see `../types/workflow.ts`.

import {
  WorkflowCatalogResponseSchema,
  type WorkflowCatalogResponse,
  WorkflowListResponseSchema,
  WorkflowRecordSchema,
  type WorkflowRecord,
  type WorkflowSource,
} from '../types/workflow.js';
import { type Bridge } from './bridge.js';
import { BridgeTransportError, InvalidResponseError } from './errors.js';

interface WorkflowBridgeApi {
  callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
}

/// Mini-app facing controller. One instance per [MiniAppClient];
/// lazily instantiated on first access. Plain `callHandler` channel —
/// same Tier-1 surface as `car.*`, not a consent-gated family.
export class WorkflowController {
  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  /// The canvas action palette: the host command registry serialized
  /// with safety flags (`securityClass` / `requiresStationary` /
  /// `rateClass` / `reversible`). Mirrors `CarBridgeService.workflowCatalog()`.
  async catalog(): Promise<WorkflowCatalogResponse> {
    const raw = await this._call('workflow.catalog', {});
    const result = WorkflowCatalogResponseSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidResponseError('workflow.catalog payload did not match schema', result.error);
    }
    return result.data;
  }

  /// The signed-in user's workflows (full bodies) for the canvas list.
  /// Host-proxied to the authenticated backend.
  async list(): Promise<WorkflowRecord[]> {
    const raw = await this._call('workflow.list', {});
    _throwIfError(raw, 'workflow.list');
    const result = WorkflowListResponseSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidResponseError('workflow.list payload did not match schema', result.error);
    }
    return result.data.workflows;
  }

  /// Create (omit `id`) or update (pass `id`) a workflow. The host
  /// proxies to the authenticated backend, which re-validates the
  /// document; the canvas should validate locally first with
  /// `parseWorkflowDocument` / `assessWorkflowSupport`.
  async save(input: {
    id?: string;
    name: string;
    document: Record<string, unknown>;
    enabled?: boolean;
    source?: WorkflowSource;
    installId?: string | null;
  }): Promise<WorkflowRecord> {
    const raw = await this._call('workflow.save', {
      id: input.id,
      name: input.name,
      document: input.document,
      enabled: input.enabled,
      source: input.source,
      install_id: input.installId,
    });
    _throwIfError(raw, 'workflow.save');
    const result = WorkflowRecordSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidResponseError('workflow.save payload did not match schema', result.error);
    }
    return result.data;
  }

  /// Arm / disarm a workflow without re-sending its document.
  async setEnabled(id: string, enabled: boolean): Promise<WorkflowRecord> {
    const raw = await this._call('workflow.setEnabled', { id, enabled });
    _throwIfError(raw, 'workflow.setEnabled');
    const result = WorkflowRecordSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidResponseError(
        'workflow.setEnabled payload did not match schema',
        result.error,
      );
    }
    return result.data;
  }

  /// Delete a workflow.
  async remove(id: string): Promise<void> {
    const raw = await this._call('workflow.delete', { id });
    _throwIfError(raw, 'workflow.delete');
  }

  private async _call(handler: string, payload: unknown): Promise<unknown> {
    const api = _hostApi(this.bridge);
    try {
      return await api.callHandler(handler, payload);
    } catch (cause) {
      throw new BridgeTransportError(`${handler} bridge call failed`, cause);
    }
  }
}

/// The host write handlers return `{error: ...}` on a backend failure
/// (auth, validation, cap, disabled). Surface it as a transport error
/// so callers don't mistake an error envelope for a record.
function _throwIfError(raw: unknown, op: string): void {
  if (raw && typeof raw === 'object' && 'error' in raw) {
    throw new BridgeTransportError(`${op}: ${String((raw as { error: unknown }).error)}`, raw);
  }
}

/// Resolve the host's `callHandler` channel — mirrors `car.ts`'s
/// `_hostApi`: a test stub exposes `callHandler` directly; the
/// production `HostBridge` exposes it via a private `api`.
function _hostApi(bridge: Bridge): WorkflowBridgeApi {
  const direct = bridge as Partial<WorkflowBridgeApi> & { callHandler?: unknown };
  if (typeof direct.callHandler === 'function') {
    return direct as WorkflowBridgeApi;
  }
  const internal = bridge as unknown as { api?: { callHandler?: unknown } };
  if (internal.api && typeof internal.api.callHandler === 'function') {
    return internal.api as WorkflowBridgeApi;
  }
  throw new BridgeTransportError(
    'bridge does not expose a callHandler — cannot reach workflow.* handlers',
    bridge,
  );
}
