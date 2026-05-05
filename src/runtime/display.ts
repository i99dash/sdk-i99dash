/// Mini-app-facing controller for the host's `display` family.
///
/// Read-only; no consent prompt.
///
///     const r = await client.display.list();
///     // Pick by role rather than the legacy isCluster flag — role
///     // is the one the host gates pkg.launch / pkg.launch_cluster
///     // against, so what you see here is what the launch path
///     // accepts.
///     const ivi       = r.displays.find(d => d.role === 'ivi');
///     const passenger = r.displays.find(d => d.role === 'passenger');
///     const cluster   = r.displays.find(d => d.role === 'cluster');
///
///     // The same call carries the active vehicle context — single
///     // round-trip, no separate query for capability bits.
///     if (r.vehicle?.capabilities?.includes('pkg.launch.cluster.pixel')) {
///       // safe to render cluster UI
///     }

import type { Bridge } from './bridge.js';
import type { VehicleCapability } from '../types/vehicle-capabilities.js';
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
  /// Active VehicleProfile flags this as a duplicate / shadow of
  /// another display (e.g. id 3 is a mirror of id 5 on Leopard 8 /
  /// Leopard 5 Lidar). Pickers should hide these by default;
  /// addressing them by id still works for advanced use. Absent on
  /// hosts that don't ship the profile system.
  hidden?: boolean;
  /// Friendlier label from the active VehicleProfile. The reserved
  /// value `'Driver'` (see [`RESERVED_OVERRIDE_LABELS`]) means *the
  /// driver-eyeline display on this trim, regardless of role* — the
  /// instrument cluster on L8 / L5L, a labeled passenger panel on
  /// trims like Song Plus / L7 / HAN L. Resolution priority for
  /// "open on the screen the driver looks at" is documented in the
  /// [multi-display guide](https://i99dash.app/docs/guides/multi-display).
  /// Absent on hosts that don't ship the profile system, or trims
  /// without a matching profile entry.
  overrideLabel?: string;
  /// Active VehicleProfile's `showCluster` flag. `false` on trims
  /// where the cluster is not addressable from app uid (L5 / L5U /
  /// L7 / HAN L). Mini-apps read this to pre-empt cluster UI rather
  /// than waiting for a launch to fail.
  clusterAvailable?: boolean;
  /// Where the cursor renders for `cursor.attach` targeting this
  /// display, per VehicleProfile remap. Defaults to `id` when no
  /// remap is in effect.
  cursorDisplayId?: number;
  /// Where input dispatched against this display actually lands,
  /// per VehicleProfile remap. Needed because XDJA's launch-vs-input
  /// asymmetry on Leopard 8 means a tap on display 5 must dispatch
  /// to display 3. Defaults to `id` when no remap is in effect.
  inputSourceDisplayId?: number;
  /// Where `wm density` commands land for zoom requests on this
  /// display, per VehicleProfile remap. Defaults to `id`.
  zoomDisplayId?: number;
}

/// Reserved values for [`DisplaySnapshot.overrideLabel`].
///
/// Adding a new value here requires a coordinated host PR (the
/// label has to be set by some `VehicleProfile.overrideLabels`
/// entry) plus a docs update. The drift script
/// `scripts/check-driver-label-contract.mjs` parses the host's
/// `VehicleProfile.kt` and fails CI when host emits a label not
/// listed here.
///
/// Semantics:
///   * `'Driver'` — the display in the driver's eyeline on this
///                  trim. May be the instrument cluster (L8 / L5L
///                  XDJA `_1` overlay) or a labeled passenger
///                  panel (Song Plus / L7 / HAN L). Mini-apps that
///                  want to render "for the driver" target this
///                  label and let the launch op (`pkg.launch` for
///                  passenger-role, `pkg.launchCluster` for
///                  cluster-role) follow from `role`.
export const RESERVED_OVERRIDE_LABELS = ['Driver'] as const;
export type ReservedOverrideLabel = (typeof RESERVED_OVERRIDE_LABELS)[number];

/// Resolved vehicle context the host emits alongside `display.list`'s
/// display array. Lets a mini-app gate UI on the active car's
/// capability bits in a single round-trip — no separate
/// `vehicle-capabilities` lookup.
///
/// Fields land in the wire incrementally; older hosts emit only a
/// subset. The `dilinkFamily` field is the one stable signal across
/// every host that ships a vehicle block at all — everything else is
/// best-treated as `?:`.
///
///   * `dilinkFamily` / `variantId` / `subTrim` — the
///     [ProfileKey](../types/vehicle-capabilities.ts) identity slots.
///     Empty strings are valid wire values for the aggregate slots
///     (sub-trim aggregate, trim aggregate, DiLink default).
///   * `friendlyName` — local label the host computes (e.g.
///     `'Leopard 5 Flagship'`), suitable for displaying directly.
///   * `capabilities` / `capabilityBits` — same data, two
///     representations. Use `capabilities.includes(...)` for
///     readability or `bitsFromCapabilities` / `hasAllCapabilities`
///     from `vehicle-capabilities.ts` for hot-path subset checks.
///   * `isFallback` / `fallbackReason` — true when the resolver
///     served an aggregate row (precise fingerprint not yet probed).
///     Render a soft "best-effort on this car" hint when true; don't
///     change functional behaviour. See the
///     [vehicle-profile concepts page](https://i99dash.app/docs/concepts/vehicle-profile)
///     for the 5-tier fallback chain.
export interface VehicleContext {
  dilinkFamily: 'di5.0' | 'di5.1' | 'unknown';
  variantId?: string;
  subTrim?: string;
  friendlyName?: string;
  capabilities?: VehicleCapability[];
  capabilityBits?: number;
  isFallback?: boolean;
  fallbackReason?: string | null;
}

/// Return shape of [`DisplayController.list`]. Carries both the
/// display array (the host's view of every addressable surface) and
/// the active [`VehicleContext`] (what trim, what capability bits)
/// in one envelope so consumers don't need a separate round-trip
/// to gate UI on the vehicle.
///
/// **2.0 breaking change:** previously this method returned
/// `Promise<DisplaySnapshot[]>` and the `vehicle` block was
/// reachable only via raw `bridge.callHandler('display.list')`.
/// Migration is one rename per call site:
///
/// ```diff
/// - const displays = await client.display.list();
/// + const { displays } = await client.display.list();
/// ```
///
/// The `vehicle` field is optional because hosts older than 1.6
/// don't emit it — code that read `displays` only continues to
/// work after the rename without any vehicle handling.
export interface DisplayListResult {
  displays: DisplaySnapshot[];
  vehicle?: VehicleContext;
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

  /// One-shot snapshot of every addressable display, plus the active
  /// [`VehicleContext`] when the host emits it (1.6+).
  ///
  /// Returns the host envelope verbatim — `vehicle` is `undefined`
  /// on older hosts that don't ship the block, never an empty
  /// object. See [`DisplayListResult`] for the migration note from
  /// the 1.x bare-array return shape.
  async list(opts: InvokeFamilyOptions = {}): Promise<DisplayListResult> {
    return this.invoke<DisplayListResult>('list', {}, opts);
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
