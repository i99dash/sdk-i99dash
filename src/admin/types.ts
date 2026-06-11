/// Shared types for the admin SDK.
///
/// Phase-7 refactor: the old hardcoded ``CmdExecOp`` union is gone.
/// The SDK is now generic — every privileged op flows through
/// ``AdminClient.invoke(templateId, params)``. Tier classification
/// comes from the catalog the server publishes; this file holds
/// only the wire-shape types that don't depend on which templates
/// happen to be live.

/// Server response envelope from ``/runtime/cap``.
export interface CapabilityResponse {
  capability: string;
  expiresAt: string; // ISO-8601 UTC, ``Z`` suffix
}

/// Generic op-result envelope returned by the ``_admin.exec`` host
/// handler — the standard `{success, data | error}` shape the host's
/// family executor returns, so consumers have one mental model.
export type AdminOpResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

/// One row of the server's command-template catalog. The SDK fetches
/// the catalog once at boot, caches it in memory, and uses it to
/// pick the right tier (read-only vs. server-gated) per invoke.
///
/// Mirrors the backend ``command_templates`` row schema 1:1 — see
/// ``backend-i99dash/app/domain/admin_perms/templates.py``. Keep
/// these in lockstep; the server is the source of truth.
export interface CommandTemplate {
  id: string;
  permissionId: string;
  tier: 1 | 2;
  requiresStepUp: boolean;
  category: string;
  description?: string;
  // The SDK does NOT receive `shell_template` — that lives only on
  // the server + device. Clients shouldn't know the rendered shell
  // exists; they invoke by id and read the result envelope.
  paramSchema: Record<string, ParamRule>;
}

/// Per-slot rule from the template's ``param_schema``. Three kinds —
/// matches the backend's validator types.
export type ParamRule =
  | { type: 'int'; min?: number; max?: number; default?: number }
  | { type: 'enum'; values: ReadonlyArray<string | number> }
  | { type: 'regex'; pattern: string };

/// Catalog snapshot the SDK consumes. Indexed by template id for
/// O(1) lookup at invoke time.
export interface CatalogSnapshot {
  templates: ReadonlyMap<string, CommandTemplate>;
  fetchedAt: number; // unix-millis
}

/// Convenience: builder for a snapshot from the wire shape (the
/// backend serves a flat list).
export function snapshotFromList(list: CommandTemplate[]): CatalogSnapshot {
  const m = new Map<string, CommandTemplate>();
  for (const t of list) m.set(t.id, t);
  return { templates: m, fetchedAt: Date.now() };
}
