import { readFile } from 'node:fs/promises';

import { ApiClient } from '../api/client.js';
import { requestApkUploadUrl, submitApkManifest } from '../api/endpoints.js';
import { loadKey } from '../auth/ssh.js';
import { requireAccessToken } from '../auth/session.js';
import { loadApkManifest } from '../config/apk-load.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { canonicalArtifactManifest } from '../util/apk-canonical.js';
import { logger } from '../util/logger.js';
import { runApkBuild } from './apk-build.js';
import { runApkValidate } from './apk-validate.js';

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

export interface ApkPublishOptions {
  cwd: string;
  /// Validate + hash the APK but don't upload (CI publishability check).
  dryRun?: boolean;
  /// Override the SSH key path / passphrase used to attest the artifact (K1).
  key?: string;
  passphrase?: string;
}

/// `i99dash apk publish` — the full native-APK pipeline:
///   validate → hash → SSH-attest (K1) → request upload URL → PUT bytes →
///   submit manifest (→ admin review → mint K3 → promote).
///
/// Mirrors `theme publish`. The developer's SSH key signs the canonical
/// artifact manifest so the backend can prove WHO uploaded these exact
/// bytes; the Android signer SHA is TOFU-pinned on first publish.
export async function runApkPublish(opts: ApkPublishOptions): Promise<void> {
  // 1. Validate (schema + local artifact). Throws before any network cost.
  await runApkValidate({ cwd: opts.cwd });
  const manifest = await loadApkManifest(opts.cwd);

  // 2. Hash the release APK (the car re-verifies this sha256 after download).
  const { apkPath, bytes: size, sha256 } = await runApkBuild({ cwd: opts.cwd });

  if (opts.dryRun) {
    logger.success('dry-run ok — nothing uploaded.');
    return;
  }

  // 3. Attest the artifact with the developer's SSH key (K1).
  const loaded = loadKey(opts.key, opts.passphrase);
  const canonical = canonicalArtifactManifest({
    packageName: manifest.id,
    versionCode: manifest.versionCode,
    versionName: manifest.versionName,
    apkSha256: sha256,
    sizeBytes: size,
    apkSignerSha256: manifest.signerSha256,
  });
  const devSignature = loaded.sign(canonical).toString('base64');

  const token = await requireAccessToken();
  const api = new ApiClient(resolvedBackendUrl(), token);

  // 4. Ownership-checked presigned PUT URL (scoped to this exact object key).
  logger.start('requesting upload URL…');
  const { uploadUrl } = await requestApkUploadUrl(api, {
    package: manifest.id,
    versionCode: manifest.versionCode,
  });

  // 5. PUT the APK bytes direct to object storage (presigned URL = credential).
  logger.start('uploading apk…');
  const body = await readFile(apkPath);
  await api.putRaw(uploadUrl, body, APK_CONTENT_TYPE);

  // 6. Submit the attested manifest.
  logger.start('submitting…');
  const res = await submitApkManifest(api, {
    manifest: {
      packageName: manifest.id,
      versionCode: manifest.versionCode,
      versionName: manifest.versionName,
      apkSha256: sha256,
      sizeBytes: size,
      apkSignerSha256: manifest.signerSha256,
    },
    devSignature,
    ...(manifest.category ? { category: manifest.category } : {}),
    ...(manifest.requires ? { requires: manifest.requires } : {}),
  });
  logger.success(`submitted — status=${res.reviewStatus} release=${res.releaseId.slice(0, 8)}…`);
  if (res.reviewStatus === 'pending') {
    logger.info(
      'Queued for admin review (native apps require human approval). ' +
        'Once approved, run `i99dash apk promote --rollout 10`.',
    );
  }
}
