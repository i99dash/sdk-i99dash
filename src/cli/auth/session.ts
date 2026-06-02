import { NotAuthenticatedError } from '../util/errors.js';
import { getKeychain } from './keychain.js';

/// Returns the current access token, or throws [NotAuthenticatedError].
///
/// A CI-friendly escape hatch: `I99DASH_TOKEN` env var wins over the
/// keychain entry if set, so pipelines can inject a token minted by
/// `i99dash login` (SSH-key flow) without touching the local keychain.
/// Documented in `docs/onboard/auth.md`.
export async function requireAccessToken(): Promise<string> {
  const envToken = process.env['I99DASH_TOKEN'];
  if (envToken && envToken.length > 0) return envToken;
  const store = await getKeychain();
  const token = await store.get();
  if (!token) throw new NotAuthenticatedError();
  return token;
}

export async function saveAccessToken(token: string): Promise<void> {
  const store = await getKeychain();
  await store.set(token);
}

export async function clearAccessToken(): Promise<void> {
  const store = await getKeychain();
  await store.clear();
}
