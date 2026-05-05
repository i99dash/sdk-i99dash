import { describe, it, expect } from 'vitest';
import {
  VEHICLE_CAPABILITIES,
  CAPABILITY_BITS,
  bitsFromCapabilities,
  capabilitiesFromBits,
  hasAllCapabilities,
  DILINK_FAMILIES,
  SUB_TRIMS,
  ProfileKeySchema,
  VehicleCapabilitiesSnapshotSchema,
  VehicleCapabilityProbeReportSchema,
} from '../vehicle-capabilities.js';
import { MiniAppManifestSchema } from '../manifest.js';

describe('VEHICLE_CAPABILITIES taxonomy', () => {
  it('has unique entries', () => {
    expect(new Set(VEHICLE_CAPABILITIES).size).toBe(VEHICLE_CAPABILITIES.length);
  });

  it('fits in a 31-bit signed-int bitmask', () => {
    expect(VEHICLE_CAPABILITIES.length).toBeLessThanOrEqual(31);
  });

  it('CAPABILITY_BITS matches array order (frozen contract)', () => {
    VEHICLE_CAPABILITIES.forEach((cap, i) => {
      expect(CAPABILITY_BITS[cap]).toBe(i);
    });
  });

  it('locks the first eight bit positions (regression guard)', () => {
    expect(CAPABILITY_BITS['display.read']).toBe(0);
    expect(CAPABILITY_BITS['pkg.read']).toBe(1);
    expect(CAPABILITY_BITS['pkg.launch.ivi']).toBe(2);
    expect(CAPABILITY_BITS['pkg.launch.passenger']).toBe(3);
    expect(CAPABILITY_BITS['pkg.launch.cluster.pixel']).toBe(4);
    expect(CAPABILITY_BITS['pkg.launch.cluster.icons']).toBe(5);
    expect(CAPABILITY_BITS['pkg.launch.dishare']).toBe(6);
    expect(CAPABILITY_BITS['surface.write.ivi']).toBe(7);
  });
});

describe('bitsFromCapabilities / capabilitiesFromBits', () => {
  it('roundtrips a single capability', () => {
    const bits = bitsFromCapabilities(['display.read']);
    expect(bits).toBe(1);
    expect(capabilitiesFromBits(bits)).toEqual(['display.read']);
  });

  it('roundtrips multi-cap deterministically (order = taxonomy order)', () => {
    const bits = bitsFromCapabilities(['pkg.read', 'display.read', 'cursor.write']);
    expect(capabilitiesFromBits(bits)).toEqual(['display.read', 'pkg.read', 'cursor.write']);
  });

  it('silently drops unknown capability strings', () => {
    const bits = bitsFromCapabilities(['display.read', 'made.up' as never]);
    expect(bits).toBe(1);
  });

  it('empty input → 0 bitmask', () => {
    expect(bitsFromCapabilities([])).toBe(0);
    expect(capabilitiesFromBits(0)).toEqual([]);
  });
});

describe('hasAllCapabilities', () => {
  it('true when required is empty', () => {
    expect(hasAllCapabilities(0, 0)).toBe(true);
    expect(hasAllCapabilities(0xff, 0)).toBe(true);
  });

  it('true when vehicle covers required', () => {
    const have = bitsFromCapabilities([
      'display.read',
      'pkg.read',
      'pkg.launch.ivi',
      'pkg.launch.passenger',
    ]);
    const need = bitsFromCapabilities(['display.read', 'pkg.launch.passenger']);
    expect(hasAllCapabilities(have, need)).toBe(true);
  });

  it('false when one required bit is missing', () => {
    const have = bitsFromCapabilities(['display.read']);
    const need = bitsFromCapabilities(['display.read', 'pkg.launch.cluster.pixel']);
    expect(hasAllCapabilities(have, need)).toBe(false);
  });
});

describe('ProfileKeySchema', () => {
  it('parses a precise four-tuple', () => {
    const pk = ProfileKeySchema.parse({
      dilinkFamily: 'di5.0',
      variantId: 'l5',
      subTrim: 'flagship',
      fingerprint: 'BYD/l5/l5:12/Q0311/202501132140:user/release-keys',
    });
    expect(pk.dilinkFamily).toBe('di5.0');
    expect(pk.subTrim).toBe('flagship');
  });

  it('defaults the three optional slots to empty strings (aggregate row)', () => {
    const pk = ProfileKeySchema.parse({ dilinkFamily: 'di5.1' });
    expect(pk.variantId).toBe('');
    expect(pk.subTrim).toBe('');
    expect(pk.fingerprint).toBe('');
  });

  it('rejects unknown dilinkFamily', () => {
    expect(() => ProfileKeySchema.parse({ dilinkFamily: 'dishwasher' as never })).toThrow();
  });

  it('rejects unknown subTrim but allows empty', () => {
    expect(() =>
      ProfileKeySchema.parse({
        dilinkFamily: 'di5.0',
        variantId: 'l5',
        subTrim: 'ultra-mega' as never,
      }),
    ).toThrow();
    // Empty is the trim-aggregate slot — must stay valid.
    expect(() =>
      ProfileKeySchema.parse({
        dilinkFamily: 'di5.0',
        variantId: 'l5',
        subTrim: '',
      }),
    ).not.toThrow();
  });
});

describe('VehicleCapabilitiesSnapshotSchema', () => {
  const baseSnapshot = {
    dilinkFamily: 'di5.1',
    variantId: 'l8',
    subTrim: 'base',
    fingerprint: 'BYD/leopard8/leopard8:13/Q0414/202512071900:user/release-keys',
    capabilities: ['display.read', 'pkg.read'],
    capabilityBits: 0b11,
    updatedAt: '2026-05-04T12:00:00Z',
    probeCount: 17,
  };

  it('parses a precise snapshot (no fallback)', () => {
    const parsed = VehicleCapabilitiesSnapshotSchema.parse(baseSnapshot);
    expect(parsed.capabilityBits).toBe(0b11);
    expect(parsed.isFallback).toBe(false);
    expect(parsed.fallbackReason).toBeNull();
  });

  it('parses a tier-3 trim-aggregate snapshot with isFallback=true', () => {
    const parsed = VehicleCapabilitiesSnapshotSchema.parse({
      ...baseSnapshot,
      // Trim aggregate — sub-trim + fingerprint stripped by the
      // server-side resolver.
      subTrim: '',
      fingerprint: '',
      isFallback: true,
      fallbackReason: 'unknown_sub_trim',
    });
    expect(parsed.subTrim).toBe('');
    expect(parsed.isFallback).toBe(true);
    expect(parsed.fallbackReason).toBe('unknown_sub_trim');
  });

  it('rejects unknown fallbackReason strings', () => {
    expect(() =>
      VehicleCapabilitiesSnapshotSchema.parse({
        ...baseSnapshot,
        isFallback: true,
        fallbackReason: 'unknown_planet' as never,
      }),
    ).toThrow();
  });

  it('rejects unknown capability strings', () => {
    expect(() =>
      VehicleCapabilitiesSnapshotSchema.parse({
        ...baseSnapshot,
        capabilities: ['display.read', 'cluster.maglev' as never],
      }),
    ).toThrow();
  });

  it('rejects negative probeCount / capabilityBits', () => {
    expect(() =>
      VehicleCapabilitiesSnapshotSchema.parse({
        ...baseSnapshot,
        probeCount: -1,
      }),
    ).toThrow();
    expect(() =>
      VehicleCapabilitiesSnapshotSchema.parse({
        ...baseSnapshot,
        capabilityBits: -1,
      }),
    ).toThrow();
  });
});

describe('VehicleCapabilityProbeReportSchema', () => {
  it('accepts a valid probe report nesting ProfileKey', () => {
    const parsed = VehicleCapabilityProbeReportSchema.parse({
      profileKey: {
        dilinkFamily: 'di5.0',
        variantId: 'l5',
        subTrim: 'navigator',
        fingerprint: 'BYD/leopard5/...',
      },
      confirmed: ['display.read', 'pkg.launch.dishare'],
      probeVersion: '1',
    });
    expect(parsed.profileKey.subTrim).toBe('navigator');
    expect(parsed.confirmed).toContain('pkg.launch.dishare');
  });

  it('rejects probe reports with no profileKey', () => {
    expect(() =>
      VehicleCapabilityProbeReportSchema.parse({
        // No profileKey field — old v1 shape.
        variantId: 'l5',
        fingerprint: 'fp',
        confirmed: [],
        probeVersion: '1',
      } as never),
    ).toThrow();
  });

  it('rejects unknown capability in confirmed list', () => {
    expect(() =>
      VehicleCapabilityProbeReportSchema.parse({
        profileKey: { dilinkFamily: 'di5.0' },
        confirmed: ['display.read', 'fly.car' as never],
        probeVersion: '1',
      }),
    ).toThrow();
  });
});

describe('DILINK_FAMILIES + SUB_TRIMS taxonomies', () => {
  it('DILINK_FAMILIES covers the three documented values', () => {
    expect(DILINK_FAMILIES).toContain('di5.0');
    expect(DILINK_FAMILIES).toContain('di5.1');
    expect(DILINK_FAMILIES).toContain('unknown');
  });

  it('SUB_TRIMS covers the user-confirmed L5 family + base', () => {
    for (const expected of ['flagship', 'navigator', 'ultra', 'lidar', 'base'] as const) {
      expect(SUB_TRIMS).toContain(expected);
    }
  });
});

describe('MiniAppManifestSchema with requiredCapabilities', () => {
  const valid = {
    id: 'dash_wallpaper',
    name: { en: 'Dash Wallpaper' },
    icon: './icon.svg',
    url: 'https://miniapps.i99dash.app/dash-wallpaper/',
    version: '0.2.0',
    category: 'lifestyle',
  };

  it('defaults requiredCapabilities to empty array', () => {
    const parsed = MiniAppManifestSchema.parse(valid);
    expect(parsed.requiredCapabilities).toEqual([]);
  });

  it('accepts a manifest with requiredCapabilities', () => {
    const parsed = MiniAppManifestSchema.parse({
      ...valid,
      requiredCapabilities: ['display.read', 'surface.write.cluster'],
    });
    expect(parsed.requiredCapabilities).toEqual(['display.read', 'surface.write.cluster']);
  });

  it('rejects unknown capabilities (closed enum)', () => {
    expect(() =>
      MiniAppManifestSchema.parse({
        ...valid,
        requiredCapabilities: ['display.read', 'fly.ivi' as never],
      }),
    ).toThrow();
  });
});
