import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ThemeManifestSchema, type ThemeManifest } from '../../types/index.js';
import {
  ICON_RULES,
  COVER_RULES,
  SCREENSHOT_RULES,
  WALLPAPER_RULES,
  type AssetSpec,
} from '../util/assets.js';
import { ManifestInvalidError, LocalIOError } from '../util/errors.js';

/// The on-disk filename for a theme's catalog row. Mirrors the mini-app
/// `manifest.json`; a theme project keeps its `theme.json` at the
/// project root next to its assets.
export const THEME_MANIFEST_FILE = 'theme.json';

/// Absolute path to a theme project's `theme.json`.
export function themeManifestPath(projectRoot: string): string {
  return resolve(projectRoot, THEME_MANIFEST_FILE);
}

/// Read + Zod-validate `theme.json`. Throws `ManifestInvalidError` on a
/// malformed file (with a formatted issue list) and `LocalIOError` when
/// the file is unreadable — same contract + error types as the mini-app
/// `loadManifest`, so the CLI's top-level handler maps both to the same
/// exit codes.
export async function loadThemeManifest(projectRoot: string): Promise<ThemeManifest> {
  const file = themeManifestPath(projectRoot);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    throw new LocalIOError(`could not read ${file}`, cause);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ManifestInvalidError('theme.json is not valid JSON', cause);
  }
  const result = ThemeManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ManifestInvalidError(
      `theme.json failed schema validation:\n${formatZodIssues(result.error.issues)}`,
      result.error,
    );
  }
  return result.data;
}

/// Build the [AssetSpec] list a theme declares: the required `icon`,
/// optional `coverImage` / `screenshots[]`, and any `spec.wallpaper.*`
/// paths. Reuses the locked mini-app rules for icon/cover/screenshots so
/// the thresholds can't drift, plus `WALLPAPER_RULES` for backgrounds.
export function themeAssetSpecs(manifest: ThemeManifest): AssetSpec[] {
  const out: AssetSpec[] = [{ field: 'icon', relPath: manifest.icon, rules: ICON_RULES }];
  if (manifest.coverImage) {
    out.push({ field: 'coverImage', relPath: manifest.coverImage, rules: COVER_RULES });
  }
  for (const [i, p] of (manifest.screenshots ?? []).entries()) {
    out.push({ field: `screenshots[${i}]`, relPath: p, rules: SCREENSHOT_RULES });
  }
  const wp = manifest.spec.wallpaper;
  if (wp?.home)
    out.push({ field: 'spec.wallpaper.home', relPath: wp.home, rules: WALLPAPER_RULES });
  if (wp?.homeDark) {
    out.push({ field: 'spec.wallpaper.homeDark', relPath: wp.homeDark, rules: WALLPAPER_RULES });
  }
  if (wp?.cluster) {
    out.push({ field: 'spec.wallpaper.cluster', relPath: wp.cluster, rules: WALLPAPER_RULES });
  }
  return out;
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((i) => `  · ${i.path.join('.') || '<root>'}: ${i.message}`).join('\n');
}
