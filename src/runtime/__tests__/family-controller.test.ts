/// Tests for [BaseFamilyController] + the family bridge plumbing.
/// Single test file covers the shared base + the two concrete
/// controllers; their concrete methods are thin wrappers over
/// `invoke()`.

import { describe, it, expect } from 'vitest';

import type { FamilyBridge, Bridge } from '../bridge.js';
import { isFamilyBridge } from '../bridge.js';
import { DisplayController } from '../display.js';
import {
  FamilyOpError,
  FamilyUnavailableError,
  decodeFamilyEnvelope,
  invokeFamily,
  newIdempotencyKey,
} from '../family-controller.js';
import { SURFACE_ROUTE_REGEX, SurfaceController, SurfaceRouteError } from '../surface.js';

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

class NonFamilyBridge implements Bridge {
  async getContext(): Promise<unknown> {
    return {};
  }
}

describe('isFamilyBridge', () => {
  it('returns true for a bridge with callFamily', () => {
    const b = new FakeFamilyBridge(() => ({ success: true, data: {} }));
    expect(isFamilyBridge(b)).toBe(true);
  });
  it('returns false for a plain Bridge', () => {
    expect(isFamilyBridge(new NonFamilyBridge())).toBe(false);
  });
});

describe('decodeFamilyEnvelope', () => {
  it('returns data on success', () => {
    expect(
      decodeFamilyEnvelope<{ x: 1 }>('display', 'list', {
        success: true,
        data: { x: 1 },
      }),
    ).toEqual({ x: 1 });
  });
  it('throws FamilyOpError on failure', () => {
    expect(() =>
      decodeFamilyEnvelope('surface', 'create', {
        success: false,
        error: { code: 'surface_denied', message: 'no display' },
      }),
    ).toThrow(FamilyOpError);
  });
  it('throws FamilyOpError on malformed envelope', () => {
    expect(() => decodeFamilyEnvelope('display', 'list', { junk: true })).toThrow(FamilyOpError);
  });
});

describe('BaseFamilyController construction', () => {
  it('throws FamilyUnavailableError on a bridge without callFamily', () => {
    expect(() => new DisplayController(new NonFamilyBridge())).toThrow(FamilyUnavailableError);
  });
});

describe('DisplayController', () => {
  it('list() unwraps {displays: [...]}', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: {
        displays: [
          {
            id: 0,
            name: 'IVI',
            width: 1920,
            height: 1200,
            densityDpi: 240,
            isDefault: true,
            isPresentation: false,
            isCluster: false,
          },
          {
            id: 4,
            name: 'shared_fission_bg_XDJAScreenProjection_0',
            width: 1920,
            height: 720,
            densityDpi: 320,
            isDefault: false,
            isPresentation: true,
            isCluster: true,
          },
        ],
      },
    }));
    const c = new DisplayController(bridge);
    const out = await c.list();
    expect(out.displays).toHaveLength(2);
    expect(out.displays[1]!.isCluster).toBe(true);
    // No vehicle block in this fixture — the host can omit it (older
    // builds, dev runner) and `list()` must still return cleanly.
    expect(out.vehicle).toBeUndefined();
    expect(bridge.calls[0]!.familyId).toBe('display');
    expect(bridge.calls[0]!.op).toBe('list');
    expect(bridge.calls[0]!.idempotencyKey).toBeTruthy();
  });

  it('propagates surface errors as FamilyOpError', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: false,
      error: { code: 'permission_denied', message: 'no grant' },
    }));
    const c = new DisplayController(bridge);
    await expect(c.list()).rejects.toMatchObject({
      name: 'FamilyOpError',
      errorCode: 'permission_denied',
    });
  });
});

describe('SurfaceController', () => {
  it('create() round-trips displayId + route', async () => {
    const bridge = new FakeFamilyBridge((_fam, _op) => ({
      success: true,
      data: {
        surfaceId: 'sfc_abc',
        path: 'presentation',
        displayId: 4,
        route: '/cluster',
      },
    }));
    const c = new SurfaceController(bridge);
    const out = await c.create({ displayId: 4, route: '/cluster' });
    expect(out.surfaceId).toBe('sfc_abc');
    expect(out.path).toBe('presentation');
    expect(bridge.calls[0]!.params).toEqual({
      displayId: 4,
      route: '/cluster',
    });
  });

  it('falls back to overlay path is reported transparently', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: {
        surfaceId: 'sfc_xyz',
        path: 'overlay',
        displayId: 4,
        route: '/',
      },
    }));
    const c = new SurfaceController(bridge);
    const out = await c.create({ displayId: 4 });
    expect(out.path).toBe('overlay');
  });

  it('destroy() forwards surfaceId only', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true },
    }));
    const c = new SurfaceController(bridge);
    await c.destroy({ surfaceId: 'sfc_a' });
    expect(bridge.calls[0]!.params).toEqual({ surfaceId: 'sfc_a' });
  });

  it('idempotency key is generated per call', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: true,
      data: { ok: true },
    }));
    const c = new SurfaceController(bridge);
    await c.destroy({ surfaceId: 'sfc_a' });
    await c.destroy({ surfaceId: 'sfc_b' });
    expect(bridge.calls).toHaveLength(2);
    expect(bridge.calls[0]!.idempotencyKey).not.toEqual(bridge.calls[1]!.idempotencyKey);
  });
});

describe('DisplayController.onChange', () => {
  /// Bridge that resolves subscribe + unsubscribe ops with stable
  /// envelopes. Tests then dispatch on the `__i99dashEvents` global
  /// to simulate native pushes.
  function eventfulBridge(): FakeFamilyBridge {
    return new FakeFamilyBridge((_fam, op) => {
      if (op === 'subscribe') return { success: true, data: { id: 'sub_0' } };
      if (op === 'unsubscribe') return { success: true, data: { ok: true } };
      throw new Error(`unexpected op: ${op}`);
    });
  }

  it('routes events through the listener', async () => {
    // jsdom-ish: spin a minimal window with events container.
    (globalThis as unknown as { window: unknown }).window = globalThis;
    const bridge = eventfulBridge();
    const c = new DisplayController(bridge);
    const received: unknown[] = [];

    const off = await c.onChange((evt) => received.push(evt));
    expect(bridge.calls[0]!.op).toBe('subscribe');

    // Dispatch a fake host push. The base controller installed a
    // listener on the `display` channel via ensureHostEvents; the
    // global is shared across this test file's controllers.
    const events = (
      globalThis as { __i99dashEvents?: { dispatch: (c: string, p: unknown) => void } }
    ).__i99dashEvents;
    events?.dispatch('display', { type: 'added', displayId: 4 });
    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe('added');

    off();
    // Subsequent push doesn't reach the listener.
    events?.dispatch('display', { type: 'removed', displayId: 4 });
    expect(received).toHaveLength(1);
    // unsubscribe op fired host-side.
    expect(bridge.calls.some((c) => c.op === 'unsubscribe')).toBe(true);
  });

  it('unsubscribe is idempotent', async () => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    const bridge = eventfulBridge();
    const c = new DisplayController(bridge);
    const off = await c.onChange(() => {});
    off();
    off(); // no throw
    // Only one unsubscribe op should fire on the host side.
    const unsubCalls = bridge.calls.filter((c) => c.op === 'unsubscribe');
    expect(unsubCalls).toHaveLength(1);
  });

  it('rolls back local listener if host subscribe fails', async () => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    const bridge = new FakeFamilyBridge(() => ({
      success: false,
      error: { code: 'permission_denied', message: 'no grant' },
    }));
    const c = new DisplayController(bridge);
    await expect(c.onChange(() => {})).rejects.toMatchObject({
      name: 'FamilyOpError',
      errorCode: 'permission_denied',
    });
    // No unsubscribe op should fire since we never registered host-side.
    expect(bridge.calls.every((c) => c.op !== 'unsubscribe')).toBe(true);
  });
});

describe('invokeFamily (free-function path)', () => {
  it('decodes a success envelope and forwards params', async () => {
    const bridge = new FakeFamilyBridge((_fam, _op) => ({
      success: true,
      data: { hello: 'world' },
    }));
    const out = await invokeFamily<{ hello: string }>(bridge, 'pkg', 'launch', { id: 'x.y' });
    expect(out).toEqual({ hello: 'world' });
    expect(bridge.calls[0]!.familyId).toBe('pkg');
    expect(bridge.calls[0]!.op).toBe('launch');
    expect(bridge.calls[0]!.params).toEqual({ id: 'x.y' });
    expect(bridge.calls[0]!.idempotencyKey).toBeTruthy();
  });

  it('uses caller-supplied idempotencyKey when provided', async () => {
    const bridge = new FakeFamilyBridge(() => ({ success: true, data: {} }));
    await invokeFamily(bridge, 'pkg', 'launch', {}, { idempotencyKey: 'caller-key' });
    expect(bridge.calls[0]!.idempotencyKey).toBe('caller-key');
  });

  it('throws FamilyUnavailableError on a non-family bridge', async () => {
    await expect(invokeFamily(new NonFamilyBridge(), 'pkg', 'launch')).rejects.toThrow(
      FamilyUnavailableError,
    );
  });

  it('throws FamilyOpError on {success: false}', async () => {
    const bridge = new FakeFamilyBridge(() => ({
      success: false,
      error: { code: 'denied', message: 'nope' },
    }));
    await expect(invokeFamily(bridge, 'surface', 'create')).rejects.toMatchObject({
      name: 'FamilyOpError',
      errorCode: 'denied',
    });
  });
});

describe('newIdempotencyKey', () => {
  it('returns a non-empty string', () => {
    const k = newIdempotencyKey();
    expect(typeof k).toBe('string');
    expect(k.length).toBeGreaterThan(0);
  });
  it('returns a different value each call', () => {
    // 1000 calls; collision probability of randomUUID is ~0 here.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newIdempotencyKey());
    expect(seen.size).toBe(1000);
  });
});

describe('SurfaceController.buildRoute', () => {
  it('returns the bare path when no params', () => {
    expect(SurfaceController.buildRoute('/cluster.html')).toBe('/cluster.html');
  });

  it('encodes a single param as ?k=v', () => {
    expect(SurfaceController.buildRoute('/cluster.html', { layout: 'abc' })).toBe(
      '/cluster.html?layout=abc',
    );
  });

  it('joins multiple params with &', () => {
    const route = SurfaceController.buildRoute('/x', { a: '1', b: '2' });
    expect(route).toBe('/x?a=1&b=2');
  });

  it('coerces numbers and booleans', () => {
    expect(SurfaceController.buildRoute('/x', { n: 42, b: true })).toBe('/x?n=42&b=true');
  });

  it('drops null and undefined params', () => {
    expect(SurfaceController.buildRoute('/x', { a: '1', b: null, c: undefined })).toBe('/x?a=1');
  });

  it("re-encodes ' ( ) which encodeURIComponent leaves raw", () => {
    const route = SurfaceController.buildRoute('/x', { v: "a'b(c)" });
    expect(route).toBe('/x?v=a%27b%28c%29');
    expect(SURFACE_ROUTE_REGEX.test(route)).toBe(true);
  });

  it('produces a route that passes the host regex for the gauge-builder case', () => {
    // The exact shape that tripped gauge-builder v0.1.6 — base64 with `=`
    // padding, in a query param. v0.1.7 fixed by using `?` instead of `#`.
    const encoded = btoa(JSON.stringify({ slots: [null, 'rpm', null], version: 1 }));
    const route = SurfaceController.buildRoute('/cluster.html', { layout: encoded });
    expect(SURFACE_ROUTE_REGEX.test(route)).toBe(true);
  });

  it('throws SurfaceRouteError on an empty path', () => {
    expect(() => SurfaceController.buildRoute('')).toThrow(SurfaceRouteError);
  });

  it("throws SurfaceRouteError on a path missing leading '/'", () => {
    expect(() => SurfaceController.buildRoute('cluster.html')).toThrow(SurfaceRouteError);
  });

  it('throws SurfaceRouteError on a path with forbidden chars', () => {
    expect(() => SurfaceController.buildRoute('/cluster?foo')).toThrow(SurfaceRouteError);
    expect(() => SurfaceController.buildRoute('/cluster#x')).toThrow(SurfaceRouteError);
    expect(() => SurfaceController.buildRoute('/cluster space')).toThrow(SurfaceRouteError);
  });
});

describe('SURFACE_ROUTE_REGEX', () => {
  it('matches bundle-relative paths', () => {
    expect(SURFACE_ROUTE_REGEX.test('/')).toBe(true);
    expect(SURFACE_ROUTE_REGEX.test('/foo')).toBe(true);
    expect(SURFACE_ROUTE_REGEX.test('/foo/bar.html')).toBe(true);
  });

  it('matches paths with query strings (including # inside query)', () => {
    expect(SURFACE_ROUTE_REGEX.test('/cluster.html?layout=abc')).toBe(true);
    expect(SURFACE_ROUTE_REGEX.test('/x?a=1&b=2')).toBe(true);
    expect(SURFACE_ROUTE_REGEX.test('/x?a=#hash')).toBe(true);
  });

  it('rejects bare #fragment URLs (the gauge-builder v0.1.6 trap)', () => {
    expect(SURFACE_ROUTE_REGEX.test('/cluster.html#layout=abc')).toBe(false);
  });

  it("rejects ' ( ) which encodeURIComponent leaves raw", () => {
    expect(SURFACE_ROUTE_REGEX.test("/x?v=a'b")).toBe(false);
    expect(SURFACE_ROUTE_REGEX.test('/x?v=a(b)')).toBe(false);
  });

  it('rejects paths without leading slash', () => {
    expect(SURFACE_ROUTE_REGEX.test('foo')).toBe(false);
  });
});
