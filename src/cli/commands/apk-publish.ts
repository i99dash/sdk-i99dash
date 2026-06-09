import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ApiClient } from '../api/client.js';
import { requestApkUploadUrl, submitApkManifest } from '../api/endpoints.js';
import { mintPublishToken } from '../auth/ssh-login.js';
import { loadKey } from '../auth/ssh.js';
import { requireAccessToken } from '../auth/session.js';
import { loadApkManifest } from '../config/apk-load.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { canonicalArtifactManifest } from '../util/apk-canonical.js';
import { extractApkMetadata, toLocaleMap } from '../util/apk-extract.js';
import { NotAuthenticatedError, ServerError } from '../util/errors.js';
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

  // Resolve a credential. Prefer an explicit token (I99DASH_TOKEN env or the
  // keychain); in CI where neither is set, auto-mint a PUBLISH-SCOPED token
  // from the SSH key we just loaded — so a CI job needs only the key (no
  // stored token), and the credential it gets can ONLY hit the publish
  // surface (it's rejected everywhere else).
  const backendUrl = resolvedBackendUrl();
  let token: string;
  try {
    token = await requireAccessToken();
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      logger.info('no token found — signing in with the SSH key for a publish-scoped token');
      token = await mintPublishToken(backendUrl, loaded);
    } else {
      throw err;
    }
  }
  let api = new ApiClient(backendUrl, token);

  // A slow upload can outlive a short publish token. On a 401, re-mint once
  // from the SSH key and retry the call — so an unattended CI publish never
  // strands on an expired credential. (The presigned PUT carries its own
  // URL credential and is not wrapped.)
  const withAuthRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ServerError && err.statusCode === 401) {
        logger.info('token expired — re-minting from the SSH key');
        token = await mintPublishToken(backendUrl, loaded);
        api = new ApiClient(backendUrl, token);
        return await fn();
      }
      throw err;
    }
  };

  // 4. Ownership-checked presigned PUT URL (scoped to this exact object key).
  logger.start('requesting upload URL…');
  const { uploadUrl } = await withAuthRetry(() =>
    requestApkUploadUrl(api, {
      package: manifest.id,
      versionCode: manifest.versionCode,
    }),
  );

  // 5. PUT the APK bytes direct to object storage (presigned URL = credential).
  logger.start('uploading apk…');
  const body = await readFile(apkPath);
  await api.putRaw(uploadUrl, body, APK_CONTENT_TYPE);

  // 5b. Storefront metadata (cosmetic; sent alongside — NOT inside — the
  //     K1-signed manifest). Auto-extract the launcher icon + label from the
  //     APK; apk.json overrides win. Best-effort: extraction never blocks a
  //     publish, and the icon is omitted if neither source yields one.
  const extracted = await extractApkMetadata(apkPath);
  if (extracted.package && extracted.package !== manifest.id) {
    logger.warn(`APK applicationId '${extracted.package}' != apk.json id '${manifest.id}'`);
  }
  const displayName = toLocaleMap(manifest.displayName) ?? toLocaleMap(extracted.label);
  const description = toLocaleMap(manifest.description);
  let icon: string | undefined;
  if (manifest.iconPath) {
    icon = (await readFile(resolve(opts.cwd, manifest.iconPath))).toString('base64');
  } else if (extracted.iconBase64) {
    icon = extracted.iconBase64;
  }
  if (displayName || icon) {
    const name = displayName ? Object.values(displayName)[0] : '(none)';
    logger.info(`storefront: name='${name}' icon=${icon ? 'yes' : 'no'}`);
  }

  // 6. Submit the attested manifest.
  logger.start('submitting…');
  const res = await withAuthRetry(() =>
    submitApkManifest(api, {
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
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
      ...(icon ? { icon } : {}),
    }),
  );
  logger.success(`submitted — status=${res.reviewStatus} release=${res.releaseId.slice(0, 8)}…`);
  if (res.reviewStatus === 'pending') {
    logger.info(
      'Queued for admin review (native apps require human approval). ' +
        'Once approved, run `i99dash apk promote --rollout 10`.',
    );
  }
}
