# Changelog

All notable changes to the `i99dash` package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [5.4.0](https://github.com/i99dash/i99dash-sdk/compare/v5.3.0...v5.4.0) (2026-05-23)


### Features

* **themes:** add ThemeSpec/ThemeManifest schemas + theme CLI ([#60](https://github.com/i99dash/i99dash-sdk/issues/60)) ([92bc7f8](https://github.com/i99dash/i99dash-sdk/commit/92bc7f84ba66f017ab3b67e812333f4bb697d807))

## [5.3.0](https://github.com/i99dash/i99dash-sdk/compare/v5.2.0...v5.3.0) (2026-05-18)


### Features

* **compat:** Gate B — enforce the Di5.0 (Chromium 95) WebView baseline at build/publish ([#58](https://github.com/i99dash/i99dash-sdk/issues/58)) ([342c282](https://github.com/i99dash/i99dash-sdk/commit/342c2828a459433c3ef5d9dfeac0c996df51907c))

## [5.2.0](https://github.com/i99dash/i99dash-sdk/compare/v5.1.0...v5.2.0) (2026-05-16)


### Features

* **sdk:** manifest requires + evaluateCompatibility compatibility gate ([#53](https://github.com/i99dash/i99dash-sdk/issues/53)) ([452772c](https://github.com/i99dash/i99dash-sdk/commit/452772c706d516f2c499d3374e4cb0f3d792336c))

## [5.1.0](https://github.com/i99dash/i99dash-sdk/compare/v5.0.0...v5.1.0) (2026-05-14)


### Features

* re-export SurfaceController + add pkg controller tests ([903aa16](https://github.com/i99dash/i99dash-sdk/commit/903aa16e66093d834f04d71c7184b8eefba1ab55))
* **sdk:** add MiniAppClient.callFamily + SurfaceController.buildRoute (v5.1.0) ([216b7a7](https://github.com/i99dash/i99dash-sdk/commit/216b7a7b7687c69f266985a016409f4dff14618b))

## [5.0.0](https://github.com/i99dash/i99dash-sdk/compare/v4.0.0...v5.0.0) (2026-05-13)


### ⚠ BREAKING CHANGES

* v5.0.0 — single `client.car` controller, drop per-family ([#50](https://github.com/i99dash/i99dash-sdk/issues/50))

### Features

* v5.0.0 — single `client.car` controller, drop per-family ([#50](https://github.com/i99dash/i99dash-sdk/issues/50)) ([feb3bfc](https://github.com/i99dash/i99dash-sdk/commit/feb3bfc57615d4324830ad5de2d8772c9f8d3d67))

## [4.0.0](https://github.com/i99dash/i99dash-sdk/compare/v3.1.0...v4.0.0) (2026-05-13)


### ⚠ BREAKING CHANGES

* v4.0 — device_id rename + multi-brand types
* ``MiniAppManifestSchema`` no longer accepts ``requiredPermissions`` or ``requiredCapabilities``; both fields are silently stripped at parse time. CLI commands ``i99dash login`` and ``i99dash perms`` (and the underlying ``api/endpoints`` + ``auth/cert`` modules) are gone with the backend's admin_perms removal. Apps relying on install-time gating should migrate to runtime feature probing via ``client.has(...)`` — see ``MIGRATING.md``.
* **display:** `client.display.list()` now resolves to `DisplayListResult` (`{displays, vehicle?}`) instead of `DisplaySnapshot[]`. Migration is one rename per call site:

### Features

* **cli:** i99dash init --template cluster-widget + Renovate/Dependabot automation ([#18](https://github.com/i99dash/i99dash-sdk/issues/18)) ([6f63f3f](https://github.com/i99dash/i99dash-sdk/commit/6f63f3f5b267f2cead3f95ddd96a9054b4f3cecd))
* **dash-wallpaper:** mark Upload + Gradient as v0.2 placeholders ([#9](https://github.com/i99dash/i99dash-sdk/issues/9)) ([89b9567](https://github.com/i99dash/i99dash-sdk/commit/89b9567f43a626523406964777263bd459608ad1))
* **dev-server:** native-capability fakes for display/surface/cursor/gesture/pkg/boot ([#17](https://github.com/i99dash/i99dash-sdk/issues/17)) ([6b51344](https://github.com/i99dash/i99dash-sdk/commit/6b51344d60248bb0b792589649675272e7172a59))
* **display:** surface every host wire field + driver-eyeline contract ([#32](https://github.com/i99dash/i99dash-sdk/issues/32)) ([f0b8ab0](https://github.com/i99dash/i99dash-sdk/commit/f0b8ab057842d455cb348982dd381b89d465f2e2))
* drop manifest perm/cap fields + perms/login CLI commands ([#41](https://github.com/i99dash/i99dash-sdk/issues/41)) ([e03c185](https://github.com/i99dash/i99dash-sdk/commit/e03c1859d0bc2e16422cf2b75cdde8967d3b7390))
* **examples:** add cluster-hello-world and cluster-remote reference apps ([#2](https://github.com/i99dash/i99dash-sdk/issues/2)) ([c615379](https://github.com/i99dash/i99dash-sdk/commit/c615379f710ea825226e3db7cad74acb9d50b1ae))
* **examples:** dash-wallpaper — three-screen ambient customizer ([#5](https://github.com/i99dash/i99dash-sdk/issues/5)) ([867cc22](https://github.com/i99dash/i99dash-sdk/commit/867cc22c6d58233b0a9a6d1c5806d3272f9c35bf))
* **examples:** dash-wallpaper — three-screen ambient customizer ([#7](https://github.com/i99dash/i99dash-sdk/issues/7)) ([6bc28e7](https://github.com/i99dash/i99dash-sdk/commit/6bc28e764c83b036d6c2e6429efceced374ef4e3))
* **examples:** pkg-launcher — Phase C reference mini-app ([#16](https://github.com/i99dash/i99dash-sdk/issues/16)) ([582bb5b](https://github.com/i99dash/i99dash-sdk/commit/582bb5b268dcd2acc740533225c6277361bbe8fd))
* **examples:** pkg-launcher + dash-wallpaper consume host 1.6 fields ([#24](https://github.com/i99dash/i99dash-sdk/issues/24)) ([5ebb17b](https://github.com/i99dash/i99dash-sdk/commit/5ebb17b3988c0dd8296f923090da2c504587f016))
* **examples:** Sentry trim-tagging for pkg-launcher + dash-wallpaper ([#36](https://github.com/i99dash/i99dash-sdk/issues/36)) ([8201e96](https://github.com/i99dash/i99dash-sdk/commit/8201e9627500ebabecb2c2ae66266379db59c91d))
* fold sdk-dev-server and sdk-react into i99dash ([2ee98e5](https://github.com/i99dash/i99dash-sdk/commit/2ee98e5711c9237f4962fb571989e5baae5d2970))
* initial release of the consolidated i99dash SDK ([1eb7f55](https://github.com/i99dash/i99dash-sdk/commit/1eb7f55d42ebfb4b30b10548a859203658668b30))
* **pkg-launcher:** drop launch-vs-input heuristic now host resolves it ([#22](https://github.com/i99dash/i99dash-sdk/issues/22)) ([09327d5](https://github.com/i99dash/i99dash-sdk/commit/09327d54695aef865ed8e02a6ab2efba4459669b))
* **pkg-launcher:** per-trim capability gating + L5 DiShare passenger fallback ([a6b4825](https://github.com/i99dash/i99dash-sdk/commit/a6b4825d7d0970dc9be51270703a4157d31fe2e3))
* **pkg-launcher:** UX overhaul (recents, last-target, redesigned tile, backdrop-close) ([#44](https://github.com/i99dash/i99dash-sdk/issues/44)) ([75a94f8](https://github.com/i99dash/i99dash-sdk/commit/75a94f885426ae770a161dc000a2be9c280fcde4))
* **pkg:** targetRole='passenger' option for L5/L5U DiShare cast ([bc4cd85](https://github.com/i99dash/i99dash-sdk/commit/bc4cd8549917fdaf85e6d5c67400e563f2c35ec0))
* profile-key v2 schemas matching backend 1.13.0-b ([#29](https://github.com/i99dash/i99dash-sdk/issues/29)) ([2206ae7](https://github.com/i99dash/i99dash-sdk/commit/2206ae7c03dbe283901a8412425d507f6dd1e21c))
* rename vin to bydDeviceId (Option A — deprecation overlap, v3.1.0) ([a221f00](https://github.com/i99dash/i99dash-sdk/commit/a221f00524e5355bc0ceee62087132d7bd714a44))
* **runtime:** batched updates to display/location/pkg + pkg-launcher example ([d19ba74](https://github.com/i99dash/i99dash-sdk/commit/d19ba74d8d4c5013fa4cb0d6329338a3ed75d163))
* **sdk:** Phase C — PkgController + BootController ([#15](https://github.com/i99dash/i99dash-sdk/issues/15)) ([f9a473a](https://github.com/i99dash/i99dash-sdk/commit/f9a473a55a7dee995251d4ac6bd50cc0a4755686))
* v4.0 — device_id rename + multi-brand types ([00fdcbb](https://github.com/i99dash/i99dash-sdk/commit/00fdcbb77cf38c5dc046027d5a51968d21213e1d))
* vehicle-capability taxonomy + drift check ([#26](https://github.com/i99dash/i99dash-sdk/issues/26)) ([30053fd](https://github.com/i99dash/i99dash-sdk/commit/30053fd3fbfff58422e00016a7d4e915ecbb3262))


### Bug Fixes

* **bridge:** unwrap host envelope in legacy direct-method get* calls ([#37](https://github.com/i99dash/i99dash-sdk/issues/37)) ([0f5888e](https://github.com/i99dash/i99dash-sdk/commit/0f5888ea21c858aa784086c114af3dc8276a56e2))
* **dash-wallpaper:** replace native color picker with tap-friendly swatch grid ([#13](https://github.com/i99dash/i99dash-sdk/issues/13)) ([819a21b](https://github.com/i99dash/i99dash-sdk/commit/819a21beb34cef050181b5ed43427d5058667b32))
* **dash-wallpaper:** restore Upload + Gradient (revert [#9](https://github.com/i99dash/i99dash-sdk/issues/9), ship 0.1.2) ([#11](https://github.com/i99dash/i99dash-sdk/issues/11)) ([115c28d](https://github.com/i99dash/i99dash-sdk/commit/115c28d67a753d1132e2b2ab18a944a5b6fea8e6))

## [4.0.0](https://github.com/i99dash/i99dash-sdk/compare/v3.1.0...v4.0.0) (2026-05-13)


### ⚠ BREAKING CHANGES

* **types:** rename `bydDeviceId` → `deviceId` across the public surface (`CarStatus`, `AdminClientContext`) and add a sibling `brand: 'byd' | 'geely' | 'nio' | 'tesla'` field. `deviceId` now carries the brand-prefixed canonical form (`byd:BYDMCKLE0PARD8801`) — the same value that flows over MQTT topics, HTTP routes (URL-encoded, since `:` is reserved), Redis keys, and JSON wire payloads. The pre-v4 `vin` deprecated alias and the `bydDeviceId` name are both gone — hard cutover, no compat shim, no preprocess normalizer. Hosts must emit `{deviceId, brand}` on every `CarStatus` snapshot; mini-apps must pass both fields when constructing an `AdminClient`. The schema is `strict` so any payload that still carries the legacy field names fails parse. Route builders (in consumer projects, not this SDK) move from `/api/v1/byd/{byd_device_id}/...` to `/api/v1/cars/{encodeURIComponent(deviceId)}/...`. See MIGRATING.md and `RENAME_BYD_DEVICE_ID_CONTRACT.md` for the cross-project contract.

### Features

* **types:** export `CarBrandSchema` + `CarBrand` enum (`'byd' | 'geely' | 'nio' | 'tesla'`) alongside the renamed `CarStatus` shape so downstream code can typecheck brand strings against the same allowlist the schema validates against.

## [3.1.0](https://github.com/i99dash/i99dash-sdk/compare/v3.0.0...v3.1.0) (2026-05-07)


### Features

* **types:** rename `vin` → `bydDeviceId` across the public surface (`CarStatus`, `AdminClientContext`). The legacy `vin` field still works during the v3.x line and is populated alongside `bydDeviceId` so existing consumers keep functioning unchanged. `CarStatusSchema` accepts payloads with either name on input and prefers `bydDeviceId` when both are present. The renamed field carries BYD's media/cloud device handle (`bydXXXX...`), NOT the ISO 3779 chassis VIN — see `MIGRATING.md` for the rationale and a before/after migration. The `vin` alias is `@deprecated` and will be removed in v4.0.

## [3.0.0](https://github.com/i99dash/i99dash-sdk/compare/v2.1.0...v3.0.0) (2026-05-05)


### ⚠ BREAKING CHANGES

* ``MiniAppManifestSchema`` no longer accepts ``requiredPermissions`` or ``requiredCapabilities``; both fields are silently stripped at parse time. CLI commands ``i99dash login`` and ``i99dash perms`` (and the underlying ``api/endpoints`` + ``auth/cert`` modules) are gone with the backend's admin_perms removal. Apps relying on install-time gating should migrate to runtime feature probing via ``client.has(...)`` — see ``MIGRATING.md``.

### Features

* drop manifest perm/cap fields + perms/login CLI commands ([#41](https://github.com/i99dash/i99dash-sdk/issues/41)) ([e03c185](https://github.com/i99dash/i99dash-sdk/commit/e03c1859d0bc2e16422cf2b75cdde8967d3b7390))

## [2.1.0](https://github.com/i99dash/i99dash-sdk/compare/v2.0.0...v2.1.0) (2026-05-05)


### Features

* **examples:** Sentry trim-tagging for pkg-launcher + dash-wallpaper ([#36](https://github.com/i99dash/i99dash-sdk/issues/36)) ([8201e96](https://github.com/i99dash/i99dash-sdk/commit/8201e9627500ebabecb2c2ae66266379db59c91d))


### Bug Fixes

* **bridge:** unwrap host envelope in legacy direct-method get* calls ([#37](https://github.com/i99dash/i99dash-sdk/issues/37)) ([0f5888e](https://github.com/i99dash/i99dash-sdk/commit/0f5888ea21c858aa784086c114af3dc8276a56e2))

## [2.0.0](https://github.com/i99dash/i99dash-sdk/compare/v1.10.0...v2.0.0) (2026-05-05)


### ⚠ BREAKING CHANGES

* **display:** `client.display.list()` now resolves to `DisplayListResult` (`{displays, vehicle?}`) instead of `DisplaySnapshot[]`. Migration is one rename per call site:

### Features

* **display:** surface every host wire field + driver-eyeline contract ([#32](https://github.com/i99dash/i99dash-sdk/issues/32)) ([f0b8ab0](https://github.com/i99dash/i99dash-sdk/commit/f0b8ab057842d455cb348982dd381b89d465f2e2))

## [1.10.0](https://github.com/i99dash/i99dash-sdk/compare/v1.9.0...v1.10.0) (2026-05-05)


### Features

* **pkg-launcher:** per-trim capability gating + L5 DiShare passenger fallback ([a6b4825](https://github.com/i99dash/i99dash-sdk/commit/a6b4825d7d0970dc9be51270703a4157d31fe2e3))
* **pkg:** targetRole='passenger' option for L5/L5U DiShare cast ([bc4cd85](https://github.com/i99dash/i99dash-sdk/commit/bc4cd8549917fdaf85e6d5c67400e563f2c35ec0))

## [1.9.0](https://github.com/i99dash/i99dash-sdk/compare/v1.8.0...v1.9.0) (2026-05-05)


### Features

* profile-key v2 schemas matching backend 1.13.0-b ([#29](https://github.com/i99dash/i99dash-sdk/issues/29)) ([2206ae7](https://github.com/i99dash/i99dash-sdk/commit/2206ae7c03dbe283901a8412425d507f6dd1e21c))

## [1.8.0](https://github.com/i99dash/i99dash-sdk/compare/v1.7.0...v1.8.0) (2026-05-05)


### Features

* vehicle-capability taxonomy + drift check ([#26](https://github.com/i99dash/i99dash-sdk/issues/26)) ([30053fd](https://github.com/i99dash/i99dash-sdk/commit/30053fd3fbfff58422e00016a7d4e915ecbb3262))

## [1.7.0](https://github.com/i99dash/i99dash-sdk/compare/v1.6.0...v1.7.0) (2026-05-03)


### Features

* **examples:** pkg-launcher + dash-wallpaper consume host 1.6 fields ([#24](https://github.com/i99dash/i99dash-sdk/issues/24)) ([5ebb17b](https://github.com/i99dash/i99dash-sdk/commit/5ebb17b3988c0dd8296f923090da2c504587f016))
* **pkg-launcher:** drop launch-vs-input heuristic now host resolves it ([#22](https://github.com/i99dash/i99dash-sdk/issues/22)) ([09327d5](https://github.com/i99dash/i99dash-sdk/commit/09327d54695aef865ed8e02a6ab2efba4459669b))

## [1.6.0](https://github.com/i99dash/i99dash-sdk/compare/v1.5.0...v1.6.0) (2026-05-03)


### Features

* **cli:** i99dash init --template cluster-widget + Renovate/Dependabot automation ([#18](https://github.com/i99dash/i99dash-sdk/issues/18)) ([6f63f3f](https://github.com/i99dash/i99dash-sdk/commit/6f63f3f5b267f2cead3f95ddd96a9054b4f3cecd))
* **dev-server:** native-capability fakes for display/surface/cursor/gesture/pkg/boot ([#17](https://github.com/i99dash/i99dash-sdk/issues/17)) ([6b51344](https://github.com/i99dash/i99dash-sdk/commit/6b51344d60248bb0b792589649675272e7172a59))
* **examples:** pkg-launcher — Phase C reference mini-app ([#16](https://github.com/i99dash/i99dash-sdk/issues/16)) ([582bb5b](https://github.com/i99dash/i99dash-sdk/commit/582bb5b268dcd2acc740533225c6277361bbe8fd))
* **runtime:** batched updates to display/location/pkg + pkg-launcher example ([d19ba74](https://github.com/i99dash/i99dash-sdk/commit/d19ba74d8d4c5013fa4cb0d6329338a3ed75d163))
* **sdk:** Phase C — PkgController + BootController ([#15](https://github.com/i99dash/i99dash-sdk/issues/15)) ([f9a473a](https://github.com/i99dash/i99dash-sdk/commit/f9a473a55a7dee995251d4ac6bd50cc0a4755686))


### Bug Fixes

* **dash-wallpaper:** replace native color picker with tap-friendly swatch grid ([#13](https://github.com/i99dash/i99dash-sdk/issues/13)) ([819a21b](https://github.com/i99dash/i99dash-sdk/commit/819a21beb34cef050181b5ed43427d5058667b32))

## [1.5.0](https://github.com/i99dash/i99dash-sdk/compare/v1.4.0...v1.5.0) (2026-05-02)


### Features

* **dash-wallpaper:** mark Upload + Gradient as v0.2 placeholders ([#9](https://github.com/i99dash/i99dash-sdk/issues/9)) ([89b9567](https://github.com/i99dash/i99dash-sdk/commit/89b9567f43a626523406964777263bd459608ad1))


### Bug Fixes

* **dash-wallpaper:** restore Upload + Gradient (revert [#9](https://github.com/i99dash/i99dash-sdk/issues/9), ship 0.1.2) ([#11](https://github.com/i99dash/i99dash-sdk/issues/11)) ([115c28d](https://github.com/i99dash/i99dash-sdk/commit/115c28d67a753d1132e2b2ab18a944a5b6fea8e6))

## [1.4.0](https://github.com/i99dash/i99dash-sdk/compare/v1.3.0...v1.4.0) (2026-05-02)


### Features

* **examples:** dash-wallpaper — three-screen ambient customizer ([#7](https://github.com/i99dash/i99dash-sdk/issues/7)) ([6bc28e7](https://github.com/i99dash/i99dash-sdk/commit/6bc28e764c83b036d6c2e6429efceced374ef4e3))

## [1.3.0](https://github.com/i99dash/i99dash-sdk/compare/v1.2.0...v1.3.0) (2026-05-02)


### Features

* **examples:** dash-wallpaper — three-screen ambient customizer ([#5](https://github.com/i99dash/i99dash-sdk/issues/5)) ([867cc22](https://github.com/i99dash/i99dash-sdk/commit/867cc22c6d58233b0a9a6d1c5806d3272f9c35bf))

## [1.2.0](https://github.com/i99dash/i99dash-sdk/compare/v1.1.0...v1.2.0) (2026-05-02)


### Features

* **examples:** add cluster-hello-world and cluster-remote reference apps ([#2](https://github.com/i99dash/i99dash-sdk/issues/2)) ([c615379](https://github.com/i99dash/i99dash-sdk/commit/c615379f710ea825226e3db7cad74acb9d50b1ae))

## [1.1.0](https://github.com/i99dash/i99dash-sdk/compare/v1.0.0...v1.1.0) (2026-05-01)

### Features

- fold sdk-dev-server and sdk-react into i99dash ([2ee98e5](https://github.com/i99dash/i99dash-sdk/commit/2ee98e5711c9237f4962fb571989e5baae5d2970))
- initial release of the consolidated i99dash SDK ([1eb7f55](https://github.com/i99dash/i99dash-sdk/commit/1eb7f55d42ebfb4b30b10548a859203658668b30))

## [Unreleased]

### Added

- Initial release. Consolidates `@i99dash/sdk-types`, `@i99dash/sdk`, `@i99dash/admin-sdk`, `@i99dash/sdk-cli`, `@i99dash/sdk-react`, and `@i99dash/sdk-dev-server` into a single `i99dash` package on public npm.
- CLI binary renamed from `sdk-i99dash` to `i99dash`.
- React bindings move to `i99dash/react` (subpath); dev-server moves to `i99dash/dev-server` (subpath). Both stay tree-shakeable from the root entry.
- See [MIGRATING.md](./MIGRATING.md) for the move-from-old-packages guide.
