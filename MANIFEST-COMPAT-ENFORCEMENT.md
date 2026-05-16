# Manifest compatibility gate — enforcement spec

The SDK side (schema + the single `evaluateCompatibility()` engine) is
**done and shipped in this package**. A manifest field is inert until
the catalog and host honor it; this spec defines that lockstep work so
both consume the _same_ SDK function rather than re-deriving the rules.

## What shipped in the SDK

- `MiniAppManifestSchema` gains optional `requires`, `permissions`,
  `privileged` (`src/types/manifest.ts`).
- `requires` (`MiniAppRequiresSchema`): `schema`, `dilink`,
  `vehicleCapabilities`, `modernWebview`, `minBridge`. `.passthrough()`
  so a newer manifest never hard-throws on older tooling.
- `evaluateCompatibility(manifest, target) → { ok, reasons[] }` and
  `isCompatible(...)` (`src/types/compat.ts`). Pure, rule-array,
  branchless capability check (`hasAllCapabilities`), **fail-closed**.
- `REQUIRES_SCHEMA = 1`. Bump when a new `requires.*` key is added.
- All exported from `i99dash` root. 285 tests green; typecheck + build
  clean.

## Invariants every consumer MUST keep

1. **One evaluator.** Backend (Python) and host (Kotlin/Dart) call a
   port of `evaluateCompatibility` with identical rule order and
   fail-closed semantics — never a bespoke reimplementation. Port =
   line-by-line mirror, covered by the same case table as
   `src/types/__tests__/compat.test.ts`.
2. **Fail-closed.** Unknown DiLink, absent host fact, or
   `requires.schema > REQUIRES_SCHEMA` ⇒ incompatible. Hiding a working
   app is recoverable; launching a broken one on a moving car is not.
3. **`privileged` is not a vehicle gate.** It is a distribution ACL
   (who may install). Keep it out of `evaluateCompatibility`.

## Backend — `backend-i99dash`

`GET /api/v1/mini-apps/catalog?profileKey=…`:

1. Resolve the caller's `CompatTarget` from the stored
   `VehicleCapabilitiesSnapshot` for the `ProfileKey`
   (`dilinkFamily`, `capabilityBits`, plus `bridgeVersion` /
   `modernWebview` from the host handshake row).
2. For each catalog row, run the evaluator; **omit** rows where
   `ok === false`. Do not return-and-flag — hide (matches the
   hide-not-disable convention).
3. Mirror `evaluateCompatibility` in
   `app/domain/manifest_compat.py`; add `manifest_compat_test.py`
   with the exact `compat.test.ts` cases. Wire
   `scripts/check-capability-drift.mjs`-style drift if the rule set
   is duplicated.

## Host — `car-i99dash`

Defense in depth (a stale catalog cache must not launch an
incompatible app):

1. Build `CompatTarget` from `CarIdentity.resolveDilinkFamily()` +
   the resolved `CarProfile` capability bitmask + bridge version +
   a `modernWebview` bit (Di5.0 ⇒ false; Di5.1 ⇒ true — already
   implied by the per-trim profile).
2. On launch, evaluate the app's `requires`. If `!ok`, refuse with a
   user-facing reason mapped from `reasons[].code` (closed set:
   `unsupported_requires_schema`, `dilink_unsupported`,
   `missing_vehicle_capabilities`, `webview_too_old`,
   `bridge_too_old`) — same surface as the `minHostVersion`
   "update your app" card.
3. Port lives next to `VehicleCapability.kt`; reuse the existing
   capability bitmask. Unit-test against the shared case table.

## Versioning protocol

Adding a new hard requirement = one coordinated change:

1. Add the key to `MiniAppRequiresSchema` + a rule in `compat.ts`;
   bump `REQUIRES_SCHEMA`.
2. Port the rule to backend + host; bump their mirrored constant.
3. Ship host/backend **before** any manifest sets the new key.
   Until then, older hosts fail-closed on the higher `schema`
   (apps using the new key are hidden, never broken).

## Author guidance (docs follow-up)

- Cluster app → `requires.vehicleCapabilities: ['surface.write.cluster']`
  (preferred — capability, not generation).
- Modern-bundle app → `requires.modernWebview: true` (or just ship a
  classic IIFE and omit it — see `guides/l5-l8-support`).
- "Runs anywhere, degrades" → omit `requires` entirely.
- `i99dash validate` already warns on contradictory combinations
  (e.g. Di5.0-only + a cluster capability).
