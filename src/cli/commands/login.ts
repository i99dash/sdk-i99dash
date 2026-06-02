import { getKeychain } from '../auth/keychain.js';
import { saveAccessToken } from '../auth/session.js';
import { loadKey, SshKeyEncryptedError, SshKeyError } from '../auth/ssh.js';
import { SshLoginClient } from '../auth/ssh-login.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { ServerError } from '../util/errors.js';
import { logger } from '../util/logger.js';

export interface LoginOptions {
  /// CI mode — don't attempt login. Callers that set `I99DASH_TOKEN`
  /// bypass `login` entirely; this flag is an explicit "don't do
  /// anything" toggle for scripts that accidentally invoked `login`.
  ci: boolean;
  /// SSH private key path (default ~/.ssh/id_ed25519).
  key?: string;
  /// Passphrase for an encrypted key.
  passphrase?: string;
  /// Paste a credential directly, skipping the SSH flow.
  token?: string;
}

/// Authenticate with an SSH key: sign a one-time challenge with the
/// local private key and trade it for an access token. The first key is
/// registered in the web console (Account -> SSH keys); the CLI can't
/// add a key before it's authenticated (the GitHub model).
export async function runLogin(opts: LoginOptions): Promise<void> {
  if (opts.ci) {
    logger.info('`--ci` passed; set I99DASH_TOKEN in env instead of running login.');
    return;
  }

  let token: string;
  if (opts.token) {
    token = opts.token;
  } else {
    let loaded;
    try {
      loaded = loadKey(opts.key, opts.passphrase);
    } catch (err) {
      if (err instanceof SshKeyEncryptedError) {
        logger.error('SSH key is passphrase-protected — re-run with `--passphrase <pass>`.');
      } else if (err instanceof SshKeyError) {
        logger.error(err.message);
      }
      throw err;
    }

    const client = new SshLoginClient(resolvedBackendUrl());
    logger.info(`signing in with key ${loaded.fingerprint}`);
    const nonce = await client.challenge(loaded.fingerprint);
    const signature = loaded.sign(Buffer.from(nonce, 'utf8')).toString('base64');

    try {
      token = await client.verify(nonce, signature);
    } catch (err) {
      if (err instanceof ServerError && err.apiCode === 'SSH_CHALLENGE_INVALID') {
        logger.error(
          "this key isn't registered yet. Add its PUBLIC key in the web console " +
            '(Account -> SSH keys), then run `i99dash login` again.',
        );
      }
      throw err;
    }
  }

  await saveAccessToken(token);
  const store = await getKeychain();
  logger.success(
    store.isSecure
      ? 'logged in — token stored in OS keychain.'
      : 'logged in — token stored in config file (0600).',
  );
}
