import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildServer } from '../server.js';
import { FixtureStore } from '../state/fixture-store.js';
import { NativeCapStore } from '../state/native-cap-store.js';
import { StateStore } from '../state/state-store.js';

/// Test helper. Each test gets fresh stores so suite order can't
/// matter — particularly important for the in-memory NativeCapStore
/// whose surfaces / boot rows accumulate within a server lifetime.
function makeBuildServerOpts(state: StateStore, dir: string) {
  return {
    state,
    fixtures: new FixtureStore(dir),
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

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'srv-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('dev-server routes', () => {
  it('GET /_sdk/bridge.js returns the shim JS', async () => {
    const app = await buildServer({
      state: new StateStore(initialState),
      fixtures: new FixtureStore(dir),
      nativeCap: new NativeCapStore('x'),
    });
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
    const app = await buildServer({
      state: store,
      fixtures: new FixtureStore(dir),
      nativeCap: new NativeCapStore('x'),
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/_sdk/context' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ userId: 'u', locale: 'en' });
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/call-api returns NO_FIXTURE when no mock matches', async () => {
    const app = await buildServer({
      state: new StateStore(initialState),
      fixtures: new FixtureStore(dir),
      nativeCap: new NativeCapStore('x'),
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/_sdk/call-api',
        payload: { path: '/api/v1/missing', method: 'GET' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NO_FIXTURE');
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/call-api returns fixture when matched', async () => {
    await writeFile(
      join(dir, 'a.json'),
      JSON.stringify({
        match: { path: '/api/v1/fuel-stations', method: 'GET' },
        response: { success: true, data: { stations: ['x'] } },
      }),
    );
    const fixtures = new FixtureStore(dir);
    await fixtures.load();
    const app = await buildServer({
      state: new StateStore(initialState),
      fixtures,
      nativeCap: new NativeCapStore('x'),
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/_sdk/call-api',
        payload: { path: '/api/v1/fuel-stations', method: 'GET' },
      });
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.stations).toEqual(['x']);
    } finally {
      await app.close();
    }
  });

  it('POST /_sdk/state patches and returns new state', async () => {
    const store = new StateStore(initialState);
    const app = await buildServer({
      state: store,
      fixtures: new FixtureStore(dir),
      nativeCap: new NativeCapStore('x'),
    });
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
    const app = await buildServer({
      state: new StateStore(initialState),
      fixtures: new FixtureStore(dir),
      nativeCap: new NativeCapStore('x'),
    });
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

  it('GET /_sdk/inspect returns an HTML page', async () => {
    const app = await buildServer({
      state: new StateStore(initialState),
      fixtures: new FixtureStore(dir),
      nativeCap: new NativeCapStore('x'),
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/_sdk/inspect' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('callApi inspector');
    } finally {
      await app.close();
    }
  });

  it('GET /_sdk/inspect/data tracks recent decisions with the matched fixture', async () => {
    await writeFile(
      join(dir, 'a.json'),
      JSON.stringify({
        match: { path: '/api/v1/x', method: 'GET' },
        response: { success: true, data: { ok: 1 } },
      }),
    );
    const fixtures = new FixtureStore(dir);
    await fixtures.load();
    const store = new StateStore(initialState);
    const app = await buildServer({ state: store, fixtures, nativeCap: new NativeCapStore('x') });
    try {
      // matched
      await app.inject({
        method: 'POST',
        url: '/_sdk/call-api',
        payload: { path: '/api/v1/x', method: 'GET' },
      });
      // no_fixture
      await app.inject({
        method: 'POST',
        url: '/_sdk/call-api',
        payload: { path: '/api/v1/missing', method: 'GET' },
      });
      // bad_request
      await app.inject({
        method: 'POST',
        url: '/_sdk/call-api',
        payload: { method: 'GET' }, // no path
      });
      const res = await app.inject({ method: 'GET', url: '/_sdk/inspect/data' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        decisions: Array<{
          outcome: string;
          fixtureFile?: string;
          request: { path: string };
        }>;
      };
      expect(body.decisions).toHaveLength(3);
      expect(body.decisions[0]?.outcome).toBe('matched');
      expect(body.decisions[0]?.fixtureFile).toContain('a.json');
      expect(body.decisions[1]?.outcome).toBe('no_fixture');
      expect(body.decisions[2]?.outcome).toBe('bad_request');
    } finally {
      await app.close();
    }
  });

  it('inspect ring buffer caps at 20 decisions', async () => {
    const store = new StateStore(initialState);
    const app = await buildServer({
      state: store,
      fixtures: new FixtureStore(dir),
      nativeCap: new NativeCapStore('x'),
    });
    try {
      for (let i = 0; i < 25; i++) {
        await app.inject({
          method: 'POST',
          url: '/_sdk/call-api',
          payload: { path: `/api/v1/n${i}`, method: 'GET' },
        });
      }
      const res = await app.inject({ method: 'GET', url: '/_sdk/inspect/data' });
      const body = JSON.parse(res.body) as {
        decisions: Array<{ request: { path: string } }>;
      };
      expect(body.decisions).toHaveLength(20);
      // Oldest dropped — first remaining entry should be the 6th request
      expect(body.decisions[0]?.request.path).toBe('/api/v1/n5');
      expect(body.decisions[19]?.request.path).toBe('/api/v1/n24');
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
    const opts = makeBuildServerOpts(new StateStore(initialState), dir);
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
    const opts = makeBuildServerOpts(new StateStore(initialState), dir);
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
    const opts = makeBuildServerOpts(new StateStore(initialState), dir);
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
      fixtures: new FixtureStore(dir),
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
    const opts = makeBuildServerOpts(new StateStore(initialState), dir);
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
