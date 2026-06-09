import { describe, expect, it, vi } from 'vitest';
import { mintPublishToken, SshLoginClient } from '../auth/ssh-login.js';
import type { LoadedKey } from '../auth/ssh.js';
import { ServerError } from '../util/errors.js';

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function bodyOf(fetchFn: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  return JSON.parse((fetchFn.mock.calls[call][1] as RequestInit).body as string);
}

const fakeKey: LoadedKey = {
  publicOpenssh: 'ssh-ed25519 AAAA',
  fingerprint: 'SHA256:fp',
  sign: (m: Buffer) => Buffer.from('SIG:' + m.toString('utf8')),
};

describe('SshLoginClient', () => {
  it('challenge returns the nonce from the envelope', async () => {
    const c = new SshLoginClient(
      'http://x',
      fetchReturning(200, { success: true, data: { nonce: 'N', expires_in: 120 } }),
    );
    expect(await c.challenge('SHA256:fp')).toBe('N');
  });

  it('verify returns the access token', async () => {
    const c = new SshLoginClient(
      'http://x',
      fetchReturning(200, { success: true, data: { access_token: 'TKT', token_type: 'bearer' } }),
    );
    expect(await c.verify('N', 'c2ln')).toBe('TKT');
  });

  it('maps an error envelope to ServerError carrying the apiCode', async () => {
    const c = new SshLoginClient(
      'http://x',
      fetchReturning(401, {
        success: false,
        error: { code: 'SSH_CHALLENGE_INVALID', message: 'unknown key' },
      }),
    );
    await expect(c.verify('N', 'c2ln')).rejects.toBeInstanceOf(ServerError);
    await expect(c.verify('N', 'c2ln')).rejects.toMatchObject({
      apiCode: 'SSH_CHALLENGE_INVALID',
    });
  });

  it('verify forwards scope in the request body when provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { access_token: 'T' } }),
    });
    const c = new SshLoginClient('http://x', fetchFn as unknown as typeof fetch);
    await c.verify('N', 'sig', 'publish');
    expect(bodyOf(fetchFn, 0).scope).toBe('publish');
  });

  it('verify omits scope when not provided (unchanged full-session path)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { access_token: 'T' } }),
    });
    const c = new SshLoginClient('http://x', fetchFn as unknown as typeof fetch);
    await c.verify('N', 'sig');
    expect('scope' in bodyOf(fetchFn, 0)).toBe(false);
  });
});

describe('mintPublishToken', () => {
  it('does challenge → sign nonce → verify(scope=publish) and returns the token', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { nonce: 'NONCE' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { access_token: 'PUBTOK' } }),
      });
    const tok = await mintPublishToken('http://x', fakeKey, fetchFn as unknown as typeof fetch);
    expect(tok).toBe('PUBTOK');
    // first call = challenge with the key fingerprint; second = verify(publish)
    expect(bodyOf(fetchFn, 0).fingerprint).toBe('SHA256:fp');
    expect(bodyOf(fetchFn, 1).scope).toBe('publish');
    expect(bodyOf(fetchFn, 1).nonce).toBe('NONCE');
  });
});
