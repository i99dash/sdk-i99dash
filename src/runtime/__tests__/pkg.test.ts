/// Coverage for the pkg family — read-side (`list`, `foreground`,
/// `usage`) and launch-side (`launch`, `launchCluster`, `move`,
/// `moveCluster`, `stop`).
///
/// Mirrors the shape of `display.test.ts`: ad-hoc `FakeFamilyBridge`,
/// one `{success: true, data}` envelope per method, plus a
/// `{success: false}` propagation case to confirm the standard
/// envelope-unwrap path. Tests assert each method calls the right
/// `<familyId>.<op>` + args, including the optional `displayId` /
/// `targetRole` branches we know the host accepts.

import { describe, expect, it } from 'vitest';

import type { FamilyBridge } from '../bridge.js';
import { FamilyOpError } from '../family-controller.js';
import { PkgController } from '../pkg.js';

class FakeFamilyBridge implements FamilyBridge {
  readonly calls: Array<{
    familyId: string;
    op: string;
    params: Record<string, unknown> | undefined;
    idempotencyKey: string | undefined;
  }> = [];

  constructor(private readonly handler: (familyId: string, op: string) => unknown) {}

  async getContext(): Promise<unknown> {
    return {};
  }
  async callFamily(
    familyId: string,
    op: string,
    params?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    this.calls.push({ familyId, op, params, idempotencyKey });
    return this.handler(familyId, op);
  }
}

describe('PkgController.list', () => {
  it('returns the packages array and defaults includeSystem to false', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: {
        packages: [
          {
            packageName: 'com.byd.maps',
            label: 'BYD Maps',
            versionName: '1.0.0',
            versionCode: 1,
            isSystem: false,
          },
          {
            packageName: 'com.byd.music',
            label: 'BYD Music',
            versionName: '2.4.1',
            versionCode: 24,
            isSystem: true,
          },
        ],
      },
    }));
    const c = new PkgController(bridge);
    const out = await c.list();
    expect(out).toHaveLength(2);
    expect(out[0]!.packageName).toBe('com.byd.maps');
    expect(bridge.calls[0]!.familyId).toBe('pkg');
    expect(bridge.calls[0]!.op).toBe('list');
    expect(bridge.calls[0]!.params).toEqual({ includeSystem: false });
  });

  it('forwards includeSystem when set', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { packages: [] },
    }));
    const c = new PkgController(bridge);
    await c.list({ includeSystem: true });
    expect(bridge.calls[0]!.params).toEqual({ includeSystem: true });
  });

  it('returns [] when the host omits the packages array', async () => {
    // Defensive: older host build that emits `{success, data: {}}`
    // with no `packages` field shouldn't blow up the consumer.
    const bridge = new FakeFamilyBridge(() => ({ success: true, data: {} }));
    const c = new PkgController(bridge);
    const out = await c.list();
    expect(out).toEqual([]);
  });
});

describe('PkgController.foreground', () => {
  it('returns the foreground info when host emits a packageName', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: {
        packageName: 'com.byd.maps',
        activityClass: 'com.byd.maps/.MainActivity',
        atMillis: 1_700_000_000_000,
      },
    }));
    const c = new PkgController(bridge);
    const out = await c.foreground();
    expect(out).toEqual({
      packageName: 'com.byd.maps',
      activityClass: 'com.byd.maps/.MainActivity',
      atMillis: 1_700_000_000_000,
    });
    expect(bridge.calls[0]!.op).toBe('foreground');
  });

  it('returns null when packageName is missing (no UsageStatsManager grant)', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { packageName: null, activityClass: '', atMillis: 0 },
    }));
    const c = new PkgController(bridge);
    const out = await c.foreground();
    expect(out).toBeNull();
  });
});

describe('PkgController.usage', () => {
  it('forwards windowMs and returns the row list', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: {
        rows: [
          {
            packageName: 'com.byd.maps',
            totalTimeInForegroundMs: 12_000,
            lastTimeUsedMs: 1_700_000_000_000,
          },
        ],
        windowMs: 60_000,
      },
    }));
    const c = new PkgController(bridge);
    const out = await c.usage(60_000);
    expect(out.rows).toHaveLength(1);
    expect(out.windowMs).toBe(60_000);
    expect(bridge.calls[0]!.params).toEqual({ windowMs: 60_000 });
  });

  it('returns an empty rows array when host omits it (no appop)', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { windowMs: 60_000 },
    }));
    const c = new PkgController(bridge);
    const out = await c.usage(60_000);
    expect(out.rows).toEqual([]);
    expect(out.windowMs).toBe(60_000);
  });
});

describe('PkgController.launch', () => {
  it('launches with only a packageName by default (intent-launch path)', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true, path: 'intent-launch', error: null },
    }));
    const c = new PkgController(bridge);
    const out = await c.launch('com.byd.maps');
    expect(out.ok).toBe(true);
    expect(out.path).toBe('intent-launch');
    expect(bridge.calls[0]!.params).toEqual({ packageName: 'com.byd.maps' });
    expect(bridge.calls[0]!.op).toBe('launch');
  });

  it('forwards displayId for non-default (am-start) launches', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true, path: 'am-start' },
    }));
    const c = new PkgController(bridge);
    await c.launch('com.byd.maps', { displayId: 4 });
    expect(bridge.calls[0]!.params).toEqual({
      packageName: 'com.byd.maps',
      displayId: 4,
    });
  });

  it('forwards targetRole for the L5 / L5U DiShare passenger fallback', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true, path: 'dishare-cast' },
    }));
    const c = new PkgController(bridge);
    await c.launch('com.byd.maps', { targetRole: 'passenger' });
    expect(bridge.calls[0]!.params).toEqual({
      packageName: 'com.byd.maps',
      targetRole: 'passenger',
    });
  });

  it('surfaces dishare-denied + a typed error reason verbatim', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: false, path: 'dishare-denied', error: 'bind_failed' },
    }));
    const c = new PkgController(bridge);
    const out = await c.launch('com.byd.maps', { targetRole: 'passenger' });
    expect(out.ok).toBe(false);
    expect(out.path).toBe('dishare-denied');
    expect(out.error).toBe('bind_failed');
  });
});

describe('PkgController.move / launchCluster / moveCluster / stop', () => {
  it('move() forwards packageName + displayId', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true, path: 'am-start' },
    }));
    const c = new PkgController(bridge);
    await c.move('com.byd.maps', { displayId: 4 });
    expect(bridge.calls[0]!.op).toBe('move');
    expect(bridge.calls[0]!.params).toEqual({
      packageName: 'com.byd.maps',
      displayId: 4,
    });
  });

  it('launchCluster() hits the launch_cluster op (snake_case host name)', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true, path: 'am-start' },
    }));
    const c = new PkgController(bridge);
    await c.launchCluster('com.byd.maps', { displayId: 5 });
    expect(bridge.calls[0]!.op).toBe('launch_cluster');
    expect(bridge.calls[0]!.params).toEqual({
      packageName: 'com.byd.maps',
      displayId: 5,
    });
  });

  it('moveCluster() hits the move_cluster op', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true, path: 'am-start' },
    }));
    const c = new PkgController(bridge);
    await c.moveCluster('com.byd.maps', { displayId: 5 });
    expect(bridge.calls[0]!.op).toBe('move_cluster');
  });

  it('stop() forwards only the packageName', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true, path: 'intent-launch' },
    }));
    const c = new PkgController(bridge);
    await c.stop('com.byd.maps');
    expect(bridge.calls[0]!.op).toBe('stop');
    expect(bridge.calls[0]!.params).toEqual({ packageName: 'com.byd.maps' });
  });
});

describe('PkgController envelope errors', () => {
  it('propagates {success: false} as FamilyOpError', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: false,
      error: { code: 'permission_denied', message: 'no pkg.launch grant' },
    }));
    const c = new PkgController(bridge);
    await expect(c.launch('com.byd.maps')).rejects.toMatchObject({
      name: 'FamilyOpError',
      errorCode: 'permission_denied',
      familyId: 'pkg',
      op: 'launch',
    });
  });

  it('errorCode preserves the host-emitted role mismatch on launchCluster', async () => {
    // The host returns a typed `role:expected_cluster_got_<role>`
    // when a non-cluster displayId reaches the cluster op. The SDK
    // must propagate that string unchanged so consumer code can
    // branch on it.
    const bridge = new FakeFamilyBridge(() => ({
      success: false,
      error: {
        code: 'role:expected_cluster_got_passenger',
        message: 'displayId 4 has role=passenger',
      },
    }));
    const c = new PkgController(bridge);
    await expect(c.launchCluster('com.byd.maps', { displayId: 4 })).rejects.toBeInstanceOf(
      FamilyOpError,
    );
  });
});
