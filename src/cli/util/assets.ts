/// Asset validation — shared between `validate` (source-tree check) and
/// `build` (dist-tree check). The same rules run twice: cheap-fast on the
/// source so devs see errors before a long framework build, then again on
/// the build output so a misconfigured framework (icon in wrong folder,
/// public/ not wired up) doesn't sneak past.
///
/// The locked thresholds match the manifest reference docs (see
/// docs-i99dash/content/docs/recipes/app-icons.mdx) and the backend
/// magic-byte check (Phase 3).

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { imageSize } from 'image-size';
import type { MiniAppManifest } from '../../types/index.js';

import { ManifestInvalidError } from './errors.js';

export interface AssetSpec {
  /// Manifest field that points at the asset (`icon`, `coverImage`, `screenshots[3]`).
  field: string;
  /// Bundle-relative path from the manifest (`./assets/icon.svg`).
  relPath: string;
  /// Locked threshold rules — pass the right kind for the field.
  rules: AssetRules;
}

export interface AssetRules {
  /// Allowed extensions, lowercase, with leading dot (`.png`, `.svg`).
  extensions: readonly string[];
  /// Maximum file size in bytes.
  maxBytes: number;
  /// Required exact dimensions, or null to skip the dimension check.
  exactDimensions?: { width: number; height: number } | null;
  /// Maximum dimensions if exactDimensions isn't set. Either both or neither.
  maxDimensions?: { width: number; height: number } | null;
}

export const ICON_RULES: AssetRules = {
  extensions: ['.png', '.svg'],
  maxBytes: 100 * 1024,
  exactDimensions: { width: 256, height: 256 },
};

// SVG joins the photo set: the host's MiniAppRemoteImage routes
// SVG via flutter_svg (Android's ImageDecoder rejects SVG). Lifts a
// real publisher pain point — letting indie developers ship a
// vector mock-up instead of hand-rolling 1280×720 raster bitmaps.
// SVG is dimensionless, so dimension validators skip those files.
export const COVER_RULES: AssetRules = {
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
  maxBytes: 500 * 1024,
  exactDimensions: { width: 1280, height: 720 },
};

export const SCREENSHOT_RULES: AssetRules = {
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
  maxBytes: 800 * 1024,
  maxDimensions: { width: 1920, height: 1080 },
};

/// Theme wallpaper rules. A wallpaper is a full-bleed background painted
/// behind the home / cluster surfaces, so it's allowed to be larger than
/// a screenshot. Capped at the largest car display (Leopard-8 IVI is
/// 1920×1080; the cluster is smaller) plus headroom for hi-dpi sources,
/// and 2 MB so a single uncompressed PNG doesn't bloat the bundle.
export const WALLPAPER_RULES: AssetRules = {
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
  maxBytes: 2 * 1024 * 1024,
  maxDimensions: { width: 2560, height: 1440 },
};

/// Walks the manifest and returns the asset specs the dev declared.
/// Optional fields produce no spec when absent.
export function specsFromManifest(manifest: MiniAppManifest): AssetSpec[] {
  const out: AssetSpec[] = [{ field: 'icon', relPath: manifest.icon, rules: ICON_RULES }];
  if (manifest.coverImage) {
    out.push({ field: 'coverImage', relPath: manifest.coverImage, rules: COVER_RULES });
  }
  for (const [i, p] of (manifest.screenshots ?? []).entries()) {
    out.push({ field: `screenshots[${i}]`, relPath: p, rules: SCREENSHOT_RULES });
  }
  return out;
}

export interface ValidateAssetsOptions {
  /// Directory the relative paths resolve against. Source-tree pass uses
  /// `appRoot`; build-tree pass uses `distDir`.
  rootDir: string;
  /// When true, "file not found" is downgraded to a warning. The source-
  /// tree pass uses this because framework projects (Next.js public/) may
  /// not have the file under `appRoot`. Build-tree pass leaves it false.
  warnOnMissing?: boolean;
}

export type AssetIssue =
  | { kind: 'missing'; field: string; resolvedPath: string }
  | { kind: 'extension'; field: string; got: string; want: readonly string[] }
  | { kind: 'too-large'; field: string; gotBytes: number; maxBytes: number }
  | { kind: 'dimensions'; field: string; got: string; want: string }
  | { kind: 'unreadable'; field: string; resolvedPath: string; cause: unknown };

/// Resolves + validates each asset. Returns issues; the caller decides
/// fatal vs. warn.
export async function validateAssets(
  manifest: MiniAppManifest,
  opts: ValidateAssetsOptions,
): Promise<AssetIssue[]> {
  return validateAssetSpecs(specsFromManifest(manifest), opts);
}

/// Lower-level: validate an explicit list of [AssetSpec]s against a
/// root dir. `validateAssets` (mini-app) delegates here after building
/// specs from a `MiniAppManifest`; the theme commands build their own
/// spec list (icon/cover/screenshots/wallpaper.*) and reuse this so the
/// SAME locked thresholds + traversal guards apply to both surfaces.
export async function validateAssetSpecs(
  specs: AssetSpec[],
  opts: ValidateAssetsOptions,
): Promise<AssetIssue[]> {
  const issues: AssetIssue[] = [];
  const root = resolve(opts.rootDir);

  for (const spec of specs) {
    if (isAbsolute(spec.relPath) || spec.relPath.split('/').includes('..')) {
      // Schema already rejects these — defence in depth in case the schema
      // ever drifts out of sync with this util.
      throw new ManifestInvalidError(
        `${spec.field}=${spec.relPath} must be a relative path under appRoot`,
      );
    }
    const full = resolve(root, spec.relPath);
    if (!full.startsWith(root)) {
      throw new ManifestInvalidError(
        `${spec.field}=${spec.relPath} resolves outside the project root`,
      );
    }

    let st;
    try {
      st = await stat(full);
    } catch {
      if (opts.warnOnMissing) continue;
      issues.push({ kind: 'missing', field: spec.field, resolvedPath: full });
      continue;
    }
    if (!st.isFile()) {
      issues.push({ kind: 'missing', field: spec.field, resolvedPath: full });
      continue;
    }

    const lowerExt = '.' + (spec.relPath.split('.').pop() ?? '').toLowerCase();
    if (!spec.rules.extensions.includes(lowerExt)) {
      issues.push({
        kind: 'extension',
        field: spec.field,
        got: lowerExt,
        want: spec.rules.extensions,
      });
      continue;
    }

    if (st.size > spec.rules.maxBytes) {
      issues.push({
        kind: 'too-large',
        field: spec.field,
        gotBytes: st.size,
        maxBytes: spec.rules.maxBytes,
      });
      // Keep going — dimension check still useful info.
    }

    // SVG: skip dimensions (they're scalable; the `viewBox` is what
    // matters and image-size sniffs it on a best-effort basis).
    if (lowerExt === '.svg') continue;

    let dims: { width?: number; height?: number };
    try {
      const buf = await readFile(full);
      dims = imageSize(buf);
    } catch (cause) {
      issues.push({ kind: 'unreadable', field: spec.field, resolvedPath: full, cause });
      continue;
    }
    if (typeof dims.width !== 'number' || typeof dims.height !== 'number') {
      issues.push({
        kind: 'unreadable',
        field: spec.field,
        resolvedPath: full,
        cause: 'image-size returned no dimensions',
      });
      continue;
    }

    if (spec.rules.exactDimensions) {
      const { width, height } = spec.rules.exactDimensions;
      if (dims.width !== width || dims.height !== height) {
        issues.push({
          kind: 'dimensions',
          field: spec.field,
          got: `${dims.width}×${dims.height}`,
          want: `${width}×${height}`,
        });
      }
    } else if (spec.rules.maxDimensions) {
      const { width, height } = spec.rules.maxDimensions;
      if (dims.width > width || dims.height > height) {
        issues.push({
          kind: 'dimensions',
          field: spec.field,
          got: `${dims.width}×${dims.height}`,
          want: `≤ ${width}×${height}`,
        });
      }
    }
  }

  return issues;
}

export function formatIssue(issue: AssetIssue): string {
  switch (issue.kind) {
    case 'missing':
      return `${issue.field}: file not found at ${issue.resolvedPath}`;
    case 'extension':
      return `${issue.field}: extension ${issue.got} not in [${issue.want.join(', ')}]`;
    case 'too-large':
      return `${issue.field}: ${(issue.gotBytes / 1024).toFixed(1)} KB exceeds limit ${(issue.maxBytes / 1024).toFixed(0)} KB`;
    case 'dimensions':
      return `${issue.field}: ${issue.got} does not match required ${issue.want}`;
    case 'unreadable':
      return `${issue.field}: ${issue.resolvedPath} could not be parsed as an image (${String(issue.cause)})`;
  }
}
