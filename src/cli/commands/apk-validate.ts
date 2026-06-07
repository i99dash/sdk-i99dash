import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadApkManifest } from '../config/apk-load.js';
import { logger } from '../util/logger.js';

export class ApkValidationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApkValidationFailedError';
  }
}

export interface ApkValidateOptions {
  cwd: string;
}

/// Normalise an Android signer SHA the way the backend does: drop colons,
/// lowercase. A valid value is 64 hex chars (SHA-256).
export function normalizeSignerSha(s: string): string {
  return s.replace(/:/g, '').toLowerCase();
}

/// `i99dash apk validate` — schema + local artifact checks before any
/// network cost. Throws `ApkValidationFailedError` on a fatal problem so
/// `apk publish` aborts before building/uploading.
export async function runApkValidate(opts: ApkValidateOptions): Promise<void> {
  // Schema (reverse-DNS id, reserved-name guard, positive versionCode, …).
  const manifest = await loadApkManifest(opts.cwd);

  const apkPath = resolve(opts.cwd, manifest.apkPath);
  if (!existsSync(apkPath)) {
    throw new ApkValidationFailedError(
      `apkPath "${manifest.apkPath}" does not exist — build + sign the release .apk first`,
    );
  }

  const signer = normalizeSignerSha(manifest.signerSha256);
  if (!/^[0-9a-f]{64}$/.test(signer)) {
    throw new ApkValidationFailedError(
      'signerSha256 must be a SHA-256 (64 hex chars) — get it from ' +
        '`apksigner verify --print-certs <apk>` or `keytool -list`',
    );
  }

  logger.success(`apk.json ok — ${manifest.id} v${manifest.versionName} (${manifest.versionCode})`);
}
