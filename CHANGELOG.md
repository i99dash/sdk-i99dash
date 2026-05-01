# Changelog

All notable changes to the `i99dash` package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Initial release. Consolidates `@i99dash/sdk-types`, `@i99dash/sdk`, `@i99dash/admin-sdk`, `@i99dash/sdk-cli`, `@i99dash/sdk-react`, and `@i99dash/sdk-dev-server` into a single `i99dash` package on public npm.
- CLI binary renamed from `sdk-i99dash` to `i99dash`.
- React bindings move to `i99dash/react` (subpath); dev-server moves to `i99dash/dev-server` (subpath). Both stay tree-shakeable from the root entry.
- See [MIGRATING.md](./MIGRATING.md) for the move-from-old-packages guide.
