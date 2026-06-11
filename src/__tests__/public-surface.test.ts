/// Snapshot of the public surface — every symbol downstream consumers
/// depend on must remain reachable from `i99dash`'s top-level entry.
/// Fail loudly if a future commit drops one on the floor.
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
  // ── wire schemas + types ────────────────────────────────────────
  'MiniAppContextSchema',
  'MiniAppManifestSchema',
  'LocaleMapSchema',
  'CATEGORY_SLUGS',
  'HostCapabilitiesSchema',
  'CarAssetResponseSchema',
  'CarCatalogEntrySchema',
  'CarCatalogListSchema',
  'CarCommandResponseSchema',
  'CarConnectionPushEnvelopeSchema',
  'CarConnectionStateSchema',
  'CarIdentitySchema',
  'CarReadResponseSchema',
  'CarSignalEventSchema',
  'CarSignalPushEnvelopeSchema',
  'CarSubscribeResponseSchema',

  // ── manifest compatibility gate ─────────────────────────────────
  'MiniAppRequiresSchema',
  'REQUIRES_SCHEMA',
  'CompatTargetSchema',
  'COMPAT_REASON_CODES',
  'evaluateCompatibility',
  'isCompatible',

  // ── theme marketplace ───────────────────────────────────────────
  'THEME_SCHEMA',
  'THEME_CATEGORY_SLUGS',
  'ThemeColorsSchema',
  'ThemeWallpaperSchema',
  'ThemeTypographySchema',
  'ThemeShapeSchema',
  'ThemeGaugeSchema',
  'ThemeSpecSchema',
  'ThemeManifestSchema',

  // ── runtime client ──────────────────────────────────────────────
  'MiniAppClient',
  'HostBridge',
  'HOST_GLOBAL',
  'HOST_EVENTS_GLOBAL',
  'LEGACY_HOST_GLOBAL',
  'ensureHostEvents',
  'isCapabilitiesBridge',
  'isCarBridge',
  'isFamilyBridge',
  'resolveHostApi',
  'CAR_MAX_NAMES',
  'CarController',
  'BridgeTimeoutError',
  'BridgeTransportError',
  'InvalidResponseError',
  'NotInsideHostError',
  'SDKError',
  'PermissionDeniedAggregator',
  'createClientOrSSR',
  'withTimeout',

  // ── admin client ────────────────────────────────────────────────
  'AdminClient',
  'UnknownTemplateError',
  'FakeAdminBridge',
  'HostAdminBridge',
  'snapshotFromList',
] as const;

describe('public surface', () => {
  it('exports every symbol downstream consumers depend on', () => {
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
  });

  it('exposes THEME_CATEGORY_SLUGS as the canonical theme category list', () => {
    expect(Array.isArray(i99dash.THEME_CATEGORY_SLUGS)).toBe(true);
    expect(i99dash.THEME_CATEGORY_SLUGS.length).toBeGreaterThan(0);
    // Distinct from the mini-app list (themes have their own taxonomy).
    expect(i99dash.THEME_CATEGORY_SLUGS).toContain('neon');
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
  });

  it('exposes MiniAppProvider + hooks via /react', () => {
    expect(typeof react.MiniAppProvider).toBe('function');
    expect(typeof react.useClient).toBe('function');
    expect(typeof react.useMiniAppContext).toBe('function');
    expect(typeof react.useCarSignals).toBe('function');
    expect(typeof react.useCarConnection).toBe('function');
  });
});
