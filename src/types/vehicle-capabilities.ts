import { z } from 'zod';

/// Vehicle / hardware capabilities the host advertises and mini-apps
/// declare as required. Distinct from `permissions` (family bridge
/// gating) and `requiredPermissions` (developer-grant scoping):
///
///   * `permissions`           — does the *host* implement this family?
///   * `requiredPermissions`   — is the *publisher* allowed to ship it?
///   * `requiredCapabilities`  — does the *physical car* support it?
///
/// The catalog merge filters apps whose required capabilities aren't a
/// subset of the active vehicle's capabilities, dimming (not hiding)
/// them with a `caps_missing` reason — see `feedback_perms_hide_not_disable`
/// for why dim-with-reason wins over silent omission.
///
/// **Bit positions are frozen — never reorder.** New capabilities append
/// to the end; removed capabilities leave a tombstone with a `null`
/// entry so the bitmask layout stays stable across SDK + host + backend.
/// Bitmask fits in a 32-bit signed int up to 31 entries; the host wires
/// it as a Long (64-bit) to give us headroom past 32.
///
/// Mirrored verbatim in:
///   * `car-i99dash/lib/core/car/vehicle_capability.dart` (Dart)
///   * `car-i99dash/android/app/.../car/VehicleCapability.kt` (host)
///   * `backend-i99dash/app/domain/vehicle_capabilities/constants.py`
///
/// A CI drift check (`scripts/check-capability-drift.mjs`) fails the PR
/// when these copies diverge — same pattern as `category-slugs.json`.
export const VEHICLE_CAPABILITIES = [
  // 0–4: read surfaces — every car has these unless the OS layer is
  //      degraded (dev runner, web preview).
  'display.read',
  'pkg.read',
  // 5–9: launch surfaces — what `pkg.launch({role})` can actually
  //      reach on this trim. `cluster.icons` covers L5's "MCU mux only"
  //      reality (no pixel control, but icon-state toggles work).
  'pkg.launch.ivi',
  'pkg.launch.passenger',
  'pkg.launch.cluster.pixel',
  'pkg.launch.cluster.icons',
  'pkg.launch.dishare',
  // 7–9: surface render targets — independent of launch because a
  //      mini-app can render its own WebView surface without touching
  //      pkg.* (the dash-wallpaper case).
  'surface.write.ivi',
  'surface.write.passenger',
  'surface.write.cluster',
  // 10–11: gesture / cursor synthesis — privileged because they touch
  //        the a11y bridge.
  'cursor.write',
  'gesture.dispatch',
  // 12–15: car control — read vs set are separate so a "fan-speed
  //        gauge" mini-app can declare `ac.get` without scaring the
  //        catalog filter into asking for write perms.
  'ac.get',
  'ac.set',
  'door.set',
  'window.set',
] as const;

export type VehicleCapability = (typeof VEHICLE_CAPABILITIES)[number];

/// Reverse map (capability → bit index). `Object.fromEntries` keeps
/// the table single-sourced — consumers that need a specific bit
/// (rare; most use `bitsFromCapabilities`) read it from this map.
export const CAPABILITY_BITS: Readonly<Record<VehicleCapability, number>> = Object.freeze(
  Object.fromEntries(VEHICLE_CAPABILITIES.map((cap, i) => [cap, i])) as Record<
    VehicleCapability,
    number
  >,
);

/// Pack a capability list into a single integer bitmask. Order in the
/// input doesn't matter — the result is a deterministic OR of bits.
/// Unknown capability strings (defensive: should be caught by Zod
/// upstream) are silently skipped rather than throwing, so a JSON
/// from a newer SDK doesn't crash an older host's parser.
export function bitsFromCapabilities(caps: readonly string[]): number {
  let bits = 0;
  for (const cap of caps) {
    const bit = (CAPABILITY_BITS as Record<string, number | undefined>)[cap];
    if (bit !== undefined) bits |= 1 << bit;
  }
  return bits;
}

/// Inverse — turn a bitmask back into the canonical capability list.
/// Stable order (matches `VEHICLE_CAPABILITIES`).
export function capabilitiesFromBits(bits: number): VehicleCapability[] {
  const out: VehicleCapability[] = [];
  for (let i = 0; i < VEHICLE_CAPABILITIES.length; i++) {
    if ((bits & (1 << i)) !== 0) out.push(VEHICLE_CAPABILITIES[i]!);
  }
  return out;
}

/// Capability subset check — `app.required ⊆ vehicle.has`. One bitmask
/// AND, O(1) regardless of how many capabilities are in play. The
/// catalog filter uses this on every app per render — keep it
/// branchless.
export function hasAllCapabilities(vehicleBits: number, requiredBits: number): boolean {
  return (vehicleBits & requiredBits) === requiredBits;
}

const VehicleCapabilityEnum = z.enum(
  VEHICLE_CAPABILITIES as unknown as [VehicleCapability, ...VehicleCapability[]],
);

/// DiLink generation. Mirror of `app/domain/vehicle_capabilities/
/// constants.py` DILINK_FAMILIES and `android/.../car/CarIdentity.kt`
/// `resolveDilinkFamily`. The ``unknown`` slot is the catch-all for
/// non-BYD ROMs and dev runners; the Tier-5 unknown ProfileKey uses it.
export const DILINK_FAMILIES = ['di5.0', 'di5.1', 'unknown'] as const;
export type DilinkFamily = (typeof DILINK_FAMILIES)[number];

/// Hardware sub-trims within a `variantId`. Splits "L5" into
/// Flagship / Navigator / Ultra; collapses single-trim variants
/// (L8, L7, HAN L) to ``base``. Mirror of the Python + Kotlin lists.
///
/// **Append-only.** New trims add at the end; renames require a
/// coordinated SDK + host + backend bump because every persisted
/// ProfileKey carries this string.
export const SUB_TRIMS = [
  // L5 family (Di5.0).
  'flagship',
  'navigator',
  'ultra',
  'lidar',
  // Single-trim fallback for variants with no real sub-trim split.
  'base',
] as const;
export type SubTrim = (typeof SUB_TRIMS)[number];

/// The four-tuple identity that uniquely keys a vehicle's capability
/// row across the fleet. Sent as ``profileKey`` on every
/// `/api/v1/vehicle-capabilities` and `/api/v1/car-feedback/correction`
/// call.
///
/// Empty-string slots are valid wire values and represent **fallback
/// aggregate** rows the backend walks server-side:
///   * ``fingerprint == ""`` → sub-trim aggregate
///   * ``subTrim == ""``     → trim aggregate
///   * ``variantId == ""``   → DiLink-generation default
///
/// Hosts always send the precise four-tuple they ran on; the backend
/// fans the probe into all four rows in one transaction so a
/// fresh fingerprint inherits the union of every past probe.
export const ProfileKeySchema = z
  .object({
    dilinkFamily: z.enum(DILINK_FAMILIES),
    variantId: z.string().max(64).default(''),
    /// Hardware sub-trim wire string. Validated against [SUB_TRIMS]
    /// or the empty string (trim-level aggregate slot). Closed enum
    /// keeps typos from entering the persistent table.
    subTrim: z
      .string()
      .max(32)
      .refine(
        (v) => v === '' || (SUB_TRIMS as readonly string[]).includes(v),
        (v) => ({ message: `unknown subTrim ${v!}` }),
      )
      .default(''),
    /// `ro.build.fingerprint` exactly as Android reports it. Opaque
    /// to the SDK; the backend uses it as the most-precise cache
    /// key. Empty when reading an aggregate slot.
    fingerprint: z.string().max(256).default(''),
  })
  .strict();

export type ProfileKey = z.infer<typeof ProfileKeySchema>;

/// Backend response for `GET /api/v1/vehicle-capabilities` — the
/// merged capability snapshot for a [ProfileKey], with the resolution
/// tier the backend served from.
///
/// `isFallback` + `fallbackReason` tell the client which tier of the
/// 4-tier server-side fallback chain produced the row, so the UI can
/// render a "best-effort on this car" hint when isFallback is true:
///
///   * ``"unknown_fingerprint"`` — sub-trim aggregate served (precise
///     row not yet probed for this ROM).
///   * ``"unknown_sub_trim"``    — trim aggregate served.
///   * ``"unknown_variant"``     — DiLink-generation default served.
///
/// `capabilities` and `capabilityBits` carry the same data — the
/// readable list for logs / UI, the bitmask for the hot-path subset
/// check (one AND).
export const VehicleCapabilitiesSnapshotSchema = z
  .object({
    dilinkFamily: z.enum(DILINK_FAMILIES),
    variantId: z.string().max(64),
    subTrim: z.string().max(32),
    fingerprint: z.string().max(256),
    capabilities: z.array(VehicleCapabilityEnum),
    capabilityBits: z.number().int().nonnegative(),
    /// ISO-8601 timestamp the backend last updated this row.
    updatedAt: z.string().datetime(),
    /// Probe count this row aggregates. Higher = more confident.
    /// Hosts use this only for telemetry; the union semantic is
    /// independent of count.
    probeCount: z.number().int().nonnegative(),
    /// True when the resolver couldn't find a precise (fingerprint-
    /// level) match. The catalog UI can render a soft "best-effort"
    /// hint without changing functional behaviour.
    isFallback: z.boolean().default(false),
    /// Why the resolver fell back, or null on a precise hit. See the
    /// schema docstring for the closed reason set.
    fallbackReason: z
      .enum(['unknown_fingerprint', 'unknown_sub_trim', 'unknown_variant', 'unknown_dilink'])
      .nullable()
      .default(null),
  })
  .strict();

export type VehicleCapabilitiesSnapshot = z.infer<typeof VehicleCapabilitiesSnapshotSchema>;

/// Probe result a host POSTs back to the backend after running its
/// first-boot probe set. The backend folds this into all four
/// ProfileKey rows in one transaction — strictly additive, never
/// decrementing, so a flaky probe on one car can never strip a
/// capability another car proved.
///
/// Hosts MUST send the precise [ProfileKey] they ran on (every slot
/// populated). The backend writes the precise row AND the three
/// aggregate slots so cars on fresh fingerprints / unknown sub-trims
/// still inherit useful caps without waiting for their own probe.
export const VehicleCapabilityProbeReportSchema = z
  .object({
    profileKey: ProfileKeySchema,
    confirmed: z.array(VehicleCapabilityEnum),
    /// Anonymised probe-version string so the backend can ignore
    /// reports from probe versions known to false-negative.
    probeVersion: z.string().min(1).max(32),
  })
  .strict();

export type VehicleCapabilityProbeReport = z.infer<typeof VehicleCapabilityProbeReportSchema>;
