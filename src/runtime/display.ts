/// Mini-app-facing controller for the host's `display` family.
///
/// Tier-1 (read-only); no consent prompt, no cap. Permission
/// declared in `manifest.permissions[]` as `display.read`.
///
///     const displays = await client.display.list();
///     // Pick by role rather than the legacy isCluster flag — role
///     // is the one the host gates pkg.launch / pkg.launch_cluster
///     // against, so what you see here is what the launch path
///     // accepts.
///     const ivi       = displays.find(d => d.role === 'ivi');
///     const passenger = displays.find(d => d.role === 'passenger');
///     const cluster   = displays.find(d => d.role === 'cluster');

import type { Bridge } from './bridge.js';
import {
  BaseFamilyController,
  type InvokeFamilyOptions,
  type UnsubscribeFn,
} from './family-controller.js';

export interface DisplaySnapshot {
  /// Stable display id used by `client.surface.create({displayId})`.
  id: number;
  name: string;
  width: number;
  height: number;
  densityDpi: number;
  isDefault: boolean;
  /// True when the display advertises `FLAG_PRESENTATION` —
  /// usually a virtual display (passenger, cluster, HUD).
  isPresentation: boolean;
  /// Legacy: equivalent to `role === 'cluster'`. Kept for the
  /// initial Phase-A SDK clients; new code should read `role`
  /// directly so passenger / unknown surfaces are distinguishable
  /// from each other.
  isCluster: boolean;
  /// Mini-app-facing role classification, set by the host:
  ///
  ///   * `'ivi'`       — head-unit display (id 0). pkg.launch +
  ///                     surface.create accept this.
  ///   * `'passenger'` — non-default external touchscreen (the
  ///                     Leopard 8 "fse" panel). pkg.launch
  ///                     accepts this.
  ///   * `'cluster'`   — driver-instrument virtual display. ONLY
  ///                     `pkg.launchCluster` / `pkg.moveCluster`
  ///                     accept this — the standard launch op
  ///                     returns `error: 'role:requires_cluster_op'`.
  ///                     Requires the Tier-3 `pkg.launch.cluster`
  ///                     permission in manifest.
  ///   * `'unknown'`   — anything the host can't classify; never
  ///                     accepted as a launch / move target
  ///                     regardless of permission.
  role: 'ivi' | 'passenger' | 'cluster' | 'unknown';
}

/// Hot-plug event the host pushes when displays are added, removed,
/// or modified. `kind: 'snapshot'` is the seed event the host fires
/// once on first subscribe with the full current list.
export type DisplayEvent =
  | { type: 'snapshot'; displays: DisplaySnapshot[] }
  | { type: 'added'; displayId: number; display?: DisplaySnapshot }
  | { type: 'removed'; displayId: number }
  | { type: 'changed'; displayId: number; display?: DisplaySnapshot };

export type DisplayEventListener = (evt: DisplayEvent) => void;

export class DisplayController extends BaseFamilyController {
  constructor(bridge: Bridge) {
    super(bridge, 'display');
  }

  /// One-shot snapshot of every addressable display.
  async list(opts: InvokeFamilyOptions = {}): Promise<DisplaySnapshot[]> {
    const data = await this.invoke<{ displays: DisplaySnapshot[] }>('list', {}, opts);
    return data.displays;
  }

  /// Subscribe to display add/remove/changed events. The first
  /// emit is a `'snapshot'` carrying the full current list — same
  /// shape as `list()` returned, just delivered through the same
  /// event channel so consumers don't need a separate one-shot read
  /// to seed their UI.
  ///
  /// Returns a cleanup closure. Call it once when you're done — the
  /// SDK runs the host's `display.unsubscribe` for you. Calling it
  /// twice is a no-op.
  ///
  /// Throws `FamilyOpError` if the initial subscribe is rejected
  /// (e.g. `permission_denied`); after that, transient native
  /// errors are silently swallowed so a single hiccup doesn't kill
  /// the listener.
  async onChange(listener: DisplayEventListener): Promise<UnsubscribeFn> {
    return this.subscribe((raw) => listener(raw as DisplayEvent));
  }
}
