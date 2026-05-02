# Changelog

All notable changes to the `i99dash` package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

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
