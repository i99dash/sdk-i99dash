# Changelog

All notable changes to the `i99dash` package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

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
