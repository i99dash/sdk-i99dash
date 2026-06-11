import { describe, it, expect } from 'vitest';
import { HostBridge, isCarBridge, isCapabilitiesBridge, isFamilyBridge } from '../bridge.js';
import type { Bridge } from '../bridge.js';
import { BridgeTransportError, NotInsideHostError } from '../errors.js';

describe('HostBridge', () => {
  it('throws NotInsideHostError when given a windowLike with no bridge', () => {
    expect(() => new HostBridge({})).toThrow(NotInsideHostError);
  });

  it('throws NotInsideHostError when bridge has no callHandler', () => {
    expect(() => new HostBridge({ __i99dashHost: {} as never })).toThrow(NotInsideHostError);
  });

  it('proxies getContext through callHandler("getContext")', async () => {
    const calls: Array<[string, unknown[]]> = [];
    const host = new HostBridge({
      __i99dashHost: {
        callHandler: async (name, ...args) => {
          calls.push([name, args]);
          return { ok: true };
        },
      },
    });
    const res = await host.getContext();
    expect(calls).toEqual([['getContext', []]]);
    expect(res).toEqual({ ok: true });
  });

  it('falls back to the legacy global when branded is absent', async () => {
    const host = new HostBridge({
      flutter_inappwebview: {
        callHandler: async () => 'legacy',
      },
    });
    const res = await host.getContext();
    expect(res).toBe('legacy');
  });

  it('prefers the branded global over the legacy one', async () => {
    const host = new HostBridge({
      __i99dashHost: { callHandler: async () => 'branded' },
      flutter_inappwebview: { callHandler: async () => 'legacy' },
    });
    const res = await host.getContext();
    expect(res).toBe('branded');
  });

  it('wraps bridge rejections into BridgeTransportError', async () => {
    const host = new HostBridge({
      __i99dashHost: {
        callHandler: async () => {
          throw new Error('native boom');
        },
      },
    });
    await expect(host.getContext()).rejects.toBeInstanceOf(BridgeTransportError);
  });

  it('exposes callHandler so CarController can reach v2 car.* handlers', async () => {
    const host = new HostBridge({
      __i99dashHost: {
        callHandler: async (name, payload) =>
          ({ ack: name, echo: payload }) as Record<string, unknown>,
      },
    });
    expect(isCarBridge(host)).toBe(true);
    const r = await host.callHandler('car.list', { category: 'climate' });
    expect(r).toEqual({ ack: 'car.list', echo: { category: 'climate' } });
  });

  it('also implements CapabilitiesBridge and FamilyBridge', () => {
    const host = new HostBridge({
      __i99dashHost: { callHandler: async () => null },
    });
    expect(isCapabilitiesBridge(host)).toBe(true);
    expect(isFamilyBridge(host)).toBe(true);
  });

  it('plain Bridge stubs do not satisfy isCarBridge', () => {
    const plain: Bridge = {
      getContext: async () => null,
    };
    expect(isCarBridge(plain)).toBe(false);
  });
});
