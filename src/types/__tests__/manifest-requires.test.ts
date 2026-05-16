import { describe, it, expect } from 'vitest';

import { MiniAppManifestSchema, MiniAppRequiresSchema, REQUIRES_SCHEMA } from '../manifest.js';

const base = {
  id: 'gauge_cluster',
  name: { en: 'Gauge Cluster' },
  icon: './assets/icon.png',
  url: 'https://miniapps.i99dash.app/gauge-cluster/',
  version: '1.0.0',
  category: 'vehicle',
};

describe('MiniAppManifest — requires / permissions / privileged', () => {
  it('accepts a manifest with no requires (runs anywhere) and defaults privileged=false', () => {
    const m = MiniAppManifestSchema.parse(base);
    expect(m.requires).toBeUndefined();
    expect(m.privileged).toBe(false);
  });

  it('accepts a full requires block and defaults requires.schema', () => {
    const m = MiniAppManifestSchema.parse({
      ...base,
      requires: {
        dilink: ['di5.1'],
        vehicleCapabilities: ['surface.write.cluster'],
        modernWebview: true,
        minBridge: '2.0.0',
      },
      permissions: ['location.read', 'car.status'],
      privileged: true,
    });
    expect(m.requires?.schema).toBe(REQUIRES_SCHEMA);
    expect(m.requires?.dilink).toEqual(['di5.1']);
    expect(m.requires?.vehicleCapabilities).toEqual(['surface.write.cluster']);
    expect(m.permissions).toEqual(['location.read', 'car.status']);
    expect(m.privileged).toBe(true);
  });

  it('rejects an unknown DiLink family', () => {
    expect(() =>
      MiniAppManifestSchema.parse({ ...base, requires: { dilink: ['di9.9'] } }),
    ).toThrow();
  });

  it('rejects an unknown vehicle capability', () => {
    expect(() =>
      MiniAppManifestSchema.parse({
        ...base,
        requires: { vehicleCapabilities: ['surface.write.holodeck'] },
      }),
    ).toThrow();
  });

  it('rejects an empty requires.dilink array (nonempty)', () => {
    expect(() => MiniAppManifestSchema.parse({ ...base, requires: { dilink: [] } })).toThrow();
  });

  it('keeps a forward-compat requires.* key (passthrough, no throw)', () => {
    // A newer manifest carrying a key this SDK predates must still
    // PARSE — the fail-closed schema check handles it at evaluation.
    const r = MiniAppRequiresSchema.parse({
      schema: 2,
      dilink: ['di5.1'],
      futureGate: { foo: 'bar' },
    }) as Record<string, unknown>;
    expect(r.schema).toBe(2);
    expect(r.futureGate).toEqual({ foo: 'bar' });
  });

  it('permissions is an open string list (no closed enum)', () => {
    const m = MiniAppManifestSchema.parse({
      ...base,
      permissions: ['some.future.scope'],
    });
    expect(m.permissions).toEqual(['some.future.scope']);
  });
});
