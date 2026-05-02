/// AdminClient singleton. Same shape as ``lib/sdk.ts`` — memoize
/// once per session, return null on SSR / no-host so callers can
/// render a "not inside a privileged host" fallback rather than
/// throwing.
///
/// In production the host injects the template catalog on
/// ``window.__i99dashAdminCatalog``. In dev the bridge shim does
/// the same — see ``sdk.config.json`` for the dev-server boot.

import { AdminClient, NotInsideHostError, snapshotFromList, type CommandTemplate } from 'i99dash';

import { getClient } from './sdk';

let cached: AdminClient | undefined;

declare global {
  interface Window {
    __i99dashAdminCatalog?: CommandTemplate[];
  }
}

/// Catalog used when the host hasn't injected one (dev fallback).
/// Mirrors the seed templates shipped in Phases 7-8 so tier-2 ops
/// resolve cleanly in the local mock environment.
const DEV_CATALOG: CommandTemplate[] = [
  {
    id: 'pm.list_packages',
    permissionId: 'cmdExec.read',
    tier: 1,
    requiresStepUp: false,
    category: 'package_manager',
    paramSchema: {},
  },
  {
    id: 'pm.disable_user',
    permissionId: 'cmdExec.control',
    tier: 2,
    requiresStepUp: false,
    category: 'package_manager',
    paramSchema: {
      user: { type: 'enum', values: [0, 999] },
      package: { type: 'enum', values: ['*'] },
    },
  },
  {
    id: 'pm.enable_user',
    permissionId: 'cmdExec.control',
    tier: 2,
    requiresStepUp: false,
    category: 'package_manager',
    paramSchema: {
      user: { type: 'enum', values: [0, 999] },
      package: { type: 'enum', values: ['*'] },
    },
  },
  {
    id: 'sys.reboot',
    permissionId: 'cmdExec.control',
    tier: 2,
    requiresStepUp: true,
    category: 'system',
    paramSchema: {},
  },
  {
    id: 'diag.tail_logs',
    permissionId: 'cmdExec.read',
    tier: 1,
    requiresStepUp: false,
    category: 'diagnostics',
    paramSchema: { lines: { type: 'int', min: 1, max: 1000, default: 100 } },
  },
  {
    id: 'diag.mqtt_status',
    permissionId: 'cmdExec.read',
    tier: 1,
    requiresStepUp: false,
    category: 'diagnostics',
    paramSchema: {},
  },
  {
    id: 'diag.restart_mqtt',
    permissionId: 'cmdExec.control',
    tier: 2,
    requiresStepUp: false,
    category: 'diagnostics',
    paramSchema: {},
  },
  {
    id: 'diag.clear_cache',
    permissionId: 'cmdExec.control',
    tier: 2,
    requiresStepUp: false,
    category: 'diagnostics',
    paramSchema: {},
  },
  {
    id: 'fs.ls',
    permissionId: 'cmdExec.read',
    tier: 1,
    requiresStepUp: false,
    category: 'filesystem',
    paramSchema: {
      path: {
        type: 'enum',
        values: ['/sdcard/Download', '/data/local/tmp', '/storage/emulated/0'],
      },
    },
  },
];

export function getAdmin(): AdminClient | null {
  if (cached) return cached;

  // Need the regular client first to read the runtime context.
  // If we can't get a host bridge, this whole privileged surface
  // is unavailable — render the fallback.
  const sdk = getClient();
  if (!sdk) return null;

  // We don't await getContext here; admin requires it at call time
  // not at construction. The simpler shape: pull the synchronous
  // catalog snapshot from window if present, fall back to the dev
  // catalog defined above. The user's appId/vin are filled in by
  // the AdminClient.fromWindow() consumer below.
  const catalogList =
    (typeof window !== 'undefined' && window.__i99dashAdminCatalog) || DEV_CATALOG;

  try {
    cached = AdminClient.fromWindow({
      // The context fields are placeholders for the synchronous
      // construction. The host actually carries the authoritative
      // (user_id, vin, cert_hash) tuple in its session-cap row;
      // these client-side values exist for client-side affordances
      // (UI rendering, type narrowing).
      context: {
        appId: 'adb-helper',
        vin: 'pending',
      },
      catalog: snapshotFromList(catalogList),
    });
    return cached;
  } catch (err) {
    if (err instanceof NotInsideHostError) return null;
    throw err;
  }
}
