import { describe, expect, it } from 'vitest';
import { canonicalizeMiniAppOrigin, ORIGIN_FIXTURES } from '../origin.js';
import { MiniAppManifestSchema } from '../manifest.js';

describe('canonicalizeMiniAppOrigin — shared cross-repo grammar', () => {
  for (const { input, canonical } of ORIGIN_FIXTURES.valid) {
    it(`accepts + canonicalizes ${JSON.stringify(input)} -> ${canonical}`, () => {
      expect(canonicalizeMiniAppOrigin(input)).toBe(canonical);
    });
  }

  for (const bad of ORIGIN_FIXTURES.invalid) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(canonicalizeMiniAppOrigin(bad)).toBeNull();
    });
  }

  it('strips the default :443 but keeps non-default ports', () => {
    expect(canonicalizeMiniAppOrigin('https://x.com:443')).toBe('https://x.com');
    expect(canonicalizeMiniAppOrigin('https://x.com:8443')).toBe('https://x.com:8443');
  });
});

const base = {
  id: 'demo-app',
  name: { en: 'Demo' },
  icon: './assets/icon.svg',
  url: 'https://miniapps.i99dash.app/demo/',
  version: '0.1.0',
  category: 'lifestyle',
};

describe('MiniAppManifestSchema.network', () => {
  it('is optional (absent manifest parses)', () => {
    const r = MiniAppManifestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.network).toBeUndefined();
  });

  it('accepts + canonicalizes + dedupes declared origins', () => {
    const r = MiniAppManifestSchema.safeParse({
      ...base,
      network: [
        'https://api.aladhan.com',
        'https://API.Aladhan.com/',
        'https://cdn.example.com:8443',
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.network).toEqual(['https://api.aladhan.com', 'https://cdn.example.com:8443']);
    }
  });

  it('rejects a manifest with any invalid origin', () => {
    for (const bad of [
      'http://api.example.com',
      'https://example.com/v1',
      'https://10.0.0.1',
      'https://localhost',
    ]) {
      const r = MiniAppManifestSchema.safeParse({ ...base, network: [bad] });
      expect(r.success, `expected reject for ${bad}`).toBe(false);
    }
  });

  it('rejects more than 10 origins', () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://h${i}.example.com`);
    const r = MiniAppManifestSchema.safeParse({ ...base, network: many });
    expect(r.success).toBe(false);
  });

  it('accepts an empty array as "no external egress"', () => {
    const r = MiniAppManifestSchema.safeParse({ ...base, network: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.network).toEqual([]);
  });
});
