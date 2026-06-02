import { ApiClient } from '../api/client.js';
import { getDevStatus, type DevStatus, type DevStatusApp } from '../api/endpoints.js';
import { requireAccessToken } from '../auth/session.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { logger } from '../util/logger.js';

interface RunStatusOptions {
  /** Filter the apps list to a single app_id. */
  appId?: string | undefined;
}

/**
 * `i99dash status [app_id]` — single round-trip snapshot of the
 * developer's lifecycle: developer-access state, apps with review
 * status, and any recent notification-delivery errors.
 *
 * Renders as a compact terminal report. The backend caps the apps
 * array at 50; `appsTotal > 50` triggers a "showing 50 of N — use
 * --app-id to filter" hint.
 */
export async function runStatus({ appId }: RunStatusOptions): Promise<void> {
  const token = await requireAccessToken();
  const api = new ApiClient(resolvedBackendUrl(), token);
  const snapshot = await getDevStatus(api, appId);
  printStatus(snapshot);
}

function printStatus(s: DevStatus): void {
  printAccessLine(s);

  if (s.lastNotificationError) {
    logger.warn(
      `Last Telegram delivery FAILED: ${s.lastNotificationError}. ` +
        'Check that you have re-subscribed to @i99dash_bot.',
    );
  }

  if (s.apps.length === 0) {
    logger.info('No apps published yet. Run `i99dash publish` to get started.');
  } else {
    logger.info(
      `Apps (${s.apps.length}${s.appsTotal > s.apps.length ? ` of ${s.appsTotal}` : ''}):`,
    );
    for (const app of s.apps) {
      logger.info(`  ${formatAppLine(app)}`);
      if (app.reviewStatus === 'rejected' && app.rejectionReason) {
        logger.info(`    reason: ${app.rejectionReason}`);
      }
    }
    if (s.appsTotal > s.apps.length) {
      logger.info(
        `  (showing ${s.apps.length} of ${s.appsTotal} — pass an app_id to see one specifically)`,
      );
    }
  }
}

function printAccessLine(s: DevStatus): void {
  if (s.isDeveloper) {
    logger.info('Developer access: ACTIVE');
    return;
  }
  if (s.hasPendingRequest) {
    logger.info(
      'Developer access: PENDING — admin review in progress. ' +
        "You'll receive a Telegram message when the request is reviewed.",
    );
    return;
  }
  logger.info('Developer access: NOT GRANTED. Visit the developer portal to request access.');
}

function formatAppLine(app: DevStatusApp): string {
  const status = app.reviewStatus.toUpperCase().padEnd(14);
  const beta = app.betaActive ? `  (beta: v${app.betaVersion ?? '?'})` : '';
  const published = app.lastPublishedAt ? `  ${formatRelative(app.lastPublishedAt)}` : '';
  return `${app.appId.padEnd(28)}  v${app.latestVersion.padEnd(10)}  ${status}${published}${beta}`;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}
