import { describe, it, expect } from 'vitest';
import { CATEGORY_SLUGS, MiniAppManifestSchema } from '../manifest.js';

const valid = {
  id: 'fuel_prices',
  name: { en: 'Fuel Prices', ar: 'أسعار الوقود' },
  icon: './assets/icon.png',
  url: 'https://miniapps.i99dash.app/fuel-prices/',
  version: '1.0.0',
  category: 'services',
  safeWhileDriving: true,
};

describe('MiniAppManifestSchema', () => {
  it('accepts a canonical manifest', () => {
    const parsed = MiniAppManifestSchema.parse(valid);
    expect(parsed.id).toBe('fuel_prices');
    expect(parsed.safeWhileDriving).toBe(true);
  });

  it('defaults safeWhileDriving to false (conservative)', () => {
    const { safeWhileDriving: _, ...rest } = valid;
    const parsed = MiniAppManifestSchema.parse(rest);
    expect(parsed.safeWhileDriving).toBe(false);
  });

  it('rejects id with uppercase letters', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, id: 'Fuel_Prices' })).toThrow();
  });

  it('rejects id starting with a separator', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, id: '-fuel' })).toThrow();
    expect(() => MiniAppManifestSchema.parse({ ...valid, id: '_fuel' })).toThrow();
  });

  it('rejects http:// urls (https only)', () => {
    expect(() =>
      MiniAppManifestSchema.parse({
        ...valid,
        url: 'http://miniapps.i99dash.app/fuel/',
      }),
    ).toThrow();
  });

  it('rejects empty name map', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, name: {} })).toThrow();
  });

  it('rejects 3-letter locale keys', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, name: { eng: 'Fuel Prices' } })).toThrow();
  });

  it('allows description to be omitted', () => {
    const parsed = MiniAppManifestSchema.parse(valid);
    expect(parsed.description).toBeUndefined();
  });

  describe('requiredEntitlement (tiering)', () => {
    it('omits to undefined → free app', () => {
      const parsed = MiniAppManifestSchema.parse(valid);
      expect(parsed.requiredEntitlement).toBeUndefined();
    });

    it('PRESERVES the key (not stripped) so it rides publish into manifest_json', () => {
      const parsed = MiniAppManifestSchema.parse({
        ...valid,
        requiredEntitlement: 'apps.premium',
      });
      expect(parsed.requiredEntitlement).toBe('apps.premium');
    });

    it('rejects an empty entitlement key', () => {
      expect(() => MiniAppManifestSchema.parse({ ...valid, requiredEntitlement: '' })).toThrow();
    });
  });

  describe('icon path', () => {
    it('rejects absolute http URL (was the old shape)', () => {
      expect(() =>
        MiniAppManifestSchema.parse({ ...valid, icon: 'https://x.com/icon.png' }),
      ).toThrow(/icon must be a relative path/);
    });

    it('rejects parent-directory traversal', () => {
      expect(() => MiniAppManifestSchema.parse({ ...valid, icon: './../etc/passwd' })).toThrow(
        /traverse parent directories/,
      );
    });

    it('rejects unsupported extension', () => {
      expect(() => MiniAppManifestSchema.parse({ ...valid, icon: './assets/icon.gif' })).toThrow(
        /extension/,
      );
    });

    it('accepts SVG', () => {
      const parsed = MiniAppManifestSchema.parse({ ...valid, icon: './assets/icon.svg' });
      expect(parsed.icon).toBe('./assets/icon.svg');
    });
  });

  describe('coverImage + screenshots', () => {
    it('accepts a JPEG cover and a PNG screenshot', () => {
      const parsed = MiniAppManifestSchema.parse({
        ...valid,
        coverImage: './assets/cover.jpg',
        screenshots: ['./shots/01.png', './shots/02.webp'],
      });
      expect(parsed.coverImage).toBe('./assets/cover.jpg');
      expect(parsed.screenshots).toHaveLength(2);
    });

    it('rejects more than 8 screenshots', () => {
      const tooMany = Array.from({ length: 9 }, (_, i) => `./shots/${i}.png`);
      expect(() => MiniAppManifestSchema.parse({ ...valid, screenshots: tooMany })).toThrow();
    });

    it('accepts SVG screenshots and cover (vector mock-ups)', () => {
      // The host's MiniAppRemoteImage routes SVG via flutter_svg, so
      // publishers can ship a vector cover/screenshot instead of
      // hand-rolling a raster bitmap. Manifest must allow it.
      const parsed = MiniAppManifestSchema.parse({
        ...valid,
        coverImage: './assets/cover.svg',
        screenshots: ['./shots/hero.svg'],
      });
      expect(parsed.coverImage).toBe('./assets/cover.svg');
      expect(parsed.screenshots).toEqual(['./shots/hero.svg']);
    });
  });

  describe('category enum', () => {
    it('rejects unknown category', () => {
      expect(() => MiniAppManifestSchema.parse({ ...valid, category: 'fashion' })).toThrow(
        /Invalid enum value/,
      );
    });

    it('accepts every canonical slug', () => {
      for (const slug of CATEGORY_SLUGS) {
        expect(() => MiniAppManifestSchema.parse({ ...valid, category: slug })).not.toThrow();
      }
    });
  });

  describe('tags', () => {
    it('accepts up to 8 lowercase-hyphen tags', () => {
      const parsed = MiniAppManifestSchema.parse({
        ...valid,
        tags: ['offline', 'lossless', 'kid-safe'],
      });
      expect(parsed.tags).toEqual(['offline', 'lossless', 'kid-safe']);
    });

    it('rejects uppercase tags', () => {
      expect(() => MiniAppManifestSchema.parse({ ...valid, tags: ['Music'] })).toThrow();
    });

    it('rejects more than 8 tags', () => {
      const tooMany = Array.from({ length: 9 }, (_, i) => `t${i}`);
      expect(() => MiniAppManifestSchema.parse({ ...valid, tags: tooMany })).toThrow();
    });
  });
});
