/// Snapshot of the public surface — every symbol that the four old
/// packages (`@i99dash/sdk-types`, `@i99dash/sdk`,
/// `@i99dash/admin-sdk`) used to export must be reachable from
/// `i99dash`'s top-level entry. Fail loudly if a future commit
/// drops one on the floor.
///
/// This is intentionally a flat list, not a programmatic walk —
/// "did anyone delete `MiniAppContextSchema` accidentally?" needs a
/// concrete failure, not "huh, the count went down by 1." When a new
/// public symbol lands, add it here in the same PR.

import { describe, expect, it } from 'vitest';

import * as i99dash from '../index.js';
import * as devServer from '../dev-server/index.js';
import * as react from '../react/index.js';

const EXPECTED_PUBLIC_SYMBOLS = [
  // ── @i99dash/sdk-types: schemas + types ─────────────────────────
  'MiniAppContextSchema',
  'MiniAppManifestSchema',
  'LocaleMapSchema',
  'CATEGORY_SLUGS',
  'ApiMethodSchema',
  'CallApiRequestSchema',
  'CallApiResponseSchema',
  'CarStatusSchema',
  'CarStatusStalenessSchema',
  'CarDoorsSchema',
  'CarDoorStateSchema',
  'CarConnectionStateSchema',
  'HostCapabilitiesSchema',
  'MediaSnapshotSchema',
  'MediaSourceSchema',
  'MediaPlayStateSchema',
  'ClimateSnapshotSchema',
  'ClimateModeSchema',
  'VehicleDiagnosticsSnapshotSchema',
  'GearPositionSchema',
  'TirePressureSchema',
  'VehicleEnvironmentSnapshotSchema',
  'SystemSnapshotSchema',
  'DistanceUnitSchema',
  'TemperatureUnitSchema',
  'OtaStatusSchema',
  'ConnectivitySnapshotSchema',
  'NetworkTypeSchema',
  'LocationSnapshotSchema',
  'NavigationSnapshotSchema',
  'NavManeuverSchema',

  // ── @i99dash/sdk: runtime client ─────────────────────────────────
  'MiniAppClient',
  'HostBridge',
  'HOST_GLOBAL',
  'HOST_EVENTS_GLOBAL',
  'LEGACY_HOST_GLOBAL',
  'isCapabilitiesBridge',
  'isCarStatusBridge',
  'isClimateBridge',
  'isConnectivityBridge',
  'isLocationBridge',
  'isMediaBridge',
  'isNavigationBridge',
  'isSystemBridge',
  'isVehicleDiagnosticsBridge',
  'isVehicleEnvironmentBridge',
  'resolveHostApi',
  'CarStatusController',
  'ClimateController',
  'ConnectivityController',
  'LocationController',
  'MediaController',
  'NavigationController',
  'SystemController',
  'VehicleDiagnosticsController',
  'VehicleEnvironmentController',
  'BridgeTimeoutError',
  'BridgeTransportError',
  'CallApiFailedError',
  'CarStatusQuotaExceededError',
  'CarStatusUnavailableError',
  'ClimateUnavailableError',
  'ConnectivityUnavailableError',
  'InvalidResponseError',
  'LocationUnavailableError',
  'MediaUnavailableError',
  'NavigationUnavailableError',
  'NotInsideHostError',
  'SDKError',
  'SystemUnavailableError',
  'VehicleDiagnosticsUnavailableError',
  'VehicleEnvironmentUnavailableError',
  'PermissionDeniedAggregator',
  'createClientOrSSR',
  'withTimeout',

  // ── @i99dash/admin-sdk ──────────────────────────────────────────
  'AdminClient',
  'UnknownTemplateError',
  'FakeAdminBridge',
  'HostAdminBridge',
  'snapshotFromList',
] as const;

describe('public surface', () => {
  it('exports every symbol the old four packages exposed', () => {
    const exported = new Set(Object.keys(i99dash));
    const missing = EXPECTED_PUBLIC_SYMBOLS.filter((name) => !exported.has(name));
    expect(
      missing,
      `symbols missing from i99dash's top-level entry: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('does not silently drop the runtime client', () => {
    expect(typeof i99dash.MiniAppClient).toBe('function');
  });

  it('does not silently drop the admin client', () => {
    expect(typeof i99dash.AdminClient).toBe('function');
  });

  it('exposes CATEGORY_SLUGS as the canonical category list', () => {
    expect(Array.isArray(i99dash.CATEGORY_SLUGS)).toBe(true);
    expect(i99dash.CATEGORY_SLUGS.length).toBeGreaterThan(0);
    expect(i99dash.CATEGORY_SLUGS).toContain('media');
  });

  // Subpath exports: the runtime client + admin live at the root,
  // but the dev-server (Node-only) and React bindings (peer-dep
  // gated) live behind subpaths. Asserting the named exports are
  // there protects against an entry getting dropped from
  // tsup.config.ts or the package.json `exports` map.
  it('exposes startDevServer + buildServer + StateStore via /dev-server', () => {
    expect(typeof devServer.startDevServer).toBe('function');
    expect(typeof devServer.buildServer).toBe('function');
    expect(typeof devServer.StateStore).toBe('function');
    expect(typeof devServer.FixtureStore).toBe('function');
  });

  it('exposes MiniAppProvider + hooks via /react', () => {
    expect(typeof react.MiniAppProvider).toBe('function');
    expect(typeof react.useClient).toBe('function');
    expect(typeof react.useMiniAppContext).toBe('function');
    expect(typeof react.useCarStatus).toBe('function');
    expect(typeof react.useCallApi).toBe('function');
  });
});
