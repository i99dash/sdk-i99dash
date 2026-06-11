/// Public-API surface lock for `i99dash`.
///
/// This test fails on any unintentional change (addition, removal,
/// rename) of the package's named exports. The point is to make
/// surface changes show up as a one-line diff in PR review — a
/// reviewer should never have to grep `dist/index.d.ts` to spot
/// that a contributor accidentally re-exported an internal helper.
///
/// To intentionally change the surface: edit the relevant array
/// here in the same commit. Do NOT add an entry without bumping
/// the package version in conventional-commit style (`feat(sdk):`
/// for additions, `feat(sdk)!:` for removals).

import { describe, expect, it } from 'vitest';

import * as sdk from '../index.js';
import * as types from '../public-types.js';

const SDK_PUBLIC_EXPORTS = [
  'BootController',
  'BridgeTimeoutError',
  'BridgeTransportError',
  'CAR_MAX_NAMES',
  'CarController',
  'CursorController',
  'DisplayController',
  'FamilyOpError',
  'FamilyUnavailableError',
  'GestureController',
  'HOST_EVENTS_GLOBAL',
  'HOST_GLOBAL',
  'HostBridge',
  'InvalidResponseError',
  'LEGACY_HOST_GLOBAL',
  'MiniAppClient',
  'NotInsideHostError',
  'PermissionDeniedAggregator',
  'PkgController',
  'RESERVED_OVERRIDE_LABELS',
  'SDKError',
  'SURFACE_ROUTE_REGEX',
  'SurfaceController',
  'SurfaceRouteError',
  'createClientOrSSR',
  'decodeFamilyEnvelope',
  'ensureHostEvents',
  'invokeFamily',
  'isCapabilitiesBridge',
  'isCarBridge',
  'isFamilyBridge',
  'newIdempotencyKey',
  'resolveHostApi',
  'withTimeout',
] as const;

const TYPES_RUNTIME_EXPORTS: readonly string[] = [
  // The `/types` subpath is type-only by design. Any runtime symbol
  // added here is a regression — types should erase to nothing.
];

describe('i99dash — public API surface', () => {
  it('exports exactly the documented runtime symbols', () => {
    const actual = Object.keys(sdk).sort();
    expect(actual).toEqual([...SDK_PUBLIC_EXPORTS].sort());
  });

  it('the /types subpath has zero runtime exports', () => {
    const actual = Object.keys(types).sort();
    expect(actual).toEqual([...TYPES_RUNTIME_EXPORTS].sort());
  });
});
