/// Mini-app-facing controller for the host's `pkg` family.
///
/// Two permissions in one family:
///
///   * `pkg.read` (tier-1) — `list`, `foreground`, `usage`. Cheap,
///     read-only. Available on a secondary surface so a cluster
///     widget can render "now playing on IVI" pills without needing
///     a privileged grant.
///   * `pkg.launch` (tier-2) — `launch`. Starts an installed app on
///     a chosen display. The IVI uses `Context.startActivity`; for
///     non-default displays the host falls back to `am start
///     --display N` over loopback ADB.
///
/// Declare the permissions you need in `manifest.permissions[]`. A
/// launcher mini-app declares both; a "now playing" widget declares
/// only `pkg.read`.
///
/// Typical usage — quick launcher:
///
///     const apps = await client.pkg.list();
///     for (const app of apps) {
///       const card = make(app);
///       card.onclick = () => client.pkg.launch(app.packageName);
///     }
///
/// Cluster launcher (open on the cluster slot):
///
///     await client.pkg.launch('com.byd.maps', { displayId: 4 });

import type { Bridge } from './bridge.js';
import { BaseFamilyController, type InvokeFamilyOptions } from './family-controller.js';

export interface PackageInfo {
  packageName: string;
  /** Localised display name (`PackageManager.getApplicationLabel`). */
  label: string;
  versionName: string;
  versionCode: number;
  isSystem: boolean;
  /** SHA-256 of the launcher icon's PNG bytes. Reserved for the
   *  Phase-D `pkg.icon` content-addressed lookup; currently always
   *  null. */
  iconHash?: string | null;
}

export interface ForegroundInfo {
  /** Null when the host can't determine the foreground app
   *  (UsageStatsManager not granted, locked screen, etc.). */
  packageName: string | null;
  /** `ComponentName.flattenToShortString()` — empty when the host
   *  resolved via `UsageStatsManager` (no activity-class info there). */
  activityClass: string;
  atMillis: number;
}

export interface UsageRow {
  packageName: string;
  totalTimeInForegroundMs: number;
  lastTimeUsedMs: number;
}

export interface UsageResult {
  rows: UsageRow[];
  windowMs: number;
}

export interface ListOptions {
  /** Include OEM stubs / system apps. Defaults to `false` (the
   *  user-launchable subset most launchers want). */
  includeSystem?: boolean;
}

export interface LaunchOptions {
  /** Target display id from `client.display.list()`. Omit (or pass
   *  `0`) for the IVI. The host uses `am start --display N` over
   *  loopback ADB for non-default displays — same path the surface
   *  family uses for cluster slots. */
  displayId?: number;
}

export interface LaunchResult {
  ok: boolean;
  /** Which path the host took:
   *
   *    * `intent-launch` — `Context.startActivity` (default display).
   *    * `am-start` — `am start --display N` (non-default display).
   *    * `denied` — package not launchable, or the host doesn't
   *      have permission for the requested display. */
  path: 'intent-launch' | 'am-start' | 'denied';
  error?: string | null;
}

export class PkgController extends BaseFamilyController {
  constructor(bridge: Bridge) {
    super(bridge, 'pkg');
  }

  /**
   * Enumerate installed packages (the launchable subset by default).
   * Uses the host's `PackageManager.queryIntentActivities` for
   * `ACTION_MAIN/CATEGORY_LAUNCHER` — every entry has at least one
   * launcher activity.
   */
  async list(opts: ListOptions = {}, invokeOpts: InvokeFamilyOptions = {}): Promise<PackageInfo[]> {
    const r = await this.invoke<{ packages: PackageInfo[] }>(
      'list',
      { includeSystem: opts.includeSystem ?? false },
      invokeOpts,
    );
    return r.packages ?? [];
  }

  /**
   * Current foreground app. Returns null when the host can't
   * determine it (no UsageStatsManager grant, locked screen). The
   * mini-app should treat null as "ask again later", not as "no
   * app is running".
   */
  async foreground(invokeOpts: InvokeFamilyOptions = {}): Promise<ForegroundInfo | null> {
    const r = await this.invoke<ForegroundInfo>('foreground', {}, invokeOpts);
    if (r.packageName == null) return null;
    return r;
  }

  /**
   * Per-package usage stats over a sliding window. Backed by
   * `UsageStatsManager.queryUsageStats`; rolled up server-side to
   * one row per package. Returns an empty list when the host
   * doesn't have the GET_USAGE_STATS appop — usage stats are
   * inherently best-effort.
   *
   * Window is capped at 24 hours (anything wider is rarely useful
   * for in-car launcher logic).
   */
  async usage(windowMs: number, invokeOpts: InvokeFamilyOptions = {}): Promise<UsageResult> {
    const r = await this.invoke<UsageResult>('usage', { windowMs }, invokeOpts);
    return { rows: r.rows ?? [], windowMs: r.windowMs ?? windowMs };
  }

  /**
   * Start an installed app, optionally on a non-default display.
   * Resolves the package's main launcher intent server-side; rejects
   * with `pkg_invalid` if the package name is malformed and
   * `pkg_launch_failed` if the OS rejects the launch.
   */
  async launch(
    packageName: string,
    opts: LaunchOptions = {},
    invokeOpts: InvokeFamilyOptions = {},
  ): Promise<LaunchResult> {
    return this.invoke<LaunchResult>(
      'launch',
      {
        packageName,
        ...(opts.displayId !== undefined ? { displayId: opts.displayId } : {}),
      },
      invokeOpts,
    );
  }

  /**
   * Move a running package's task to another display. Use this for
   * "I set up the route on the IVI, now show the running app on the
   * cluster" workflows where {@link launch} would otherwise be
   * foiled by the package's own router activity auto-redirecting to
   * the home display (Waze, certain BYD apps).
   *
   * Returns `{ok: false, path: 'denied', error: 'package not
   * running'}` if the package isn't currently running. The host
   * uses `am stack move-task` over loopback ADB, the same path the
   * surface family uses for cluster surfaces.
   */
  async move(
    packageName: string,
    opts: { displayId: number },
    invokeOpts: InvokeFamilyOptions = {},
  ): Promise<LaunchResult> {
    return this.invoke<LaunchResult>(
      'move',
      { packageName, displayId: opts.displayId },
      invokeOpts,
    );
  }
}
