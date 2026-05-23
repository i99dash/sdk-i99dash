import { z } from 'zod';
import slugsJson from './theme-category-slugs.json' with { type: 'json' };
import {
  LocaleMapSchema,
  MiniAppRequiresSchema,
  assetPath,
  ICON_EXT,
  PHOTO_EXT,
} from './manifest.js';

/// Theme schema version. Bumped whenever a NEW required field is added
/// to [ThemeManifestSchema] / [ThemeSpecSchema]. The catalog stores it
/// on every row; an older host parsing a newer `spec.schema` falls back
/// to the built-in default theme rather than rendering a half-understood
/// palette (the car maps an unknown schema to "use today's look").
///
/// This is the THEME document version — distinct from
/// `REQUIRES_SCHEMA`, which versions the reused mini-app compat block.
export const THEME_SCHEMA = 1;

/// Canonical theme category slugs. The same JSON file is vendored into
/// backend-i99dash; a CI drift check (`scripts/check-theme-category-drift.mjs`)
/// fails the PR if the two copies diverge. Renaming or removing a slug
/// post-release requires a data migration — additions are SDK + backend
/// in lockstep, exactly like the mini-app `CATEGORY_SLUGS`.
export const THEME_CATEGORY_SLUGS = slugsJson as readonly string[];

/// Hex color: `#RRGGBB` or `#AARRGGBB`. Matches the car-side parser in
/// `app_theme.dart` (Flutter `Color` accepts an 8-digit ARGB or a
/// 6-digit RGB) and the backend Pydantic mirror. Case-insensitive.
const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const hexColor = (label: string) =>
  z.string().regex(HEX_COLOR, `${label} must be a hex color #RRGGBB or #AARRGGBB`);

/// Wallpaper-image asset paths. Same bundle-relative rules as `icon`,
/// but the raster/photo extension set (PNG / JPEG / WebP / SVG) — a
/// wallpaper is a full-bleed background, not a tile glyph.
const wallpaperPath = (label: string) => assetPath(PHOTO_EXT, label);

/// `ThemeSpec.colors` — the design tokens the car consumes. The 8
/// surface keys map 1:1 onto the car's `_Palette` (`app_theme.dart`);
/// the brand/semantic keys map onto `AppColors` / Material
/// `ColorScheme`. Surfaces + accent/secondary/error are REQUIRED;
/// warning/neutral are optional (car falls back to `AppColors.*`).
export const ThemeColorsSchema = z
  .object({
    // ── surfaces (→ _Palette) — all REQUIRED ────────────────────────
    background: hexColor('colors.background'),
    surfaceLow: hexColor('colors.surfaceLow'),
    surfaceContainer: hexColor('colors.surfaceContainer'),
    surfaceHigh: hexColor('colors.surfaceHigh'),
    outline: hexColor('colors.outline'),
    outlineVariant: hexColor('colors.outlineVariant'),
    onSurface: hexColor('colors.onSurface'),
    onSurfaceVariant: hexColor('colors.onSurfaceVariant'),
    // ── brand / semantic (→ ColorScheme / AppColors) ────────────────
    /// → `ColorScheme.primary` (replaces direct `AppColors.accent`).
    accent: hexColor('colors.accent'),
    /// → `ColorScheme.secondary`.
    secondary: hexColor('colors.secondary'),
    /// → `ColorScheme.error`.
    error: hexColor('colors.error'),
    /// Optional — defaults to `AppColors.warning` on the car when absent.
    warning: hexColor('colors.warning').optional(),
    /// Optional — defaults to `AppColors.neutral` on the car when absent.
    neutral: hexColor('colors.neutral').optional(),
  })
  // strict: an unknown color key is almost always a typo for one of
  // the fixed surface/brand keys (e.g. `surface` vs `surfaceLow`).
  // Catching it at parse time beats the car silently dropping it.
  .strict();

export type ThemeColors = z.infer<typeof ThemeColorsSchema>;

/// Optional wallpaper layer. Every field is an optional bundle-relative
/// path the publish service rewrites to a CDN URL at submit time
/// (identical treatment to `icon`). Omit the whole object for "no
/// wallpaper — paint the solid surface colors".
export const ThemeWallpaperSchema = z
  .object({
    /// Painted behind the home surface (light/default).
    home: wallpaperPath('wallpaper.home').optional(),
    /// Optional dark-mode variant of the home wallpaper.
    homeDark: wallpaperPath('wallpaper.homeDark').optional(),
    /// Painted behind the instrument-cluster surface.
    cluster: wallpaperPath('wallpaper.cluster').optional(),
  })
  .strict();

export type ThemeWallpaper = z.infer<typeof ThemeWallpaperSchema>;

/// Optional typography block. v1 prefers system/bundled families
/// (`Inter` / `Cairo`); `bundled: true` is reserved for T2 (a font
/// shipped in the bundle `fonts/` dir) and the car may ignore it in v1.
export const ThemeTypographySchema = z
  .object({
    /// Font family name. Default keeps the host font (Inter/Cairo by
    /// locale) — omit `typography` entirely to inherit it.
    family: z.string().min(1).max(64).default('Inter'),
    /// `true` → the family is shipped in the bundle `fonts/` dir (T2;
    /// v1 prefers system families).
    bundled: z.boolean().default(false),
  })
  .strict();

export type ThemeTypography = z.infer<typeof ThemeTypographySchema>;

/// Optional corner-radius tokens. Defaults reproduce today's exact look
/// (zero visual change when omitted) — see contract §2.
export const ThemeShapeSchema = z
  .object({
    /// Card / panel corner radius. 0..48, default 24.
    cardRadius: z.number().min(0).max(48).default(24),
    /// Button corner radius. 0..48, default 14.
    buttonRadius: z.number().min(0).max(48).default(14),
    /// Text-input corner radius. 0..48, default 14.
    inputRadius: z.number().min(0).max(48).default(14),
  })
  .strict();

export type ThemeShape = z.infer<typeof ThemeShapeSchema>;

/// Optional gauge skin (T3). The car MAY ignore this in v1 — it is
/// parsed and round-tripped so a future host can render it without a
/// schema bump.
export const ThemeGaugeSchema = z
  .object({
    /// Skin identifier (free-form; the car maps known names to a
    /// painter and falls back to its default for unknown values).
    skin: z.string().min(1).max(32),
    /// Optional ring accent; defaults to `colors.accent` on the car.
    ringColor: hexColor('gauge.ringColor').optional(),
  })
  .strict();

export type ThemeGauge = z.infer<typeof ThemeGaugeSchema>;

/// `ThemeSpec` — the design-token document the car consumes to build a
/// `ThemeData`. Inlined into [ThemeManifestSchema] so a catalog tile can
/// render a palette preview without downloading the bundle. The car's
/// `AppTheme.fromSpec(spec)` maps every field per contract §6; omitting
/// `wallpaper`/`typography`/`shape`/`gauge` reproduces today's look
/// exactly (the feature ships inert).
export const ThemeSpecSchema = z
  .object({
    /// Spec document version. Must equal [THEME_SCHEMA] for this build
    /// to fully understand it; a higher value tells the car to fall
    /// back to the built-in default theme.
    schema: z.number().int().min(1).default(THEME_SCHEMA),
    /// Drives the `ThemeData` base brightness.
    brightness: z.enum(['light', 'dark']),
    /// The color tokens (see [ThemeColorsSchema]).
    colors: ThemeColorsSchema,
    /// Optional whole wallpaper layer.
    wallpaper: ThemeWallpaperSchema.optional(),
    /// Optional typography overrides.
    typography: ThemeTypographySchema.optional(),
    /// Optional corner-radius tokens (defaults preserve today's look).
    shape: ThemeShapeSchema.optional(),
    /// Optional gauge skin (T3 — car may ignore in v1).
    gauge: ThemeGaugeSchema.optional(),
  })
  .strict();

export type ThemeSpec = z.infer<typeof ThemeSpecSchema>;

/// The manifest row for a theme — the durable identity + metadata the
/// catalog stores and the car installs from (`theme.json`). Mirrors
/// `MiniAppManifestSchema` field-for-field where the concept overlaps,
/// with two deliberate differences (contract §3):
///   * NO `url` — a theme is not a WebView. Instead an inline `spec`
///     so a catalog tile renders a palette preview without the bundle.
///   * NO `permissions` / `privileged` / `safeWhileDriving` — a theme
///     only paints; it has no host-capability or driving surface.
///
/// `id` is globally unique + immutable: it lives in the car's persisted
/// `activeThemeId` (SharedPreferences `active_theme_id`), so rotating it
/// orphans the user's selection — bump `version` instead.
export const ThemeManifestSchema = z.object({
  /// URL-safe, globally unique, immutable identifier.
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9_-]{1,63}$/,
      'lowercase alphanumeric, _ or -, must not start with separator',
    ),

  /// Required; at least one locale. Catalog renders a tile title from this.
  name: LocaleMapSchema,

  /// Optional per-row copy. Same fallback semantics as `name`.
  description: LocaleMapSchema.optional(),

  /// Bundle-relative path to the tile icon. Rewritten to a CDN URL at
  /// submit time. PNG or SVG, 256×256, ≤ 100 KB.
  icon: assetPath(ICON_EXT, 'icon'),

  /// Optional 16:9 cover rendered on the theme-detail surface. PNG /
  /// JPEG / WebP / SVG, 1280×720, ≤ 500 KB.
  coverImage: assetPath(PHOTO_EXT, 'coverImage').optional(),

  /// Optional gallery (≤ 8). PNG / JPEG / WebP / SVG, ≤ 1920×1080,
  /// ≤ 800 KB each.
  screenshots: z.array(assetPath(PHOTO_EXT, 'screenshots[]')).max(8).optional(),

  /// Opaque version string (semver-shaped by convention). Bump per
  /// release to bust the bundle/CDN cache.
  version: z.string().min(1),

  /// Minimum host app version. Cars below this hide the theme. Omit for "any".
  minHostVersion: z.string().optional(),

  /// Catalog category. Closed enum — see [THEME_CATEGORY_SLUGS]. Adding
  /// a category is an SDK + backend lockstep PR (the JSON file is
  /// vendored into backend-i99dash; CI fails on drift).
  category: z.enum(slugsJson as [string, ...string[]]),

  /// Optional free-form tags for search/filter. Lowercase alphanumerics
  /// + hyphens, ≤ 24 chars each, ≤ 8 tags.
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(24)
        .regex(/^[a-z0-9-]+$/, 'tag must be lowercase alphanumeric or hyphen'),
    )
    .max(8)
    .optional(),

  /// Hard car/host compatibility requirements. Reuses the mini-app
  /// `MiniAppRequiresSchema` verbatim so `evaluateCompatibility()`
  /// applies the SAME gate (the catalog hides, the car refuses to apply
  /// an incompatible theme). Omit for "applies to any car".
  requires: MiniAppRequiresSchema.optional(),

  /// The inline design-token document (see [ThemeSpecSchema]). REQUIRED
  /// — this is the payload the car actually paints, and it's embedded
  /// in the catalog row so a tile previews the palette without the
  /// bundle.
  spec: ThemeSpecSchema,
});

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;
