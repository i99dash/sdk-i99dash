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

## Gate B — WebView baseline (static, build/publish enforced)

`requires.modernWebview` / `evaluateCompatibility` (above) is **Gate
A**: a _declaration_ the catalog/host use to HIDE a Di5.1-only app
from Di5.0 cars. It does not stop an author who simply _forgets_ to
declare it from shipping ES2023+/Chrome-96+ code that passes Gate A
and then crashes on a Di5.0 car. **Gate B** closes that hole by
statically proving the shipped JS actually runs on the oldest
supported WebView.

- **Single source:** `WEBVIEW_BASELINE` + `checkWebviewBaseline()`
  (`src/types/webview-baseline.ts`, exported from the `i99dash` root —
  same posture as `evaluateCompatibility`). Any host/backend port
  reads THESE constants; the floor never drifts between layers.
- **Floor:** Di5.0 (Leopard 5 / Song PLUS) ships
  `com.android.webview 95.0.4638.74` = **Chromium 95**. Chromium 95
  runs all ES2022 _syntax_ (optional chaining, `??`, logical
  assignment, private methods, class static blocks, `.at()`,
  top-level await). So `WEBVIEW_BASELINE.ecmaVersion = 2022` — an
  es2019 parser would _wrongly reject valid Di5.0 code_. The real
  Di5.0 gaps are (1) ES-module loading in the mini-app WebView host
  and (2) Chrome-96+ runtime APIs (`structuredClone` 98,
  `Array.findLast` 97, `Promise.withResolvers` 119, …). So Gate B =
  ES2022 syntax ceiling + classic/IIFE format + an API denylist.
- **Enforcement:** `runBuild()` globs every shipped `*.{js,mjs,cjs}`
  in the build output and runs `checkWebviewBaseline`. A violation
  **hard-fails `build` (and therefore `publish`)** —
  `WebviewBaselineError`, fail-closed. `validate` is unchanged
  (pre-build it has no bundle to inspect).
- **Escape hatch (keeps A+B one policy):** if the manifest _explicitly_
  declares the app Di5.1-only (`requires.modernWebview: true`, or a
  `requires.dilink` allow-list excluding `di5.0`), Gate A already
  hides it on Di5.0, so Gate B downgrades violations to an info note
  instead of failing. So: stay within the baseline → runs on **5.0
  and 5.1** from one bundle; OR declare modernWebview → Gate A
  excludes you from 5.0. There is no third, broken state.
- **The rule, restated:** a mini-app must not use JS above the
  Chromium-95 floor unless it explicitly opts out of Di5.0 — now
  _enforced_, not just documented. Floor bump = change the one
  `WEBVIEW_BASELINE` constant.
