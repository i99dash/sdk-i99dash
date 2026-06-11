/// Integration test — proves the public surfaces of `@i99dash/sdk`
/// and `@i99dash/admin-sdk` compose against a single host-injected
/// global, with no leakage between handler names and a unified
/// error model that survives the package boundary.
///
/// Lives in `admin-sdk` (not `sdk`) because admin-sdk is the
/// topmost package — it imports from `@i99dash/sdk` directly, so
/// any cross-package regression shows up here first.

import { afterEach, describe, expect, it } from 'vitest';

import {
  BridgeTimeoutError,
  BridgeTransportError,
  MiniAppClient,
  NotInsideHostError,
  SDKError,
  resolveHostApi,
} from '../../runtime/index.js';

import { AdminClient } from '../client.js';
import { snapshotFromList, type CommandTemplate } from '../types.js';

const TIER1: CommandTemplate = {
  id: 'diag.tail_logs',
  permissionId: 'cmdExec.read',
  tier: 1,
  requiresStepUp: false,
  category: 'diagnostics',
  paramSchema: { lines: { type: 'int', min: 1, max: 1000, default: 100 } },
};

type CallHandler = (name: string, ...args: unknown[]) => Promise<unknown>;

interface WindowLike {
  __i99dashHost?: { callHandler: CallHandler };
}

function installHost(callHandler: CallHandler): {
  cleanup: () => void;
} {
  const w: WindowLike = { __i99dashHost: { callHandler } };
  // jsdom-free shim: install on globalThis so `typeof window !== 'undefined'`
  // succeeds inside both `MiniAppClient.fromWindow()` and
  // `AdminClient.fromWindow()`.
  (globalThis as unknown as { window?: WindowLike }).window = w;
  return {
    cleanup: () => {
      delete (globalThis as unknown as { window?: WindowLike }).window;
    },
  };
}

describe('sdk + admin-sdk integration — one window, both clients', () => {
  let cleanup = (): void => {};
  afterEach(() => cleanup());

  it('routes getContext and _admin.exec through one host', async () => {
    const seen: string[] = [];
    ({ cleanup } = installHost(async (name, ..._args) => {
      seen.push(name);
      switch (name) {
        case 'getContext':
          return {
            userId: 'u-1',
            activeCarId: 'VIN',
            locale: 'en',
            isDark: false,
            appVersion: '1.0.0',
            appId: 'diagnostics-pro',
          };
        case '_admin.exec':
          return { success: true, data: { lines: ['boot ok'] } };
        default:
          throw new Error(`unexpected handler: ${name}`);
      }
    }));

    const mini = MiniAppClient.fromWindow();
    const admin = AdminClient.fromWindow({
      context: { appId: 'diagnostics-pro', deviceId: 'byd:BYDMCKLE0PARD8801', brand: 'byd' },
      catalog: snapshotFromList([TIER1]),
    });

    const ctx = await mini.getContext();
    expect(ctx.appId).toBe('diagnostics-pro');

    const adminRes = await admin.tailLogs({ lines: 1 });
    expect(adminRes.success).toBe(true);
    if (adminRes.success) expect(adminRes.data.lines).toEqual(['boot ok']);

    // Both handler names hit the SAME host. No accidental
    // duplicate registration, no per-package window stub.
    expect(seen).toEqual(['getContext', '_admin.exec']);
  });

  it('resolveHostApi finds the same bridge both packages use', () => {
    ({ cleanup } = installHost(async () => undefined));
    const w = (globalThis as unknown as { window: WindowLike }).window;
    const api = resolveHostApi(w);
    expect(api).toBeDefined();
    // Same identity — both clients reach for `__i99dashHost`.
    expect(api).toBe(w.__i99dashHost);
  });

  it('NotInsideHostError fires identically from both clients', () => {
    // No window installed — both should throw the same class.
    expect(() => MiniAppClient.fromWindow()).toThrow(NotInsideHostError);
    expect(() =>
      AdminClient.fromWindow({
        context: { appId: 'x', deviceId: 'byd:BYDMCKLE0PARD8801', brand: 'byd' },
        catalog: snapshotFromList([]),
      }),
    ).toThrow(NotInsideHostError);
  });

  it('errors thrown via admin path are catchable as SDKError (the unified base)', async () => {
    ({ cleanup } = installHost(async (_name) => {
      throw new Error('host crashed');
    }));
    const admin = AdminClient.fromWindow({
      context: { appId: 'x', deviceId: 'byd:BYDMCKLE0PARD8801', brand: 'byd' },
      catalog: snapshotFromList([TIER1]),
    });
    let caught: unknown;
    try {
      await admin.tailLogs({ lines: 1 });
    } catch (e) {
      caught = e;
    }
    // The bridge wraps host crashes in BridgeTransportError. The
    // important property: `instanceof SDKError` works across the
    // package boundary — the error class identity from `@i99dash/sdk`
    // is the same one admin-sdk catches by.
    expect(caught).toBeInstanceOf(SDKError);
    expect(caught).toBeInstanceOf(BridgeTransportError);
    expect((caught as SDKError).code).toBe('BRIDGE_TRANSPORT');
    expect((caught as SDKError).docsUrl).toContain('bridge_transport');
    // Cause chain preserved across packages.
    expect((caught as Error).cause).toBeInstanceOf(Error);
  });

  it('timeoutMs flows through admin-sdk via the shared withTimeout helper', async () => {
    ({ cleanup } = installHost(async () => {
      // Hang forever; the timeout in the SDK should win.
      return new Promise(() => {});
    }));
    const admin = AdminClient.fromWindow({
      context: { appId: 'x', deviceId: 'byd:BYDMCKLE0PARD8801', brand: 'byd' },
      catalog: snapshotFromList([TIER1]),
    });
    // Convenience wrappers forward `InvokeOptions` end-to-end —
    // verifies the helper-passes-opts contract from the wrapper
    // through `invoke()` into `withTimeout()`.
    await expect(admin.tailLogs({ lines: 1 }, { timeoutMs: 25 })).rejects.toBeInstanceOf(
      BridgeTimeoutError,
    );
  });
});
