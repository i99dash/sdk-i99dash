import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadApkManifest } from '../config/apk-load.js';
import { LocalIOError } from '../util/errors.js';
import { logger } from '../util/logger.js';

export interface ApkBuildOptions {
  cwd: string;
}

export interface ApkBuildResult {
  /// Absolute path to the `.apk`.
  apkPath: string;
  /// Size of the APK in bytes.
  bytes: number;
  /// SHA-256 of the APK bytes (hex) — the car re-verifies this after download.
  sha256: string;
}

/// "Build" for a native APK is just measuring the already-built artifact:
/// the developer compiles + signs the `.apk` with their own Android
/// toolchain; we compute the content hash + size the publish flow attests
/// to. (No tarball — an APK is a single immutable file served as-is.)
export async function runApkBuild(opts: ApkBuildOptions): Promise<ApkBuildResult> {
  const manifest = await loadApkManifest(opts.cwd);
  const apkPath = resolve(opts.cwd, manifest.apkPath);
  if (!existsSync(apkPath)) {
    throw new LocalIOError(
      `apk not found at ${manifest.apkPath} — build + sign it first, ` +
        `then point apk.json "apkPath" at the release .apk`,
    );
  }
  const stats = await stat(apkPath);
  const bytes = await readFile(apkPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  logger.success(`apk → ${apkPath}  size=${stats.size}B sha256=${sha256.slice(0, 12)}…`);
  return { apkPath, bytes: stats.size, sha256 };
}
