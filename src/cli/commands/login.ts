import open from 'open';
import { BackendDeviceCodeClient } from '../auth/device-code.js';
import { saveAccessToken } from '../auth/session.js';
import { getKeychain } from '../auth/keychain.js';
import { OAUTH_CLIENT_ID, resolvedBackendUrl } from '../config/paths.js';
import { logger } from '../util/logger.js';
import { ServerError } from '../util/errors.js';

export interface LoginOptions {
  noOpen: boolean;
  /// CI mode — don't even attempt the device-code flow. Callers that
  /// set `I99DASH_API_KEY` bypass `login` entirely; this flag is just
  /// an explicit "don't poll anything" toggle for scripts that
  /// accidentally invoked `login`.
  ci: boolean;
}

export async function runLogin(opts: LoginOptions): Promise<void> {
  if (opts.ci) {
    logger.info('`--ci` passed; set I99DASH_API_KEY in env instead of running login.');
    return;
  }

  const client = new BackendDeviceCodeClient(resolvedBackendUrl(), OAUTH_CLIENT_ID);

  logger.info('requesting device code…');
  const grant = await client.authorize();

  const url = grant.verification_uri_complete ?? grant.verification_uri;
  logger.box(
    [`open this URL in a browser:`, `  ${url}`, `and enter the code:`, `  ${grant.user_code}`].join(
      '\n',
    ),
  );

  if (!opts.noOpen) {
    await open(url).catch(() => {
      logger.warn(`couldn't open browser automatically; visit ${url} manually.`);
    });
  }

  logger.start('waiting for authorization…');
  let token: string;
  try {
    token = await client.pollToken(grant.device_code, grant.interval, grant.expires_in);
  } catch (err) {
    if (err instanceof ServerError && err.apiCode === 'access_denied') {
      logger.error('authorization denied in the browser.');
      throw err;
    }
    throw err;
  }

  await saveAccessToken(token);
  const store = await getKeychain();
  logger.success(
    store.isSecure
      ? 'logged in — API key stored in OS keychain.'
      : 'logged in — API key stored in config file (0600).',
  );
}
