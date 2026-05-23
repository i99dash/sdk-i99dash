import { ApiClient } from '../api/client.js';
import { requestThemeUploadUrl, submitThemeManifest } from '../api/endpoints.js';
import { requireAccessToken } from '../auth/session.js';
import { loadThemeManifest } from '../config/theme-load.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { logger } from '../util/logger.js';
import { runThemeBuild } from './theme-build.js';
import { runThemeValidate } from './theme-validate.js';

export interface ThemePublishOptions {
  cwd: string;
  /// Validate + build the `.i99theme` tarball but don't upload. Useful
  /// in CI to prove a theme is publishable without minting bytes.
  dryRun?: boolean;
}

/// `i99dash theme publish` — the full pipeline:
///   validate → build → request presigned upload URL → PUT bytes →
///   submit manifest.
///
/// Mirrors the mini-app `runPublish` (minus the beta-track machinery —
/// themes ship a single production track in v1). Validation runs first
/// so a schema/asset error fails before any network or build cost.
export async function runThemePublish(opts: ThemePublishOptions): Promise<void> {
  // 1. Validate (schema + assets). Throws on any fatal problem.
  await runThemeValidate({ cwd: opts.cwd });
  const manifest = await loadThemeManifest(opts.cwd);

  // 2. Build the deterministic `.i99theme` tarball.
  const { tarballPath, bytes: size, sha256 } = await runThemeBuild({ cwd: opts.cwd });
  logger.info(`bundle: ${tarballPath}  size=${size}B sha256=${sha256.slice(0, 12)}…`);

  if (opts.dryRun) {
    logger.success('dry-run ok — nothing uploaded.');
    return;
  }

  const token = await requireAccessToken();
  const api = new ApiClient(resolvedBackendUrl(), token);

  // 3. Presigned upload URL.
  logger.start('requesting upload URL…');
  const { uploadUrl, bundleId } = await requestThemeUploadUrl(api, {
    themeId: manifest.id,
    contentLength: size,
    sha256,
  });

  // 4. PUT the bytes to object storage (presigned URL is the credential).
  logger.start('uploading bundle…');
  const { readFile } = await import('node:fs/promises');
  const body = await readFile(tarballPath);
  await api.putRaw(uploadUrl, body, 'application/gzip');

  // 5. Register the manifest against the just-uploaded bundle.
  logger.start('submitting theme…');
  const res = await submitThemeManifest(api, manifest, bundleId);
  logger.success(
    `submitted — status=${res.reviewStatus}` +
      (res.publishedAt ? ` publishedAt=${res.publishedAt}` : ''),
  );

  if (res.reviewStatus === 'pending') {
    logger.info(
      'Your theme is queued for admin review. Run `i99dash status` to ' + 'check at any time.',
    );
  }
}
