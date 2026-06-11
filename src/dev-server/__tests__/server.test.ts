import { describe, it, expect } from 'vitest';

import { buildServer } from '../server.js';
import { NativeCapStore } from '../state/native-cap-store.js';
import { StateStore } from '../state/state-store.js';

/// Test helper. Each test gets fresh stores so suite order can't
/// matter — particularly important for the in-memory NativeCapStore
/// whose surfaces / boot rows accumulate within a server lifetime.
function makeBuildServerOpts(state: StateStore) {
  return {
    state,
    nativeCap: new NativeCapStore('x'),
  };
}

const initialState = {
  context: {
    userId: 'u',
    activeCarId: 'V',
    locale: 'en' as const,
    isDark: false,
    appVersion: '1.0.0',
    appId: 'x',
  },
  speedKmh: 0,
};

describe('dev-server routes', () => {
  it('GET /_sdk/bridge.js returns the shim JS', async () => {
    const app = await buildServer(makeBuildServerOpts(new StateStore(initialState)));
    try {
      const res = await app.inject({ method: 'GET', url: '/_sdk/bridge.js' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.body).toContain('__i99dashHost');
      expect(res.body).toContain('callHandler');
    } finally {
      await app.close();
    }
  });

  it('GET /_sdk/context returns current context', async () => {
    const store = new StateStore(initialState);
    const app = await buildServer(makeBuildServerOpts(store));
    try {
      const res = await app.inject({ method: 'GET', url: '/_sdk/context' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ userId: 'u', locale: 'en' });
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/state patches and returns new state', async () => {
    const store = new StateStore(initialState);
    const app = await buildServer(makeBuildServerOpts(store));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/_sdk/state',
        payload: { speedKmh: 40 },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.state.speedKmh).toBe(40);
      expect(store.get().speedKmh).toBe(40);
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/state rejects malformed payloads', async () => {
    const app = await buildServer(makeBuildServerOpts(new StateStore(initialState)));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/_sdk/state',
        payload: { speedKmh: -5 },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  // ── Native-capability families (Phase A/B/C) ────────────────────
  // Sanity checks that the dev-server's fake routes return the
  // shapes the SDK's typed controllers expect, so a developer can
  // run their mini-app against `i99dash dev` instead of needing a
  // Leopard 8.

  it('POST /_sdk/native-cap → display.list returns the 3-display rig', async () => {
    const opts = makeBuildServerOpts(new StateStore(initialState));
    const app = await buildServer(opts);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: { op: 'display.list', params: {} },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.displays).toHaveLength(3);
      // First entry is the IVI (default), last is the cluster.
      expect(body.data.displays[0].isDefault).toBe(true);
      expect(body.data.displays[2].isCluster).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/native-cap → surface.create + surface.list round-trip', async () => {
    const opts = makeBuildServerOpts(new StateStore(initialState));
    const app = await buildServer(opts);
    try {
      const create = await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: {
          op: 'surface.create',
          params: { displayId: 5, route: '/cluster.html' },
        },
      });
      const created = JSON.parse(create.body);
      expect(created.success).toBe(true);
      expect(created.data.surfaceId).toMatch(/^sfc_dev_/);
      expect(created.data.path).toBe('am-start'); // non-default display

      const list = await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: { op: 'surface.list', params: {} },
      });
      const listed = JSON.parse(list.body);
      expect(listed.data.surfaces).toHaveLength(1);
      expect(listed.data.surfaces[0].route).toBe('/cluster.html');
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/native-cap → pkg.list filters out system apps by default', async () => {
    const opts = makeBuildServerOpts(new StateStore(initialState));
    const app = await buildServer(opts);
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: { op: 'pkg.list', params: { includeSystem: false } },
      });
      const body = JSON.parse(r.body);
      const systemEntries = body.data.packages.filter((p: { isSystem: boolean }) => p.isSystem);
      expect(systemEntries).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/native-cap → boot.set is scoped to active appId', async () => {
    const nativeCap = new NativeCapStore('app-a');
    const app = await buildServer({
      state: new StateStore(initialState),
      nativeCap,
    });
    try {
      // App A pins music.
      await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: {
          op: 'boot.set',
          params: { packageName: 'com.byd.music', displayId: 5 },
        },
      });
      // List under app-a — should see the row.
      const lA = await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: { op: 'boot.list', params: {} },
      });
      expect(JSON.parse(lA.body).data.entries).toHaveLength(1);

      // Switch the active appId; list is now empty for app-b.
      nativeCap.setActiveAppId('app-b');
      const lB = await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: { op: 'boot.list', params: {} },
      });
      expect(JSON.parse(lB.body).data.entries).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/native-cap rejects unknown family ops with unknown_op', async () => {
    const opts = makeBuildServerOpts(new StateStore(initialState));
    const app = await buildServer(opts);
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/_sdk/native-cap',
        payload: { op: 'mystery.read', params: {} },
      });
      const body = JSON.parse(r.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('unknown_op');
    } finally {
      await app.close();
    }
  });
});
