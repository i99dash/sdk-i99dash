/// Mini-app-facing controller for the host's `pkg` family.
///
/// Three operations:
///
///   * `list` / `foreground` / `usage` — read-only.
///   * `launch` / `move` on `ivi` or `passenger` displays. The IVI
///     uses `Context.startActivity`; for the passenger display the
///     host falls back to `am start --display N` over loopback ADB.
///     Cluster displays are NOT covered — the standard `launch` op
///     rejects them with `error: 'role:requires_cluster_op'`.
///   * `launchCluster` / `moveCluster` on `cluster` displays
///     (driver-instrument virtual surfaces).
///
/// Typical usage — quick launcher (IVI + passenger):
///
///     const apps = await client.pkg.list();
///     for (const app of apps) {
///       const card = make(app);
///       card.onclick = () => client.pkg.launch(app.packageName);
///     }
///
/// Cluster launcher — opens on the driver display. The displayId
/// MUST come from a `display.list()` entry with `role === 'cluster'`;
/// the standard `launch` would reject it. Requires
/// `pkg.launch.cluster` in the manifest:
///
///     const cluster = (await client.display.list())
///       .find(d => d.role === 'cluster');
///     if (cluster) {
///       await client.pkg.launchCluster('com.byd.maps', {
///         displayId: cluster.id,
///       });
///     }

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
  /** Role hint for trims where the requested role isn't an
   *  addressable Android `Display`. Today the only case is
   *  `'passenger'` on Di5.0 trims (Leopard 5 / Leopard 5 Ultra),
   *  where the passenger panel is reachable only via DiShare's
   *  mirror chain — `display.list()` returns no entry to feed
   *  into `displayId`, so the SDK passes the hint and the host's
   *  `pkg.launch.dishare` cap kicks in.
   *
   *  Pass alongside (or instead of) `displayId`; when both are
   *  set the role hint takes precedence on Di5.0 trims and is
   *  ignored elsewhere. Most call sites set this only after
   *  `display.list().vehicle.capabilities.includes('pkg.launch.dishare')`
   *  AND there's no passenger Display in the list — see the
   *  [multi-display guide](https://i99dash.app/docs/guides/multi-display#l5-di5-0-passenger-via-dishare)
   *  for the full pattern. */
  targetRole?: 'passenger';
}

export interface LaunchResult {
  ok: boolean;
  /** Which path the host took:
   *
   *    * `intent-launch` — `Context.startActivity` (default display).
   *    * `am-start` — `am start --display N` (non-default display).
   *    * `dishare-cast` — DiShare mirror chain commit (L5 / L5U
   *      passenger panel via the `targetRole: 'passenger'` hint).
   *    * `dishare-denied` — DiShare path attempted but the service
   *      bind / register / arm step failed. `error` carries a
   *      typed reason (`bind_failed`, `register_failed`, etc.).
   *    * `denied` — package not launchable, or the host doesn't
   *      have permission for the requested display. */
  path: 'intent-launch' | 'am-start' | 'dishare-cast' | 'dishare-denied' | 'denied';
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
        ...(opts.targetRole !== undefined ? { targetRole: opts.targetRole } : {}),
      },
      invokeOpts,
    );
  }

  /**
   * Move a running package's task to another display. Use this for
   * "I set up the route on the IVI, now move the running app to the
   * passenger display" workflows where {@link launch} would
   * otherwise be foiled by the package's own router activity
   * auto-redirecting to the home display (Waze, certain BYD apps).
   *
   * Only `ivi` / `passenger` displays are accepted — cluster moves
   * use {@link moveCluster}. Returns `{ok: false, path: 'denied',
   * error: 'package not running'}` if the package isn't currently
   * running. The host uses `am stack move-task` over loopback ADB,
   * the same path the surface family uses for cluster surfaces.
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

  /**
   * Cluster-targeted launch. Same shape as {@link launch} but the
   * host enforces that the displayId resolves to a `cluster` role
   * (driver-instrument virtual display).
   *
   * Returns `{ok: false, path: 'denied', error: 'role:expected_cluster_got_<role>'}`
   * if the displayId belongs to ivi / passenger / unknown. The
   * caller should pick its target from `display.list()` filtered to
   * `role === 'cluster'`.
   */
  async launchCluster(
    packageName: string,
    opts: { displayId: number },
    invokeOpts: InvokeFamilyOptions = {},
  ): Promise<LaunchResult> {
    return this.invoke<LaunchResult>(
      'launch_cluster',
      { packageName, displayId: opts.displayId },
      invokeOpts,
    );
  }

  /**
   * Cluster-targeted move. Same role contract as
   * {@link launchCluster}; same `pkg.launch.cluster` permission.
   */
  async moveCluster(
    packageName: string,
    opts: { displayId: number },
    invokeOpts: InvokeFamilyOptions = {},
  ): Promise<LaunchResult> {
    return this.invoke<LaunchResult>(
      'move_cluster',
      { packageName, displayId: opts.displayId },
      invokeOpts,
    );
  }

  /**
   * `am force-stop {packageName}`. Symmetric inverse of
   * {@link launch} / {@link launchCluster}: tear down a package the
   * mini-app previously started so the original surface owner
   * (e.g. XDJA's projection on the cluster) can reclaim the slot.
   *
   * Permission: `pkg.launch` (the same scope you needed to start
   * the app in the first place — no separate `pkg.stop` scope).
   */
  async stop(packageName: string, invokeOpts: InvokeFamilyOptions = {}): Promise<LaunchResult> {
    return this.invoke<LaunchResult>('stop', { packageName }, invokeOpts);
  }
}
