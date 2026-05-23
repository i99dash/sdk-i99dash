import { describe, it, expect } from 'vitest';
import {
  THEME_SCHEMA,
  THEME_CATEGORY_SLUGS,
  ThemeManifestSchema,
  ThemeSpecSchema,
} from '../theme-manifest.js';
import { evaluateCompatibility, isCompatible } from '../compat.js';

/// The canonical §2/§3 contract example, used as the happy-path fixture.
const validSpec = {
  schema: 1,
  brightness: 'dark' as const,
  colors: {
    background: '#07070D',
    surfaceLow: '#0F1018',
    surfaceContainer: '#13141C',
    surfaceHigh: '#1A1C26',
    outline: '#4B5064',
    outlineVariant: '#24262F',
    onSurface: '#F3F4F8',
    onSurfaceVariant: '#8A90A4',
    accent: '#22D3A8',
    secondary: '#5B8CFF',
    error: '#E76F51',
    warning: '#F4A261',
    neutral: '#6A7088',
  },
};

const valid = {
  id: 'midnight-neon',
  name: { en: 'Midnight Neon', ar: 'نيون منتصف الليل' },
  icon: './icon.png',
  version: '1.0.0',
  minHostVersion: '3.1.0',
  category: 'neon',
  tags: ['minimal', 'high-contrast'],
  spec: validSpec,
};

describe('THEME_SCHEMA', () => {
  it('is version 1', () => {
    expect(THEME_SCHEMA).toBe(1);
  });
});

describe('THEME_CATEGORY_SLUGS', () => {
  it('is the exact contract §1 closed enum, in order', () => {
    expect(THEME_CATEGORY_SLUGS).toEqual([
      'dark',
      'light',
      'minimal',
      'vibrant',
      'classic',
      'seasonal',
      'monochrome',
      'neon',
      'nature',
      'brand',
      'other',
    ]);
  });
});

describe('ThemeSpecSchema', () => {
  it('accepts the canonical dark spec', () => {
    const parsed = ThemeSpecSchema.parse(validSpec);
    expect(parsed.brightness).toBe('dark');
    expect(parsed.colors.accent).toBe('#22D3A8');
  });

  it('accepts 8-digit AARRGGBB hex', () => {
    const parsed = ThemeSpecSchema.parse({
      ...validSpec,
      colors: { ...validSpec.colors, background: '#CC07070D' },
    });
    expect(parsed.colors.background).toBe('#CC07070D');
  });

  it('defaults schema to THEME_SCHEMA when omitted', () => {
    const { schema: _omit, ...rest } = validSpec;
    const parsed = ThemeSpecSchema.parse(rest);
    expect(parsed.schema).toBe(THEME_SCHEMA);
  });

  it('makes warning + neutral optional', () => {
    const { warning: _w, neutral: _n, ...colors } = validSpec.colors;
    const parsed = ThemeSpecSchema.parse({ ...validSpec, colors });
    expect(parsed.colors.warning).toBeUndefined();
    expect(parsed.colors.neutral).toBeUndefined();
  });

  it('rejects a malformed hex value', () => {
    expect(() =>
      ThemeSpecSchema.parse({
        ...validSpec,
        colors: { ...validSpec.colors, accent: '22D3A8' }, // missing #
      }),
    ).toThrow(/hex color/);
    expect(() =>
      ThemeSpecSchema.parse({
        ...validSpec,
        colors: { ...validSpec.colors, accent: '#22D3A' }, // 5 digits
      }),
    ).toThrow(/hex color/);
    expect(() =>
      ThemeSpecSchema.parse({
        ...validSpec,
        colors: { ...validSpec.colors, accent: '#GGGGGG' }, // non-hex
      }),
    ).toThrow(/hex color/);
  });

  it('rejects a missing required surface key', () => {
    const { surfaceHigh: _drop, ...colors } = validSpec.colors;
    expect(() => ThemeSpecSchema.parse({ ...validSpec, colors })).toThrow();
  });

  it('rejects a missing required brand key (accent)', () => {
    const { accent: _drop, ...colors } = validSpec.colors;
    expect(() => ThemeSpecSchema.parse({ ...validSpec, colors })).toThrow();
  });

  it('rejects an unknown color key (strict — typo guard)', () => {
    expect(() =>
      ThemeSpecSchema.parse({
        ...validSpec,
        colors: { ...validSpec.colors, surface: '#101010' },
      }),
    ).toThrow();
  });

  it('rejects an invalid brightness', () => {
    expect(() => ThemeSpecSchema.parse({ ...validSpec, brightness: 'twilight' })).toThrow();
  });

  it('applies shape defaults that preserve today look', () => {
    const parsed = ThemeSpecSchema.parse({ ...validSpec, shape: {} });
    expect(parsed.shape).toEqual({ cardRadius: 24, buttonRadius: 14, inputRadius: 14 });
  });

  it('rejects a shape radius out of the 0..48 range', () => {
    expect(() => ThemeSpecSchema.parse({ ...validSpec, shape: { cardRadius: 64 } })).toThrow();
  });

  it('accepts an optional wallpaper block with relative paths', () => {
    const parsed = ThemeSpecSchema.parse({
      ...validSpec,
      wallpaper: { home: './wallpaper/home.png', cluster: './wallpaper/cluster.png' },
    });
    expect(parsed.wallpaper?.home).toBe('./wallpaper/home.png');
  });

  it('rejects a wallpaper path that traverses parents', () => {
    expect(() =>
      ThemeSpecSchema.parse({ ...validSpec, wallpaper: { home: './../secrets/x.png' } }),
    ).toThrow(/traverse parent directories/);
  });
});

describe('ThemeManifestSchema', () => {
  it('accepts the canonical manifest', () => {
    const parsed = ThemeManifestSchema.parse(valid);
    expect(parsed.id).toBe('midnight-neon');
    expect(parsed.spec.brightness).toBe('dark');
  });

  it('requires the inline spec', () => {
    const { spec: _drop, ...rest } = valid;
    expect(() => ThemeManifestSchema.parse(rest)).toThrow();
  });

  it('rejects id with uppercase letters', () => {
    expect(() => ThemeManifestSchema.parse({ ...valid, id: 'Midnight-Neon' })).toThrow();
  });

  it('rejects id starting with a separator', () => {
    expect(() => ThemeManifestSchema.parse({ ...valid, id: '-neon' })).toThrow();
    expect(() => ThemeManifestSchema.parse({ ...valid, id: '_neon' })).toThrow();
  });

  it('rejects empty name map', () => {
    expect(() => ThemeManifestSchema.parse({ ...valid, name: {} })).toThrow();
  });

  it('rejects an unknown category', () => {
    expect(() => ThemeManifestSchema.parse({ ...valid, category: 'fashion' })).toThrow(
      /Invalid enum value/,
    );
  });

  it('accepts every canonical theme slug', () => {
    for (const slug of THEME_CATEGORY_SLUGS) {
      expect(() => ThemeManifestSchema.parse({ ...valid, category: slug })).not.toThrow();
    }
  });

  describe('icon path', () => {
    it('rejects an absolute http URL (must be bundle-relative)', () => {
      expect(() => ThemeManifestSchema.parse({ ...valid, icon: 'https://x.com/icon.png' })).toThrow(
        /icon must be a relative path/,
      );
    });

    it('rejects parent-directory traversal', () => {
      expect(() => ThemeManifestSchema.parse({ ...valid, icon: './../etc/passwd' })).toThrow(
        /traverse parent directories/,
      );
    });

    it('rejects an unsupported extension (icon is png/svg only)', () => {
      expect(() => ThemeManifestSchema.parse({ ...valid, icon: './icon.gif' })).toThrow(
        /extension/,
      );
    });

    it('accepts SVG + cover + screenshots', () => {
      const parsed = ThemeManifestSchema.parse({
        ...valid,
        icon: './icon.svg',
        coverImage: './cover.jpg',
        screenshots: ['./shots/1.png', './shots/2.webp'],
      });
      expect(parsed.icon).toBe('./icon.svg');
      expect(parsed.screenshots).toHaveLength(2);
    });

    it('rejects more than 8 screenshots', () => {
      const tooMany = Array.from({ length: 9 }, (_, i) => `./shots/${i}.png`);
      expect(() => ThemeManifestSchema.parse({ ...valid, screenshots: tooMany })).toThrow();
    });
  });

  describe('requires (reused mini-app compat block)', () => {
    it('is optional', () => {
      const parsed = ThemeManifestSchema.parse(valid);
      expect(parsed.requires).toBeUndefined();
    });

    it('round-trips through evaluateCompatibility unchanged', () => {
      const themed = ThemeManifestSchema.parse({
        ...valid,
        requires: { schema: 1, dilink: ['di5.1'] },
      });
      // Reuse the SAME gate as mini-apps — a Di5.0 car is incompatible.
      const di50 = evaluateCompatibility(themed, { dilinkFamily: 'di5.0' });
      expect(di50.ok).toBe(false);
      expect(di50.reasons[0]?.code).toBe('dilink_unsupported');

      const di51 = evaluateCompatibility(themed, { dilinkFamily: 'di5.1' });
      expect(di51.ok).toBe(true);
      expect(isCompatible(themed, { dilinkFamily: 'di5.1' })).toBe(true);
    });

    it('fails closed on a newer requires.schema', () => {
      const themed = ThemeManifestSchema.parse({
        ...valid,
        requires: { schema: 99 },
      });
      const res = evaluateCompatibility(themed, { dilinkFamily: 'di5.1' });
      expect(res.ok).toBe(false);
      expect(res.reasons[0]?.code).toBe('unsupported_requires_schema');
    });
  });
});
