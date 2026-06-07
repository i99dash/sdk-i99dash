import { ApiClient } from '../api/client.js';
import { promoteApk } from '../api/endpoints.js';
import { requireAccessToken } from '../auth/session.js';
import { loadApkManifest } from '../config/apk-load.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { logger } from '../util/logger.js';

export interface ApkPromoteOptions {
  cwd: string;
  /// 0–100 rollout percentage for the staged release.
  rollout: number;
  /// "rolling" (default) or "published".
  status?: string;
}

/// `i99dash apk promote --rollout N` — move the latest approved release of
/// the project's package to a rolling release at N%. Ramp 5→10→25→50→100.
/// force_update / min_supported_version_code are admin-only (D4) — not here.
export async function runApkPromote(opts: ApkPromoteOptions): Promise<void> {
  const manifest = await loadApkManifest(opts.cwd);
  const token = await requireAccessToken();
  const api = new ApiClient(resolvedBackendUrl(), token);
  const res = await promoteApk(api, manifest.id, opts.rollout, opts.status);
  logger.success(
    `promoted ${manifest.id} v${res.versionCode} → ${res.status} @ ${res.rolloutPercent}%`,
  );
}
