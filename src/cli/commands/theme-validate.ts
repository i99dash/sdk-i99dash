/// `i99dash theme validate` — Zod-validate `theme.json` against the
/// canonical [ThemeManifestSchema] and check every declared asset
/// (icon / cover / screenshots / wallpapers) exists, has an allowed
/// extension, fits the size + dimension budget, and doesn't traverse
/// outside the project. Cheap (~150ms, no upload, no network) so the
/// publish loop fails fast on a typo.
///
/// Mirrors the mini-app `runValidate`, minus the WebView/URL/dev-server
/// concerns (a theme is not a WebView). Schema failure is fatal; a
/// missing asset is fatal too — unlike mini-apps, a theme bundle has no
/// framework `public/` step that could produce the file later, so the
/// file MUST be present in the project tree at validate time.

import { loadThemeManifest, themeAssetSpecs } from '../config/theme-load.js';
import { formatIssue, validateAssetSpecs } from '../util/assets.js';
import { logger } from '../util/logger.js';

export interface ThemeValidateOptions {
  cwd: string;
}

export class ThemeValidationFailedError extends Error {
  override name = 'ThemeValidationFailedError' as const;
}

/// Zod-validate `theme.json` + asset checks. Throws on a fatal problem
/// (bad schema → `ManifestInvalidError`; missing/oversized asset →
/// `ThemeValidationFailedError`). Safe to call from `theme publish`.
export async function runThemeValidate(opts: ThemeValidateOptions): Promise<void> {
  // 1. Schema. Throws ManifestInvalidError on a malformed file.
  const manifest = await loadThemeManifest(opts.cwd);
  logger.success(
    `theme.json is valid (id=${manifest.id}, version=${manifest.version}, ` +
      `brightness=${manifest.spec.brightness})`,
  );

  // 2. Asset checks against the project tree. The theme bundle is the
  // project dir verbatim (no build step), so paths resolve against cwd.
  // Missing is FATAL here (no framework public/ fallback like mini-apps).
  const issues = await validateAssetSpecs(themeAssetSpecs(manifest), { rootDir: opts.cwd });
  if (issues.length > 0) {
    for (const i of issues) logger.error(formatIssue(i));
    throw new ThemeValidationFailedError(
      `theme asset validation failed (${issues.length} issue(s) — see errors above)`,
    );
  }
  logger.success('all theme assets present and within budget');
}
