import { ApiClient } from '../api/client.js';
import { listMyApks } from '../api/endpoints.js';
import { requireAccessToken } from '../auth/session.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { logger } from '../util/logger.js';

export interface ApkStatusOptions {
  cwd: string;
}

/// `i99dash apk status` — list the caller's native apps with their review +
/// release state. Reads `/api/v1/apps/mine`.
export async function runApkStatus(_opts: ApkStatusOptions): Promise<void> {
  const token = await requireAccessToken();
  const api = new ApiClient(resolvedBackendUrl(), token);
  const apps = await listMyApks(api);
  if (apps.length === 0) {
    logger.info('no native apps published yet — run `i99dash apk publish`.');
    return;
  }
  for (const a of apps) {
    const id = String(a['packageId'] ?? '?');
    const vc = a['latestVersionCode'] ?? '?';
    const review = String(a['reviewStatus'] ?? '?');
    logger.info(`  ${id}  v${vc}  [${review}]`);
  }
}
