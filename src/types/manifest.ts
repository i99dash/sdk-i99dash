import { z } from 'zod';
import slugsJson from './category-slugs.json' with { type: 'json' };

/// Two-letter locale code (`ar`, `en`, ...) → display string.
/// At least one entry is required so the host can always render a name.
/// Fallback precedence inside the host: exact match → `en` → first entry.
export const LocaleMapSchema = z
  .record(
    z.string().regex(/^[a-z]{2}$/, 'locale key must be 2 lowercase letters'),
    z.string().min(1, 'locale value cannot be empty'),
  )
  .refine((m) => Object.keys(m).length > 0, 'at least one locale required');

export type LocaleMap = z.infer<typeof LocaleMapSchema>;

/// Canonical category slugs. The same JSON file is vendored into
/// backend-i99dash; a CI drift check (`scripts/check-category-drift.mjs`)
/// fails the PR if the two copies diverge. Renaming or removing a slug
/// post-release requires a data migration — additions are SDK + backend
/// in lockstep.
export const CATEGORY_SLUGS = slugsJson as readonly string[];

const assetPath = (extPattern: RegExp, label: string) =>
  z
    .string()
    .min(3)
    .max(256)
    .regex(/^\.\//, `${label} must be a relative path starting with "./"`)
    .refine((p) => !p.split('/').includes('..'), `${label} must not traverse parent directories`)
    .refine((p) => extPattern.test(p), `${label} extension must be one of ${extPattern.source}`);

const ICON_EXT = /\.(png|svg)$/i;
// PHOTO_EXT covers raster + SVG: the host's MiniAppRemoteImage routes
// SVG via flutter_svg (Android's ImageDecoder rejects SVG with
// `unimplemented`), so vector mockups + raster screenshots both
// render. Lifts a real publisher pain point: indie developers
// hand-rolling a 1280×720 cover in raster when SVG is sufficient.
const PHOTO_EXT = /\.(png|jpe?g|webp|svg)$/i;

/// The manifest row for a mini-app — the durable identity + metadata
/// the host's catalog stores and launches from. Every field here is
/// the same shape the backend's `/api/v1/mini-apps/catalog` returns,
/// so a bundle built through this SDK round-trips unchanged.
///
/// Fields that break users if changed post-publish are called out in
/// `docs/api-ref/manifest.md`; the most important is `id` (it lives
/// in every pinned home-screen shortcut's URL forever).
export const MiniAppManifestSchema = z.object({
  /// URL-safe, globally unique identifier. Also lives in pinned
  /// home-screen shortcut deep links (`.../m/<id>`), so rotating this
  /// orphans every user's pinned icon — bump `version` instead.
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9_-]{1,63}$/,
      'lowercase alphanumeric, _ or -, must not start with separator',
    ),

  /// Required; at least one locale. Host renders a tile title from this.
  name: LocaleMapSchema,

  /// Optional per-row copy. Same fallback semantics as `name`.
  description: LocaleMapSchema.optional(),

  /// Bundle-relative path to the tile icon. The publish service rewrites
  /// this to an absolute CDN URL at submit time; the catalog API and the
  /// Flutter host see only the rewritten URL string in this field. PNG
  /// or SVG, 256×256, ≤ 100 KB.
  icon: assetPath(ICON_EXT, 'icon'),

  /// Optional 16:9 cover image rendered on app-detail surfaces. Same
  /// relative-path rules as `icon`. PNG / JPEG / WebP / SVG, 1280×720,
  /// ≤ 500 KB.
  coverImage: assetPath(PHOTO_EXT, 'coverImage').optional(),

  /// Optional gallery (≤ 8). PNG / JPEG / WebP / SVG, ≤ 1920×1080,
  /// ≤ 800 KB each. Same relative-path + rewrite-at-submit semantics
  /// as `icon`.
  screenshots: z.array(assetPath(PHOTO_EXT, 'screenshots[]')).max(8).optional(),

  /// HTTPS URL the host's WebView opens. Must live under an allow-listed
  /// origin (`miniapps.i99dash.app` in v1). The host enforces this at
  /// launch; a manifest pointing off-allowlist is rejected.
  url: z.string().url().startsWith('https://', 'url must be https'),

  /// Opaque version string (semver-shaped by convention). Bumped per
  /// release to bust the WebView cache.
  version: z.string().min(1),

  /// Minimum host app version. Hosts below this show an "update your
  /// app" card instead of opening the viewer. Omit for "any".
  minHostVersion: z.string().optional(),

  /// Catalog category. Closed enum — see `CATEGORY_SLUGS` for the
  /// canonical list. Adding a category is a SDK + backend lockstep PR
  /// (the JSON file is vendored into backend-i99dash; CI fails on drift).
  category: z.enum(slugsJson as [string, ...string[]]),

  /// Optional free-form tags. Used for search/filter only — not the
  /// primary navigation surface (categories are). Lowercase
  /// alphanumerics + hyphens, ≤ 24 chars each, ≤ 8 tags.
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

  /// Whether this app may render while the car is moving (speed > 5 km/h).
  /// Default `false` — catalog authors must explicitly opt in. Set only
  /// if the app is read-only, glanceable, no text input / video /
  /// interactive map.
  safeWhileDriving: z.boolean().default(false),
});

export type MiniAppManifest = z.infer<typeof MiniAppManifestSchema>;
