# Migrating to v7.0 — `callApi` removed; declare `network` + use `fetch()`

`7.0.0` is a hard cutover that **removes the `callApi` primitive entirely**.
There is no host-proxied backend channel any more. A mini-app now reaches an
external HTTP API with a **normal browser `fetch()`**, restricted to the HTTPS
origins it declares in its manifest `network` field; the car host enforces the
allow-list (request interception + a per-app Content-Security-Policy).

Removed (no shim, no alias):

- `MiniAppClient.callApi()` / `callApiOrThrow()`, `CallApiRequest` / `CallApiResponse` / `ApiMethod`, `CallApiFailedError` / `CALL_API_FAILED`.
- The React `useCallApi` hook.
- The dev-server `/_sdk/call-api` route, the fixture store (`mocks/*.json`), the `mocksDir` config key, and the `i99dash doctor` fixtures check.

Migrate:

```diff
- const r = await client.callApi({ path: '/api/v1/prices', method: 'GET' });
- if (r.success) render(r.data);
+ // 1. declare the origin in manifest.json: "network": ["https://api.example.com"]
+ // 2. call it directly:
+ const res = await fetch('https://api.example.com/v1/prices');
+ if (res.ok) render(await res.json());
```

Notes:

- Declared egress is **unauthenticated** — no i99dash credentials are attached.
  If you previously relied on `callApi` injecting the user's i99dash session
  token to call the i99dash backend, that capability is gone; fetch your own
  service and do your own auth.
- Undeclared origins are blocked; redirects to undeclared origins are blocked.
- The local dev-server no longer mocks backend calls (no fixtures). `fetch()`
  to your declared origins works directly in dev (subject to that origin's CORS).

---

# Migrating to v4.0 — `bydDeviceId` → `deviceId` (+ `brand`)

`4.0.0` is a hard cutover. The field formerly named `bydDeviceId`
(itself the v3.1 rename of `vin`) is now `deviceId`, and it now
carries the **brand-prefixed canonical form** — `byd:BYDMCKLE0PARD8801`
instead of the bare `BYDMCKLE0PARD8801`. A sibling `brand` field is
added so consumers don't have to parse the prefix on every read.

No compat shim. No legacy alias. No preprocess normalizer. Pre-release
posture across the platform — every host, every backend, every
consumer renames in lockstep with this SDK release. See the
cross-project contract at `RENAME_BYD_DEVICE_ID_CONTRACT.md` in the
i99dash workspace root.

## Why?

We're onboarding non-BYD brands (Tesla, NIO, Geely). The routing key
needs to be brand-aware end-to-end so:

- MQTT topics can be `cars/{brand}/{device_id}/...` (Mosquitto ACLs
  scope per `(brand, device_id)` without parsing payload).
- HTTP routes drop the `/byd/` prefix and become `/api/v1/cars/...`
  with a brand-prefixed `device_id` in the path.
- The DB stores the prefixed form so a future Tesla-adapter row never
  collides with a BYD-adapter row that happens to share a numeric
  suffix.

Naming the field `bydDeviceId` baked the brand into the type name. Now
the type is brand-agnostic.

## What changed — `CarStatus`

```diff
 const status: CarStatus = await client.car.readStatus();
-console.log(status.bydDeviceId);   // gone in v4.0 (was the v3.1 name)
-console.log(status.vin);           // gone in v4.0 (was the pre-v3.1 name)
+console.log(status.deviceId);      // 'byd:BYDMCKLE0PARD8801'
+console.log(status.brand);         // 'byd'
```

The Zod schema is **strict** — payloads that still carry `vin` or
`bydDeviceId` fail parse. Hosts must emit `{deviceId, brand}` on every
`onStatusChange` push. There is no longer a `preprocess` normalizer
quietly accepting the old shape.

`brand` must be one of `'byd' | 'geely' | 'nio' | 'tesla'` (exported
as `CarBrand` / `CarBrandSchema`). The prefix in `deviceId` must match
`brand`. Wire-level mismatches between the two are caught upstream
(backend returns 422); the SDK's role is to refuse malformed
snapshots.

## What changed — `AdminClientContext`

```diff
 AdminClient.fromWindow({
-  context: { appId: 'diag', bydDeviceId: 'bydE51DB8F5AE5E3713' },
+  context: { appId: 'diag', deviceId: 'byd:BYDMCKLE0PARD8801', brand: 'byd' },
   catalog: snapshot,
 });
```

Both `deviceId` and `brand` are required. The host injects them
through the regular `getContext` bridge — see the host's adapter
release notes for how the migration lands on its side.

## Routes (in consumer projects, not this SDK)

If you build URLs in your mini-app or website, the `/byd/` segment is
gone and the `device_id` is URL-encoded because the prefix contains
`:`:

```diff
-fetch(`/api/v1/byd/${bydDeviceId}/status`)
+fetch(`/api/v1/cars/${encodeURIComponent(deviceId)}/status`)
```

`byd:BYDMCKLE0PARD8801` on the wire becomes `byd%3ABYDMCKLE0PARD8801`
in the path. FastAPI's path-param parser decodes it; you must encode
before substitution.

## Timeline

- **v4.0.0** (this release): hard cutover. `vin` / `bydDeviceId`
  payloads fail parse. Upgrade in lockstep with the matching backend
  - host release.
- No further `v3.x` patches — `3.x` consumers stay on `3.x` until they
  cut over.

## Compat-test reference

`src/types/__tests__/car-status-deprecation.test.ts` pins the
post-rename shape: it asserts the new keys are required AND that the
legacy keys are rejected, so we can't accidentally re-introduce a
back-compat shim under `strict()`.

---

# Migrating to v3.1 — `vin` → `bydDeviceId`

`3.1.0` renames the public `vin` field to `bydDeviceId` across the SDK's
type surface. The change is **non-breaking**: the old name keeps working
for the entire v3.x line. Existing code that reads `status.vin` continues
to work unchanged — the SDK populates both fields with the same value.
The legacy alias becomes a hard error in `4.0`, so migrate when convenient.

## Why?

The value labeled `vin` in this SDK is BYD's media/cloud device handle
(format: `bydXXXX...`, derived at the factory from the head unit's
hardware fingerprint and exposed via `persist.sys.cloud.last_vin`). It is
**not** the ISO 3779 chassis VIN that police, insurers, and DMV systems
use — the chassis VIN lives on the CAN bus behind a platform-signed
service binder and isn't reachable by mini-apps.

Calling our field `vin` made even our own engineers think we were
collecting the regulated identifier. Renaming to `bydDeviceId` makes the
distinction explicit in code and in IDE autocomplete.

## What changed

`CarStatus` (the live status snapshot pushed via `client.car.onStatusChange`):

```diff
 const status: CarStatus = await client.car.readStatus();
-console.log(status.vin);          // still works, IDE flags as @deprecated
+console.log(status.bydDeviceId);  // canonical from v3.1 onwards
```

`CarStatusSchema` accepts payloads with either field name on input.
Hosts that haven't migrated their wire format yet (still emitting `vin`)
keep working. Hosts that emit `byd_device_id` work too. When both are
present, `bydDeviceId` wins.

`AdminClientContext` (the context the host injects when constructing
`AdminClient`):

```diff
 AdminClient.fromWindow({
-  context: { appId: 'diag', vin: 'bydE51DB8F5AE5E3713' },
+  context: { appId: 'diag', bydDeviceId: 'bydE51DB8F5AE5E3713' },
   catalog: snapshot,
 });
```

Either field is accepted at construction. The host's dispatcher carries
the authoritative tuple anyway, so this surface is informational —
either name resolves identically.

## Timeline

- **v3.1.0** (this release): both names work. Old name is `@deprecated`.
- **v3.x** (subsequent minors / patches): no further changes; `vin` keeps
  working unchanged.
- **v4.0.0** (next major, no firm date): `vin` is removed. Migrate before
  upgrading. Run a workspace-wide search for `\.vin\b` against `CarStatus`
  / `AdminClientContext` shapes to find your callsites.

## Compat-test reference

`src/types/__tests__/car-status-deprecation.test.ts` is the regression
fence — it pins the dual-write behavior so we can't accidentally drop the
`vin` alias before the v4 release.

---

# Migrating to v3.0 — perm/cap removal

`3.0.0` removes the install-time permission/capability gating surface that `2.x` carried alongside the runtime feature-probing API. The cleanup is mechanical: a few manifest fields disappear and two CLI commands stop existing.

## Manifest schema

Two top-level fields are gone from `MiniAppManifestSchema`:

```diff
 {
   "id": "com.example.app",
   "name": "Example",
-  "requiredPermissions": ["car.read"],
-  "requiredCapabilities": ["climate"]
 }
```

The Zod parser strips these at validation time; downstream consumers (host installer, admin review surface) no longer read them. Apps that need to branch on host capability should do it at runtime via `client.has("car.read")` — same shape as before, just probed once on mount instead of declared in the manifest.

## CLI

Two commands removed:

```bash
i99dash login    # was: dev-cert acquisition
i99dash perms    # was: list / request perm grants
```

The matching modules (`src/cli/api/endpoints.ts`, `src/cli/auth/cert.ts`, `src/cli/commands/login.ts`, `src/cli/commands/perms.ts`) are gone. `init`, `validate`, `dev`, `build`, `publish`, `doctor`, `beta` are unchanged.

## Why

The privilege-tier surface is being retired across the platform — see the paired changes on backend (`admin_perms` / `dev_access` removal), the head-unit (perms tier UI dropped), the docs site (privilege-tiers / pii-scopes / privileged-apps pages removed), and the website admin (developer portal cert/template/perm surfaces removed). Runtime feature probing covers every legitimate capability check; install-time gating added complexity without closing a gap the runtime didn't already close.

---

# Migrating from the old `@i99dash/*` packages

All six packages — `@i99dash/sdk-types`, `@i99dash/sdk`, `@i99dash/admin-sdk`, `@i99dash/sdk-cli`, `@i99dash/sdk-react`, `@i99dash/sdk-dev-server` — have been consolidated into a single `i99dash` package on public npm. The old packages are deprecated; new releases publish only the consolidated one.

The runtime client + admin client + types live at the root entry. The Node-only dev-server and the React bindings live behind subpaths (`i99dash/dev-server`, `i99dash/react`) so a browser bundle that only imports `MiniAppClient` doesn't pull in `fastify`, and a Node CLI doesn't pull in `react-dom`.

This guide shows the mechanical migration. Pre-release; no compat shim. After the swap your code looks identical except for the import paths.

## Step 1 — swap the dependencies

```diff
{
   "dependencies": {
-    "@i99dash/sdk-types": "^0.1.8",
-    "@i99dash/sdk": "^0.1.8",
-    "@i99dash/admin-sdk": "^0.1.0",
-    "@i99dash/sdk-react": "^0.1.0"
+    "i99dash": "^1.0.0"
   },
   "devDependencies": {
-    "@i99dash/sdk-cli": "^0.1.14",
-    "@i99dash/sdk-dev-server": "^0.1.10"
+    "i99dash": "^1.0.0"
   }
}
```

`i99dash` provides both the library exports AND the CLI binary, so it can sit in either dependency block. We recommend `dependencies` — the runtime client is what your app code actually imports.

## Step 2 — rewrite imports

```bash
# Run from your repo root.
grep -rl '@i99dash/\(sdk\|sdk-types\|admin-sdk\|sdk-react\|sdk-dev-server\)' src/ \
  | xargs sed -i '' \
      -e "s|@i99dash/sdk-types|i99dash|g" \
      -e "s|@i99dash/admin-sdk|i99dash|g" \
      -e "s|@i99dash/sdk-dev-server|i99dash/dev-server|g" \
      -e "s|@i99dash/sdk-react|i99dash/react|g" \
      -e "s|@i99dash/sdk|i99dash|g"
```

(Drop the `''` from `sed -i` on Linux.)

Order matters: longer names (`@i99dash/sdk-types`, `@i99dash/sdk-react`, `@i99dash/sdk-dev-server`, `@i99dash/admin-sdk`) all share a `@i99dash/sdk` prefix — substitute the longer names first so the prefix-only rule doesn't eat them.

## Step 3 — rename CLI invocations

```bash
# package.json scripts and any CI files.
grep -rl 'sdk-i99dash' . \
  | xargs sed -i '' "s|sdk-i99dash|i99dash|g"
```

The binary used to be `sdk-i99dash` (from the old `@i99dash/sdk-cli` package). It's now `i99dash`.

## Step 4 — drop the GitHub Packages auth

The old `@i99dash/admin-sdk` lived on a private GitHub Packages registry. If your `.npmrc` carried the auth solely for that:

```diff
-@i99dash:registry=https://npm.pkg.github.com
-//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

The new `i99dash` package is on public npm. The Flutter host's runtime block remains the only authority for privileged ops — reading the type definitions doesn't grant access to call them.

If you still install other private `@i99dash/*` packages that aren't on the deprecation list (rare), keep the lines and just don't expect them to gate `i99dash`.

## Step 5 — install + verify

```bash
pnpm install
pnpm exec i99dash --help    # should print the new banner
pnpm typecheck              # no broken imports
pnpm test                   # everything still green
```

## Symbol equivalence

Every public symbol the old four packages exported is reachable from `i99dash`. Concretely:

| Old import                                                   | New import                                            |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `import { MiniAppClient } from '@i99dash/sdk'`               | `import { MiniAppClient } from 'i99dash'`             |
| `import { AdminClient } from '@i99dash/admin-sdk'`           | `import { AdminClient } from 'i99dash'`               |
| `import { MiniAppManifestSchema } from '@i99dash/sdk-types'` | `import { MiniAppManifestSchema } from 'i99dash'`     |
| `import { MiniAppProvider } from '@i99dash/sdk-react'`       | `import { MiniAppProvider } from 'i99dash/react'`     |
| `import { startDevServer } from '@i99dash/sdk-dev-server'`   | `import { startDevServer } from 'i99dash/dev-server'` |
| `sdk-i99dash login`                                          | `i99dash login`                                       |

The Node-only dev-server and the React bindings sit behind subpath exports (`i99dash/dev-server`, `i99dash/react`) so a browser bundle that only imports `MiniAppClient` from `i99dash` tree-shakes both away. Your `package.json` still lists `i99dash` once.

## Why?

Privileged developers were installing six packages to get the full toolchain: `@i99dash/sdk` + `@i99dash/admin-sdk` + `@i99dash/sdk-types` (transitive) + `@i99dash/sdk-cli` + `@i99dash/sdk-react` + `@i99dash/sdk-dev-server`. Each had its own version, its own `.npmrc` setup (admin-sdk on private), its own deprecation lifecycle. One package is simpler.

Tradeoff: install-time access gating that the private GitHub Packages registry provided for `@i99dash/admin-sdk` is gone. The host's runtime gate remains authoritative — reading admin type signatures doesn't grant the ability to call them.

## Help

If you hit something the sed snippets miss, file an issue on the new repo: <https://github.com/i99dash/i99dash-sdk>.

---

# Migrating to v5.0 — single `client.car` controller

`5.0.0` is a hard cutover. The eight per-family controllers
(`client.climate`, `.connectivity`, `.location`, `.media`,
`.navigation`, `.system`, `.vehicleDiagnostics`, `.vehicleEnvironment`)
plus the legacy `client.carStatus` shape are **gone**. They are
replaced by a single `client.car` controller that wraps the host's
v2 `car.*` bridge (`car-i99dash`, branch `feat/bridge-v2`).

The host now owns one name-keyed catalog per brand (BYD today —
see `car-i99dash/lib/sdk/brands/byd/byd_public_catalog.dart` for the
canonical name list). Mini-apps **read by name** and **write by
`actionId`**:

```ts
// v4
const climate = await client.climate.getSnapshot();
console.log(climate.cabinTempC, climate.fanSpeed);

// v5
const { values } = await client.car.read(['ac_cabin_temp', 'ac_fan', 'ac_power']);
console.log(values.ac_cabin_temp, values.ac_fan);
```

Bridge protocol version: `2.0.0` (exposed on every `car.list`
response + via `capabilities()`).

## New shape

```ts
client.car.list({ category?, threeDOnly? });
client.car.read(names);                 // ≤ 64 names per call
client.car.subscribe({ names, onEvent });
client.car.command(actionId, args?, { idempotencyKey? });
client.car.identity();                  // memoised per car
client.car.asset(path);                 // base64 → Uint8Array
client.car.connectionSubscribe(onChange);
```

## Per-call mapping

Name set pulled from `byd_public_catalog.dart`. If your mini-app
targets a non-BYD brand later, swap the names for that brand's
catalog — the controller surface is brand-agnostic.

| v4 call                                              | v5 equivalent                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `client.climate.getSnapshot()` → `cabinTempC`        | `client.car.read(['ac_cabin_temp'])`                                                                                   |
| `client.climate.getSnapshot()` → `fanSpeed`          | `client.car.read(['ac_fan'])`                                                                                          |
| `client.climate.getSnapshot()` → `acPower`           | `client.car.read(['ac_power'])`                                                                                        |
| `client.climate.getSnapshot()` → `targetTempC`       | `client.car.read(['ac_target_temp'])`                                                                                  |
| `client.vehicleDiagnostics.getSnapshot()` → tire psi | `client.car.read(['tpms_pressure_lf', 'tpms_pressure_rf', 'tpms_pressure_lr', 'tpms_pressure_rr'])`                    |
| `client.vehicleDiagnostics.getSnapshot()` → odometer | `client.car.read(['stat_total_km'])`                                                                                   |
| `client.carStatus.getSnapshot()` → `speedKmh`        | `client.car.read(['speed_kmh'])`                                                                                       |
| `client.carStatus.getSnapshot()` → `batteryPct`      | `client.car.read(['battery_pct'])`                                                                                     |
| `client.media.getSnapshot()` → playState             | host no longer ships a media bridge; consume Android MediaSession via `_admin.exec` if needed                          |
| `client.system.getSnapshot()` → ota status           | not yet in v2 catalog — file an issue if you depend on it                                                              |
| `client.connectivity.getSnapshot()` → networkType    | not yet in v2 catalog                                                                                                  |
| `client.location.getSnapshot()` → lat/lon            | not yet in v2 catalog (PII tier — coming in a follow-up)                                                               |
| `client.navigation.getSnapshot()` → destination      | not yet in v2 catalog                                                                                                  |
| `client.car.onConnectionChange(...)`                 | `client.car.connectionSubscribe(state => ...)` — note 4 states now: `connected \| degraded \| disconnected \| unknown` |

Writes (lights, doors, climate set-points) go through `car.command`:

```ts
await client.car.command('climate.power.toggle');
await client.car.command('climate.temp.set', { tempC10: 220 });
await client.car.command('lights.lowbeam.toggle');
```

The host returns the `CarCommandRouter` envelope verbatim
(`{ ok, code?, data? }`) — the integrity, rate-limit, and
stationary-speed gates are unchanged from v4.

## 3D mini-apps

`client.car.identity()` is the one-call entry-point for any
mini-app that wants to load the active car's 3D model:

```ts
const id = await client.car.identity();
// id.brand, id.modelCode, id.modelDisplay, id.modelAssetPath
// id.clips:    canonical animation-clip name set
// id.variants: { paint, wheels, glass } — asset name lists

const asset = await client.car.asset(id.modelAssetPath!);
// asset.bytes is a decoded Uint8Array; asset.contentType is the
// inferred MIME (model/gltf-binary for .glb).
```

The result is memoised for the controller's lifetime and
invalidated automatically when the connection-state listener
observes `'disconnected'` — a car-swap flow picks up the new
identity on the next call.

## Removed symbols

Top-level exports dropped in v5:

- `CarStatusController`, `ClimateController`, `ConnectivityController`,
  `LocationController`, `MediaController`, `NavigationController`,
  `SystemController`, `VehicleDiagnosticsController`,
  `VehicleEnvironmentController`
- `isCarStatusBridge`, `isClimateBridge`, `isConnectivityBridge`,
  `isLocationBridge`, `isMediaBridge`, `isNavigationBridge`,
  `isSystemBridge`, `isVehicleDiagnosticsBridge`,
  `isVehicleEnvironmentBridge` (replaced by `isCarBridge`)
- `CarStatusUnavailableError`, `CarStatusQuotaExceededError`,
  `ClimateUnavailableError`, `ConnectivityUnavailableError`,
  `LocationUnavailableError`, `MediaUnavailableError`,
  `NavigationUnavailableError`, `SystemUnavailableError`,
  `VehicleDiagnosticsUnavailableError`,
  `VehicleEnvironmentUnavailableError`
- `CarStatusSchema`, `CarStatusStalenessSchema`, `CarDoorsSchema`,
  `CarDoorStateSchema`, `CarBrandSchema`, `MediaSnapshotSchema`,
  `MediaSourceSchema`, `MediaPlayStateSchema`,
  `ClimateSnapshotSchema`, `ClimateModeSchema`,
  `VehicleDiagnosticsSnapshotSchema`, `GearPositionSchema`,
  `TirePressureSchema`, `VehicleEnvironmentSnapshotSchema`,
  `SystemSnapshotSchema`, `DistanceUnitSchema`,
  `TemperatureUnitSchema`, `OtaStatusSchema`,
  `ConnectivitySnapshotSchema`, `NetworkTypeSchema`,
  `LocationSnapshotSchema`, `NavigationSnapshotSchema`,
  `NavManeuverSchema`

React hooks dropped: `useCarStatus`, `useMedia`, `useClimate`,
`useVehicleDiagnostics`, `useVehicleEnvironment`, `useSystem`,
`useConnectivity`, `useLocation`, `useNavigation`. The replacements
are `useCarSignals(names, opts?)` and `useCarConnection(opts?)`.

Native-capability families (`display`, `surface`, `cursor`,
`gesture`, `pkg`, `boot`) are **unchanged** — those are privileged
ops orthogonal to car data, accessed via `_admin.exec`.

## Why?

One catalog beats nine schemas. Per-family controllers meant the SDK
shipped nine zod schemas, nine `*UnavailableError` classes, nine
`is*Bridge` predicates — and every time the host added a new datum
("outside temperature, please") we needed a coordinated SDK release
to expose it. The v2 bridge inverts that: the host declares its
catalog at runtime via `car.list`, and a mini-app reads any name
without an SDK bump.
