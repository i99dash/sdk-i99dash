import { describe, it, expect, vi } from 'vitest';
import type { Bridge, CapabilitiesBridge, FamilyBridge } from '../bridge.js';
import { MiniAppClient } from '../client.js';
import {
  BridgeTimeoutError,
  BridgeTransportError,
  InvalidResponseError,
  NotInsideHostError,
} from '../errors.js';
import { FamilyOpError, FamilyUnavailableError } from '../family-controller.js';

const validContext = {
  userId: 'u-1',
  activeCarId: 'VIN',
  locale: 'en',
  isDark: false,
  appVersion: '1.0.0',
  appId: 'fuel_prices',
} as const;

function bridgeReturning({
  context,
  delayMs = 0,
}: {
  context?: unknown;
  delayMs?: number;
}): Bridge {
  return {
    getContext: async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return context;
    },
  };
}

describe('MiniAppClient.fromWindow', () => {
  it('throws NotInsideHostError when window is undefined', () => {
    expect(() => MiniAppClient.fromWindow()).toThrow(NotInsideHostError);
  });
});

describe('MiniAppClient.getContext', () => {
  it('returns a schema-parsed context', async () => {
    const c = MiniAppClient.withBridge(bridgeReturning({ context: validContext }));
    const ctx = await c.getContext();
    expect(ctx.userId).toBe('u-1');
    expect(ctx.locale).toBe('en');
  });

  it('throws InvalidResponseError on malformed payload', async () => {
    const c = MiniAppClient.withBridge(
      bridgeReturning({ context: { ...validContext, locale: 'fr' } }),
    );
    await expect(c.getContext()).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('bubbles BridgeTransportError when the bridge rejects', async () => {
    const broken: Bridge = {
      getContext: async () => {
        throw new BridgeTransportError('boom', new Error('x'));
      },
    };
    const c = MiniAppClient.withBridge(broken);
    await expect(c.getContext()).rejects.toBeInstanceOf(BridgeTransportError);
  });

  it('respects timeoutMs', async () => {
    vi.useFakeTimers();
    const c = MiniAppClient.withBridge(bridgeReturning({ context: validContext, delayMs: 5_000 }));
    const p = c.getContext({ timeoutMs: 50 });
    // Pre-attach a noop catch so vitest doesn't flag a momentary
    // unhandled-rejection between the timer flush and the `await expect`.
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).rejects.toBeInstanceOf(BridgeTimeoutError);
    vi.useRealTimers();
  });

  it('rejects immediately on pre-aborted signal', async () => {
    const c = MiniAppClient.withBridge(bridgeReturning({ context: validContext }));
    const ac = new AbortController();
    ac.abort('user cancelled');
    await expect(c.getContext({ signal: ac.signal })).rejects.toBe('user cancelled');
  });
});

describe('MiniAppClient.capabilities + has', () => {
  it('returns the host-declared shape on a CapabilitiesBridge', async () => {
    const bridge: CapabilitiesBridge = {
      getContext: async () => validContext,
      capabilities: async () => ({
        bridgeVersion: '1.2.3',
        families: ['car.status', 'media.read'],
      }),
    };
    const c = MiniAppClient.withBridge(bridge);
    const caps = await c.capabilities();
    expect(caps.bridgeVersion).toBe('1.2.3');
    expect(caps.families).toEqual(['car.status', 'media.read']);
    expect(await c.has('media.read')).toBe(true);
    expect(await c.has('nav.read')).toBe(false);
  });

  it('memoises across calls', async () => {
    const handler = vi.fn(async () => ({ bridgeVersion: '1', families: ['car.status'] }));
    const bridge: CapabilitiesBridge = {
      getContext: async () => validContext,
      capabilities: handler,
    };
    const c = MiniAppClient.withBridge(bridge);
    await c.capabilities();
    await c.capabilities();
    await c.has('car.status');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('falls back to bridgeVersion=unknown on a host without the handshake', async () => {
    // Plain Bridge — no `capabilities` method.
    const c = MiniAppClient.withBridge(bridgeReturning({ context: validContext }));
    const caps = await c.capabilities();
    expect(caps.bridgeVersion).toBe('unknown');
    // Plain bridge has no car-status surface either, so families = []
    expect(caps.families).toEqual([]);
    expect(await c.has('car.status')).toBe(false);
  });

  it('rejects malformed capabilities payloads with InvalidResponseError', async () => {
    const bridge: CapabilitiesBridge = {
      getContext: async () => validContext,
      capabilities: async () => ({ wrong: 'shape' }),
    };
    const c = MiniAppClient.withBridge(bridge);
    await expect(c.capabilities()).rejects.toBeInstanceOf(InvalidResponseError);
  });
});

describe('MiniAppClient.callFamily', () => {
  function makeFamilyBridge(handler: (familyId: string, op: string) => unknown): {
    bridge: FamilyBridge;
    calls: Array<{
      familyId: string;
      op: string;
      params: Record<string, unknown> | undefined;
      idempotencyKey: string | undefined;
    }>;
  } {
    const calls: Array<{
      familyId: string;
      op: string;
      params: Record<string, unknown> | undefined;
      idempotencyKey: string | undefined;
    }> = [];
    const bridge: FamilyBridge = {
      getContext: async () => validContext,
      callFamily: async (familyId, op, params, idempotencyKey) => {
        calls.push({ familyId, op, params, idempotencyKey });
        return handler(familyId, op);
      },
    };
    return { bridge, calls };
  }

  it('forwards familyId / op / params and auto-generates an idempotency key', async () => {
    const { bridge, calls } = makeFamilyBridge(() => ({ success: true, data: { ok: true } }));
    const c = MiniAppClient.withBridge(bridge);
    const out = await c.callFamily<{ ok: boolean }>('pkg', 'launch', { id: 'x.y' });
    expect(out).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      familyId: 'pkg',
      op: 'launch',
      params: { id: 'x.y' },
    });
    expect(calls[0]!.idempotencyKey).toBeTruthy();
  });

  it('throws FamilyUnavailableError on a non-family bridge', async () => {
    const c = MiniAppClient.withBridge(bridgeReturning({ context: validContext }));
    await expect(c.callFamily('pkg', 'launch')).rejects.toBeInstanceOf(FamilyUnavailableError);
  });

  it('throws FamilyOpError on {success: false}', async () => {
    const { bridge } = makeFamilyBridge(() => ({
      success: false,
      error: { code: 'denied', message: 'nope' },
    }));
    const c = MiniAppClient.withBridge(bridge);
    await expect(c.callFamily('surface', 'create')).rejects.toBeInstanceOf(FamilyOpError);
  });
});
