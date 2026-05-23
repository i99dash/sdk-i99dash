import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { create as tarCreate } from 'tar';

import { loadThemeManifest, themeAssetSpecs, THEME_MANIFEST_FILE } from '../config/theme-load.js';
import { LocalIOError } from '../util/errors.js';
import { logger } from '../util/logger.js';

export interface ThemeBuildOptions {
  cwd: string;
  /// Output directory for the `.i99theme` tarball. Default: `dist`.
  out?: string;
}

export interface ThemeBuildResult {
  /// Absolute path to the produced `.i99theme` tar.gz.
  tarballPath: string;
  /// Size of the tarball in bytes.
  bytes: number;
  /// SHA-256 of the tarball bytes (matches the backend `bundleSha256`).
  sha256: string;
}

/// Build a `.i99theme` bundle: a deterministic tar.gz containing exactly
/// `theme.json` plus every declared asset (icon / cover / screenshots /
/// wallpapers), at the bundle-relative paths the manifest references.
///
/// "Deterministic" matters because the backend dedupes re-uploads by
/// content hash: same inputs → same bytes → same sha256. We get that by
/// (a) feeding tar an explicit, manifest-ordered file list (never a
/// directory walk, whose order is FS-dependent) and (b) `portable: true`
/// (strips uid/gid/mtime noise — same flag the mini-app packer uses).
///
/// Validation is the caller's job (`theme publish` runs `theme validate`
/// first); `build` re-loads the manifest only to enumerate the file set.
export async function runThemeBuild(opts: ThemeBuildOptions): Promise<ThemeBuildResult> {
  const manifest = await loadThemeManifest(opts.cwd);

  // The files that go in the bundle, in a stable order: theme.json
  // first, then each declared asset in manifest order. All paths are
  // bundle-relative (no leading `./`) and use forward slashes so the
  // archive is identical on Windows + POSIX.
  const assetPaths = themeAssetSpecs(manifest).map((s) => normalizeRel(s.relPath));
  const files = [THEME_MANIFEST_FILE, ...assetPaths];

  // Defence in depth: every listed file must exist (validate already
  // checks this, but build can be invoked directly).
  for (const rel of files) {
    const abs = resolve(opts.cwd, rel);
    if (!existsSync(abs)) {
      throw new LocalIOError(
        `theme bundle is missing ${rel} — run \`i99dash theme validate\` to see why`,
      );
    }
  }

  const outDir = resolve(opts.cwd, opts.out ?? 'dist');
  await mkdir(outDir, { recursive: true });
  const tarballPath = resolve(outDir, `${manifest.id}-${manifest.version}.i99theme`);
  // Remove a stale artifact so a re-run can't append to / be confused
  // with a previous build of a different file set.
  await rm(tarballPath, { force: true });

  await tarCreate(
    {
      gzip: true,
      file: tarballPath,
      cwd: opts.cwd,
      // Deterministic: strip platform-specific uid/gid/mtime so the same
      // inputs hash identically across machines (server-side dedupe).
      portable: true,
    },
    files,
  );

  const stats = await stat(tarballPath);
  const bytes = await readFile(tarballPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  logger.success(
    `theme bundle → ${tarballPath}  size=${stats.size}B sha256=${sha256.slice(0, 12)}…`,
  );
  return { tarballPath, bytes: stats.size, sha256 };
}

/// Normalise a manifest asset path (`./wallpaper/home.png`) into the
/// bundle-relative form tar wants (`wallpaper/home.png`): drop the
/// leading `./` and force forward slashes.
function normalizeRel(relPath: string): string {
  const cleaned = relPath.replace(/^\.\//, '');
  // `relative` collapses any `.` segments without re-introducing `..`
  // (the schema already forbids traversal). Join with `/` for archive
  // portability regardless of the host separator.
  return relative('.', cleaned).split('\\').join('/');
}

// Re-exported so callers can derive the bundle output path without
// re-implementing the naming convention.
export function themeBundleName(id: string, version: string): string {
  return `${id}-${version}.i99theme`;
}
