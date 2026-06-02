import { clearAccessToken } from '../auth/session.js';
import { logger } from '../util/logger.js';

/// `i99dash logout` — drop the locally-stored access token.
///
/// Logging in mints a short-lived JWT from an SSH-key challenge; there's
/// no long-lived server-side credential to revoke here. To stop a key
/// from being able to log in at all, remove it with `i99dash keys remove
/// <id>` (or in the web console under Account → SSH keys).
export async function runLogout(): Promise<void> {
  await clearAccessToken();
  logger.success('logged out — local credential removed.');
}
