import { z } from 'zod';
import slugsJson from './category-slugs.json' with { type: 'json' };
import { DILINK_FAMILIES, VEHICLE_CAPABILITIES } from './vehicle-capabilities.js';
import { canonicalizeMiniAppOrigin } from './origin.js';

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

/// Builds the canonical "bundle-relative asset path" validator used by
/// every manifest field that points at a packaged file (`icon`,
/// `coverImage`, `screenshots[]`, theme `wallpaper.*`). Exported so the
/// theme manifest (`theme-manifest.ts`) reuses the EXACT same rules —
/// relative, must start `./`, no `..` traversal, ≤256 chars — instead
/// of re-deriving a near-identical regex that could drift.
export const assetPath = (extPattern: RegExp, label: string) =>
  z
    .string()
    .min(3)
    .max(256)
    .regex(/^\.\//, `${label} must be a relative path starting with "./"`)
    .refine((p) => !p.split('/').includes('..'), `${label} must not traverse parent directories`)
    .refine((p) => extPattern.test(p), `${label} extension must be one of ${extPattern.source}`);

export const ICON_EXT = /\.(png|svg)$/i;
// PHOTO_EXT covers raster + SVG: the host's MiniAppRemoteImage routes
// SVG via flutter_svg (Android's ImageDecoder rejects SVG with
// `unimplemented`), so vector mockups + raster screenshots both
// render. Lifts a real publisher pain point: indie developers
// hand-rolling a 1280×720 cover in raster when SVG is sufficient.
export const PHOTO_EXT = /\.(png|jpe?g|webp|svg)$/i;

/// `requires.schema` version. Bump this whenever a NEW `requires.*`
/// key is added. The contract: a manifest declaring `requires.schema`
/// higher than an evaluator's `REQUIRES_SCHEMA` carries a hard
/// requirement that evaluator can't reason about, so
/// `evaluateCompatibility()` **fails closed** (hides the app) rather
/// than silently ignoring a gate. That is why `requires` uses
/// `.passthrough()` below — an older host/catalog must still *parse*
/// a newer manifest (not throw) so it can apply the fail-closed rule.
export const REQUIRES_SCHEMA = 1;

/// Hard compatibility requirements. Omit the whole object for "runs
/// on any car, degrade at runtime". Every sub-key is optional and
/// expressed in the platform's already-canonical, drift-checked
/// vocabularies ([DILINK_FAMILIES], [VEHICLE_CAPABILITIES]) — never
/// implementation details like container package names. The catalog
/// hides, and the host refuses to launch, an app whose requirements
/// the active car doesn't meet (same enforcement model as
/// `minHostVersion`). Evaluated centrally by
/// `evaluateCompatibility()` so SDK, CLI, host, and backend share one
/// implementation.
export const MiniAppRequiresSchema = z
  .object({
    /// Schema version of this block (see [REQUIRES_SCHEMA]). Defaults
    /// to the current schema when omitted.
    schema: z.number().int().min(1).default(REQUIRES_SCHEMA),
    /// DiLink generation allow-list, e.g. `['di5.1']`. A car whose
    /// `dilinkFamily` is not listed (including `'unknown'`) is
    /// incompatible.
    dilink: z.array(z.enum(DILINK_FAMILIES)).nonempty().optional(),
    /// Vehicle-hardware capabilities the car MUST advertise, e.g.
    /// `['surface.write.cluster']` for a cluster app. Checked as a
    /// branchless bitmask subset (see `hasAllCapabilities`).
    vehicleCapabilities: z.array(z.enum(VEHICLE_CAPABILITIES)).nonempty().optional(),
    /// `true` → the app needs a modern WebView (Chrome 100+). Di5.0
    /// trims (frozen ~2022 WebView) are incompatible. Leave unset for
    /// classic-IIFE/ES2019 bundles that run everywhere.
    modernWebview: z.boolean().optional(),
    /// Minimum host bridge protocol version (semver-ish, e.g.
    /// `'2.0.0'`). Opaque string compared numerically by the
    /// evaluator; an unparseable or absent host version fails closed.
    minBridge: z.string().min(1).max(32).optional(),
  })
  // passthrough (NOT strict): a newer manifest may carry requires.*
  // keys this SDK version predates. Parsing must not throw — the
  // fail-closed `schema` check in evaluateCompatibility() handles
  // forward-compat gracefully instead.
  .passthrough();

export type MiniAppRequires = z.infer<typeof MiniAppRequiresSchema>;

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

  /// Hard car/host compatibility requirements. Omit for "runs on any
  /// car". See [MiniAppRequiresSchema]; enforced via
  /// `evaluateCompatibility()` by the catalog (hide) and host (refuse
  /// launch).
  requires: MiniAppRequiresSchema.optional(),

  /// Host permission scopes the app uses (e.g. `'location.read'`).
  /// Open list by design — scopes append as the host ships handlers,
  /// mirroring `HostCapabilities.families` (no closed enum, so a new
  /// scope never needs an SDK release). Informational for the catalog
  /// / consent UI; the host arbitrates the actual grant at call time.
  permissions: z.array(z.string().min(1).max(64)).max(32).optional(),

  /// Declared external-egress allow-list: the HTTPS origins this app may
  /// reach over the network. The car host turns this (union with the global
  /// bundle origin) into a per-app Content-Security-Policy delivered as an
  /// HTTP response header; every other origin is blocked. Each entry is a
  /// bare `https://host[:port]` — no path/query/fragment/userinfo/wildcard,
  /// no IP literal or `localhost` (see [canonicalizeMiniAppOrigin]). Entries
  /// are lowercased + de-duped into canonical form at parse time, so the
  /// stored value is CSP-byte-stable. Omit (or `[]`) ⇒ the app reaches no
  /// third-party network; it can still load its own bundle. Max 10 origins.
  ///
  /// Note: this grants UNAUTHENTICATED browser `fetch()` to the declared
  /// origins — no i99dash credentials are attached. It is a least-privilege
  /// control reviewed at publish, not a guarantee against a hostile author.
  network: z
    .array(z.string().min(1).max(253))
    .max(10, 'network: at most 10 origins')
    .transform((origins, ctx) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const raw of origins) {
        const canon = canonicalizeMiniAppOrigin(raw);
        if (canon === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `network origin must be https://host[:port] with no path/query/fragment/userinfo/wildcard/IP: ${raw}`,
          });
          return z.NEVER;
        }
        if (!seen.has(canon)) {
          seen.add(canon);
          out.push(canon);
        }
      }
      return out;
    })
    .optional(),

  /// Privileged app (uses the admin bridge — `pkg.*`, `sys.*`,
  /// `diag.*`, `fs.*`). Default `false`. This is a **distribution**
  /// gate (catalog ACL decides who may install it), distinct from the
  /// vehicle-compat gate in `requires`; `evaluateCompatibility()`
  /// deliberately does not consider it.
  privileged: z.boolean().default(false),
});

export type MiniAppManifest = z.infer<typeof MiniAppManifestSchema>;
