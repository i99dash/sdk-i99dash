import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { create as tarCreate } from 'tar';
import { ApiClient } from '../api/client.js';
import { requestUploadUrl, submitManifest, promoteAppToBeta } from '../api/endpoints.js';
import { requireAccessToken } from '../auth/session.js';
import { loadManifest } from '../config/load.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { LocalIOError, UsageError } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { runBuild } from './build.js';
import { runValidate } from './validate.js';

export type PublishTrack = 'production' | 'beta';

export interface PublishOptions {
  cwd: string;
  bundle?: string;
  dryRun: boolean;
  /// Which release track to target. Defaults to 'production'.
  track?: PublishTrack;
  /// Developer-authored notes shown to beta testers. Only valid when
  /// track='beta'; ignored (with a warning) otherwise.
  releaseNotes?: string;
}

export async function runPublish(opts: PublishOptions): Promise<void> {
  const track = opts.track ?? 'production';

  // Guard against misuse of --release-notes on the production track.
  if (opts.releaseNotes && track !== 'beta') {
    throw new UsageError('--release-notes can only be used with --track beta');
  }

  // validate runs every preflight — schema, APP_VERSION drift,
  // same-version-republish warning. Strict on schema, warnings on
  // drift / republish.
  await runValidate({ cwd: opts.cwd });
  const manifest = await loadManifest(opts.cwd);

  const distDir = opts.bundle ? resolve(opts.cwd, opts.bundle) : await runBuild({ cwd: opts.cwd });

  const tarballPath = resolve(tmpdir(), `i99dash-${manifest.id}-${manifest.version}.tar.gz`);
  await tarCreate(
    {
      gzip: true,
      file: tarballPath,
      cwd: distDir,
      // Deterministic ordering so content hashes are stable across
      // machines — helps the server dedupe re-uploads of the same bytes.
      portable: true,
    },
    ['.'],
  );

  const stats = await stat(tarballPath);
  const bytes = await readFile(tarballPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  logger.info(`bundle: ${tarballPath}  size=${stats.size}B sha256=${sha256.slice(0, 12)}…`);

  if (opts.dryRun) {
    logger.success('dry-run ok — nothing uploaded.');
    return;
  }

  const token = await requireAccessToken();
  const api = new ApiClient(resolvedBackendUrl(), token);

  logger.start('requesting upload URL…');
  const { uploadUrl, bundleId } = await requestUploadUrl(api, {
    appId: manifest.id,
    contentLength: stats.size,
    sha256,
  });

  logger.start('uploading bundle…');
  await api.putRaw(uploadUrl, bytes, 'application/gzip');

  logger.start('submitting manifest…');
  const res = await submitManifest(api, manifest, bundleId);
  logger.success(
    `submitted — status=${res.reviewStatus}${res.publishedAt ? ` publishedAt=${res.publishedAt}` : ''}`,
  );

  // The dev needs to know the difference between "live now" and
  // "waiting for an admin." Spell it out so they're not surprised
  // when their app doesn't show up immediately.
  if (res.reviewStatus === 'pending') {
    logger.info(
      "Your app is queued for admin review. You'll get a Telegram message " +
        'when the review completes — meanwhile run `i99dash status` to ' +
        'check at any time.',
    );
  }

  // When targeting the beta track, promote the just-submitted version
  // so it becomes visible to testers. This step runs after submit so
  // the bundle is always registered before the pointer is updated.
  if (track === 'beta') {
    logger.start('promoting to beta track…');
    await promoteAppToBeta(api, manifest.id, manifest.version, opts.releaseNotes);
    logger.success(
      `promoted ${manifest.id}@${manifest.version} to beta track` +
        (opts.releaseNotes ? ' (with release notes)' : ''),
    );
  }
}

// Re-exported so a caller can verify a path exists before handing it
// over — saves one round-trip on `--bundle` flag usage.
export async function ensureBundlePath(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (cause) {
    throw new LocalIOError(`bundle path not found: ${path}`, cause);
  }
}
