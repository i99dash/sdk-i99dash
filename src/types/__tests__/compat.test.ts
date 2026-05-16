import { describe, it, expect } from 'vitest';

import { MiniAppManifestSchema } from '../manifest.js';
import {
  evaluateCompatibility,
  isCompatible,
  CompatTargetSchema,
  type CompatTarget,
} from '../compat.js';
import { bitsFromCapabilities } from '../vehicle-capabilities.js';

// Realistic targets, modelled on the verified fleet:
//   * Di5.0 (L5 / Song Plus): old WebView, BYD container → no usable
//     cluster, bridge v2.
//   * Di5.1 (L8 / L5L): modern WebView, XDJA container → cluster.
//   * unknown: dev runner / non-BYD — nothing proven.
const DI50: CompatTarget = {
  dilinkFamily: 'di5.0',
  vehicleCapabilityBits: bitsFromCapabilities([
    'display.read',
    'pkg.read',
    'pkg.launch.ivi',
    'pkg.launch.passenger',
    'surface.write.ivi',
    'surface.write.passenger',
  ]),
  bridgeVersion: '2.0.0',
  modernWebview: false,
};
const DI51: CompatTarget = {
  dilinkFamily: 'di5.1',
  vehicleCapabilityBits: bitsFromCapabilities([
    'display.read',
    'pkg.read',
    'pkg.launch.ivi',
    'pkg.launch.passenger',
    'pkg.launch.cluster.pixel',
    'surface.write.ivi',
    'surface.write.passenger',
    'surface.write.cluster',
  ]),
  bridgeVersion: '2.0.0',
  modernWebview: true,
};
const UNKNOWN: CompatTarget = { dilinkFamily: 'unknown' };

const mkApp = (requires?: unknown) =>
  MiniAppManifestSchema.parse({
    id: 'app',
    name: { en: 'App' },
    icon: './a.png',
    url: 'https://miniapps.i99dash.app/a/',
    version: '1.0.0',
    category: 'vehicle',
    ...(requires ? { requires } : {}),
  });

describe('evaluateCompatibility', () => {
  it('no requires → runs on every car (weather-ahead pattern)', () => {
    const app = mkApp();
    for (const t of [DI50, DI51, UNKNOWN]) {
      expect(evaluateCompatibility(app, t).ok).toBe(true);
    }
  });

  it('cluster app: hidden on Di5.0, shown on Di5.1', () => {
    const app = mkApp({ vehicleCapabilities: ['surface.write.cluster'] });
    const di50 = evaluateCompatibility(app, DI50);
    expect(di50.ok).toBe(false);
    expect(di50.reasons[0]?.code).toBe('missing_vehicle_capabilities');
    expect(di50.reasons[0]?.detail).toContain('surface.write.cluster');
    expect(evaluateCompatibility(app, DI51).ok).toBe(true);
    expect(evaluateCompatibility(app, UNKNOWN).ok).toBe(false);
  });

  it('dilink allow-list gates by generation; unknown fails closed', () => {
    const app = mkApp({ dilink: ['di5.1'] });
    expect(isCompatible(app, DI51)).toBe(true);
    expect(isCompatible(app, DI50)).toBe(false);
    expect(isCompatible(app, UNKNOWN)).toBe(false);
    expect(evaluateCompatibility(app, DI50).reasons[0]?.code).toBe('dilink_unsupported');
  });

  it('modernWebview: fails closed when host fact is false or absent', () => {
    const app = mkApp({ modernWebview: true });
    expect(isCompatible(app, DI51)).toBe(true);
    expect(isCompatible(app, DI50)).toBe(false); // modernWebview:false
    expect(isCompatible(app, { dilinkFamily: 'di5.1' })).toBe(false); // absent → closed
    expect(evaluateCompatibility(app, DI50).reasons[0]?.code).toBe('webview_too_old');
  });

  it('minBridge: numeric semver-ish compare, missing fails closed', () => {
    const app = mkApp({ minBridge: '2.0.0' });
    expect(isCompatible(app, { dilinkFamily: 'di5.1', bridgeVersion: '2.0.0' })).toBe(true);
    expect(isCompatible(app, { dilinkFamily: 'di5.1', bridgeVersion: '2.1.0' })).toBe(true);
    expect(isCompatible(app, { dilinkFamily: 'di5.1', bridgeVersion: '2.0' })).toBe(true);
    expect(isCompatible(app, { dilinkFamily: 'di5.1', bridgeVersion: '1.6.0' })).toBe(false);
    expect(isCompatible(app, { dilinkFamily: 'di5.1' })).toBe(false); // absent → closed
    expect(
      evaluateCompatibility(app, { dilinkFamily: 'di5.1', bridgeVersion: '1.6.0' }).reasons[0]
        ?.code,
    ).toBe('bridge_too_old');
  });

  it('forward-compat: a newer requires.schema fails closed everywhere', () => {
    const app = mkApp({ schema: 999, dilink: ['di5.1'] });
    const r = evaluateCompatibility(app, DI51); // would otherwise pass
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0]?.code).toBe('unsupported_requires_schema');
  });

  it('aggregates every failed gate, not just the first', () => {
    const app = mkApp({
      dilink: ['di5.1'],
      vehicleCapabilities: ['surface.write.cluster'],
      modernWebview: true,
      minBridge: '3.0.0',
    });
    const r = evaluateCompatibility(app, DI50);
    expect(r.ok).toBe(false);
    const codes = r.reasons.map((x) => x.code).sort();
    expect(codes).toEqual(
      [
        'bridge_too_old',
        'dilink_unsupported',
        'missing_vehicle_capabilities',
        'webview_too_old',
      ].sort(),
    );
  });

  it('accepts the readable capability list when bits are absent', () => {
    const app = mkApp({ vehicleCapabilities: ['surface.write.cluster'] });
    const listTarget: CompatTarget = {
      dilinkFamily: 'di5.1',
      vehicleCapabilities: ['surface.write.cluster', 'display.read'],
    };
    expect(isCompatible(app, listTarget)).toBe(true);
  });

  it('CompatTargetSchema is strict (rejects unknown keys)', () => {
    expect(() => CompatTargetSchema.parse({ dilinkFamily: 'di5.1', bogus: true })).toThrow();
  });
});
