/// Mini-app-facing controller for the host's `boot` family.
///
/// Tier-2 (`boot.write`). Lets a mini-app declare which Android
/// packages should auto-launch on cold boot, optionally pinned to
/// a non-default display (passenger panel, instrument cluster).
/// Declarations persist in the host's admin SQLite — they survive
/// reboots, mini-app restarts, and host upgrades.
///
/// Per-mini-app isolation: `list()` only returns the rows the
/// calling mini-app set; there's no cross-mini-app peek surface.
///
/// Typical usage — pin a music app to the cluster on boot:
///
///     await client.boot.set('com.byd.music', { displayId: 5 });
///
/// Inspect what's set:
///
///     const entries = await client.boot.list();
///
/// Remove a declaration:
///
///     await client.boot.unset('com.byd.music');

import type { Bridge } from './bridge.js';
import { BaseFamilyController, type InvokeFamilyOptions } from './family-controller.js';

export interface BootEntry {
  packageName: string;
  /** `-1` means default (IVI) display. Otherwise the display id
   *  from `client.display.list()`. */
  displayId: number;
  /** Optional intent-extras route the launched package can read.
   *  No semantic meaning to the host — passed through opaquely. */
  route?: string;
  /** Epoch millis when the row was last set. */
  setAtMs: number;
}

export interface SetOptions {
  /** Display id from `client.display.list()`. Omit (or pass -1)
   *  for the IVI. */
  displayId?: number;
  route?: string;
}

export class BootController extends BaseFamilyController {
  constructor(bridge: Bridge) {
    super(bridge, 'boot');
  }

  /**
   * Declare that [packageName] should auto-launch on cold boot.
   * Idempotent on `(user, bydDeviceId, app, packageName)` — calling
   * `set` again with the same `packageName` replaces the prior row.
   */
  async set(
    packageName: string,
    opts: SetOptions = {},
    invokeOpts: InvokeFamilyOptions = {},
  ): Promise<BootEntry> {
    return this.invoke<BootEntry>(
      'set',
      {
        packageName,
        ...(opts.displayId !== undefined ? { displayId: opts.displayId } : {}),
        ...(opts.route !== undefined ? { route: opts.route } : {}),
      },
      invokeOpts,
    );
  }

  /**
   * Every boot declaration this mini-app has set under the active
   * (user, bydDeviceId). Other mini-apps' rows are not visible.
   */
  async list(invokeOpts: InvokeFamilyOptions = {}): Promise<BootEntry[]> {
    const r = await this.invoke<{ entries: BootEntry[] }>('list', {}, invokeOpts);
    return r.entries ?? [];
  }

  /**
   * Remove the declaration for [packageName]. No-op if the row
   * doesn't exist; returns the count actually removed (0 or 1).
   */
  async unset(
    packageName: string,
    invokeOpts: InvokeFamilyOptions = {},
  ): Promise<{ removed: number }> {
    return this.invoke<{ removed: number }>('unset', { packageName }, invokeOpts);
  }
}
