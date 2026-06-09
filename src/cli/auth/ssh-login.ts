/// HTTP client for the SSH-key login challenge/verify against the
/// i99dash backend (`/api/v1/auth/ssh/{challenge,verify}`). Both are
/// public (no bearer) and return the standard `{success,data,error}`
/// envelope — unlike the removed device-code endpoints, which were
/// spec-raw. Network errors funnel through [NetworkError]; protocol
/// errors through [ServerError] (carrying the backend `error.code`).

import { z } from 'zod';
import { NetworkError, ServerError } from '../util/errors.js';
import type { LoadedKey } from './ssh.js';

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

export class SshLoginClient {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly backendUrl: string,
    fetchFn?: typeof fetch,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /// Ask for a one-time nonce bound to this key's fingerprint.
  async challenge(fingerprint: string): Promise<string> {
    const data = await this.post('/api/v1/auth/ssh/challenge', { fingerprint });
    return z.object({ nonce: z.string().min(1) }).parse(data).nonce;
  }

  /// Trade the signature over the nonce for a token. Pass `scope: 'publish'`
  /// to mint a narrow publish-scoped token (the CI credential) instead of a
  /// full session — required for an `attest`-purpose key.
  async verify(nonce: string, signatureBase64: string, scope?: string): Promise<string> {
    const data = await this.post('/api/v1/auth/ssh/verify', {
      nonce,
      signature: signatureBase64,
      ...(scope ? { scope } : {}),
    });
    return z.object({ access_token: z.string().min(1) }).parse(data).access_token;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = this.backendUrl.replace(/\/$/, '') + path;
    let resp: Response;
    try {
      resp = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new NetworkError(`could not reach ${this.backendUrl}`, err);
    }
    const json = (await resp.json().catch(() => null)) as Envelope | null;
    if (!resp.ok || !json?.success) {
      throw new ServerError(
        resp.status,
        json?.error?.code,
        json?.error?.message ?? `HTTP ${resp.status}`,
      );
    }
    return json.data;
  }
}

/// Sign the SSH challenge with `loaded` and obtain a PUBLISH-scoped token.
/// This is what `apk publish` uses in CI: provide the SSH key (which also
/// signs the K1 artifact attestation) and the publish flow mints its own
/// short-lived, publish-only credential — no long-lived token to store, and
/// the token can't be used outside the native-publish surface.
export async function mintPublishToken(
  backendUrl: string,
  loaded: LoadedKey,
  fetchFn?: typeof fetch,
): Promise<string> {
  const client = new SshLoginClient(backendUrl, fetchFn);
  const nonce = await client.challenge(loaded.fingerprint);
  const signature = loaded.sign(Buffer.from(nonce, 'utf8')).toString('base64');
  return client.verify(nonce, signature, 'publish');
}
