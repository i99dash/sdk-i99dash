import { z } from 'zod';

import {
  DILINK_FAMILIES,
  bitsFromCapabilities,
  capabilitiesFromBits,
  hasAllCapabilities,
} from './vehicle-capabilities.js';
import { REQUIRES_SCHEMA, type MiniAppManifest, type MiniAppRequires } from './manifest.js';

/// The single source of truth for "can this app run on this car?".
///
/// Every consumer evaluates the SAME function so the answer can never
/// drift between layers:
///   * backend catalog — filter the per-car app list (hide).
///   * car-i99dash host — refuse launch of an incompatible app.
///   * `i99dash` CLI — `validate` lint + dev-server simulation.
/// The catalog runs this per app per render, so the capability check
/// is a branchless bitmask AND (`hasAllCapabilities`), not a scan.
///
/// **Fail-closed by construction.** Anything the evaluator cannot
/// positively confirm — an unknown DiLink, a missing host fact, a
/// `requires.schema` newer than this build understands — resolves to
/// *incompatible*. Hiding a working app is recoverable; surfacing a
/// broken one on a moving car is not.

/// The car/host facts the gate runs against. The host builds this
/// from `CarProfile`/`CarIdentity`; the backend from the stored
/// `VehicleCapabilitiesSnapshot`; the dev-server from its fixture.
/// One shape — no per-layer reimplementation.
export const CompatTargetSchema = z
  .object({
    /// Resolved DiLink generation. `'unknown'` is a valid value and
    /// is treated as "fails any explicit dilink/cluster requirement".
    dilinkFamily: z.enum(DILINK_FAMILIES),
    /// Packed vehicle-capability bitmask (preferred — hot path). Takes
    /// precedence over `vehicleCapabilities` when both are present.
    vehicleCapabilityBits: z.number().int().nonnegative().optional(),
    /// Readable capability list. Used only when bits are absent.
    vehicleCapabilities: z.array(z.string()).optional(),
    /// Host bridge protocol version (semver-ish). Absent ⇒ a
    /// `minBridge` requirement fails closed.
    bridgeVersion: z.string().optional(),
    /// Whether the car's WebView is modern (Chrome 100+). Absent ⇒ a
    /// `modernWebview` requirement fails closed (assume old).
    modernWebview: z.boolean().optional(),
  })
  .strict();

export type CompatTarget = z.infer<typeof CompatTargetSchema>;

/// Closed reason set — stable identifiers so the host/catalog can map
/// each to a localized "why this app is hidden" string without
/// parsing free text.
export const COMPAT_REASON_CODES = [
  'unsupported_requires_schema',
  'dilink_unsupported',
  'missing_vehicle_capabilities',
  'webview_too_old',
  'bridge_too_old',
] as const;

export type CompatReasonCode = (typeof COMPAT_REASON_CODES)[number];

export interface CompatReason {
  code: CompatReasonCode;
  /// Human-readable, English, for logs + developer tooling. Not for
  /// end-user display — map `code` to a localized string for that.
  detail: string;
}

export interface CompatResult {
  /// `true` ⇒ the app may be shown/launched on this car.
  ok: boolean;
  /// Empty when `ok`. One entry per failed rule (a single app can
  /// fail several gates at once — the catalog shows them all).
  reasons: CompatReason[];
}

/// Numeric semver-ish compare. Splits on `.`, compares the leading
/// integer of each segment (so `2.0.0` < `2.1.0`, `2.0` == `2.0.0`).
/// A non-numeric or empty input returns `null` — the caller treats
/// `null` as "cannot prove ≥", i.e. fail closed.
function semverishGte(have: string | undefined, need: string): boolean | null {
  if (!have) return null;
  const parse = (v: string): number[] | null => {
    const parts = v
      .trim()
      .split('.')
      .map((s) => Number.parseInt(s, 10));
    if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
    return parts;
  };
  const a = parse(have);
  const b = parse(need);
  if (!a || !b) return null;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

/// A rule maps `(requirements, target)` to a failure reason, or
/// `null` when the requirement is absent or satisfied. New gates are
/// added by appending one entry here — nothing else changes
/// (open/closed: callers never branch on requirement kind).
type CompatRule = (req: MiniAppRequires, target: CompatTarget) => CompatReason | null;

const RULES: readonly CompatRule[] = [
  // DiLink generation allow-list.
  (req, target) => {
    if (!req.dilink) return null;
    if (req.dilink.includes(target.dilinkFamily)) return null;
    return {
      code: 'dilink_unsupported',
      detail: `app requires DiLink ${req.dilink.join('|')}; car is ${target.dilinkFamily}`,
    };
  },

  // Vehicle-hardware capability subset (branchless bitmask AND).
  (req, target) => {
    if (!req.vehicleCapabilities) return null;
    const requiredBits = bitsFromCapabilities(req.vehicleCapabilities);
    const targetBits =
      target.vehicleCapabilityBits ?? bitsFromCapabilities(target.vehicleCapabilities ?? []);
    if (hasAllCapabilities(targetBits, requiredBits)) return null;
    const missing = capabilitiesFromBits(requiredBits & ~targetBits);
    return {
      code: 'missing_vehicle_capabilities',
      detail: `car is missing required capabilities: ${missing.join(', ')}`,
    };
  },

  // Modern WebView (Chrome 100+). Absent target fact ⇒ assume old.
  (req, target) => {
    if (req.modernWebview !== true) return null;
    if (target.modernWebview === true) return null;
    return {
      code: 'webview_too_old',
      detail:
        target.modernWebview === false
          ? 'app needs a modern WebView; this trim ships the frozen Di5.0 WebView'
          : 'app needs a modern WebView; host did not report WebView age (fail closed)',
    };
  },

  // Minimum host bridge protocol version.
  (req, target) => {
    if (!req.minBridge) return null;
    const gte = semverishGte(target.bridgeVersion, req.minBridge);
    if (gte === true) return null;
    return {
      code: 'bridge_too_old',
      detail:
        gte === null
          ? `app requires bridge ≥ ${req.minBridge}; host bridge version unknown (fail closed)`
          : `app requires bridge ≥ ${req.minBridge}; host bridge is ${target.bridgeVersion}`,
    };
  },
];

/// Evaluate whether `manifest` may run on `target`. Pure and
/// allocation-light: returns early for the common "no requirements"
/// case, runs every rule otherwise so the caller sees every failed
/// gate at once.
///
/// `privileged` is intentionally NOT considered here — it is a
/// distribution-ACL concern (who may install), orthogonal to whether
/// the app functions on a given car.
export function evaluateCompatibility(
  manifest: Pick<MiniAppManifest, 'requires'>,
  target: CompatTarget,
): CompatResult {
  const req = manifest.requires;
  if (!req) return { ok: true, reasons: [] };

  // Forward-compat fail-closed: a manifest declaring a newer requires
  // schema carries at least one hard gate this build can't evaluate.
  if (req.schema > REQUIRES_SCHEMA) {
    return {
      ok: false,
      reasons: [
        {
          code: 'unsupported_requires_schema',
          detail:
            `manifest requires.schema=${req.schema} > supported ${REQUIRES_SCHEMA}; ` +
            `update the host/SDK to evaluate this app's requirements`,
        },
      ],
    };
  }

  const reasons: CompatReason[] = [];
  for (const rule of RULES) {
    const reason = rule(req, target);
    if (reason) reasons.push(reason);
  }
  return { ok: reasons.length === 0, reasons };
}

/// Boolean convenience for hot paths / template conditionals.
export function isCompatible(
  manifest: Pick<MiniAppManifest, 'requires'>,
  target: CompatTarget,
): boolean {
  return evaluateCompatibility(manifest, target).ok;
}
