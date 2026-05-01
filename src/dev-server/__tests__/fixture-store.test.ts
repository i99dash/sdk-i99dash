import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FixtureStore } from '../state/fixture-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fixstore-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, body: unknown) {
  await writeFile(join(dir, name), JSON.stringify(body));
}

describe('FixtureStore.match', () => {
  it('matches on path + method', async () => {
    await write('a.json', {
      match: { path: '/api/v1/fuel-stations', method: 'GET' },
      response: { success: true, data: { stations: [] } },
    });
    const store = new FixtureStore(dir);
    await store.load();
    const res = store.match({ path: '/api/v1/fuel-stations', method: 'GET' });
    expect(res?.success).toBe(true);
  });

  it('returns null on miss', async () => {
    const store = new FixtureStore(dir);
    await store.load();
    expect(store.match({ path: '/nope', method: 'GET' })).toBeNull();
  });

  it('requires every declared query param to match', async () => {
    await write('a.json', {
      match: { path: '/x', method: 'GET', query: { id: 42 } },
      response: { success: true, data: 'matched' },
    });
    const store = new FixtureStore(dir);
    await store.load();
    expect(store.match({ path: '/x', method: 'GET', query: { id: 42 } })?.success).toBe(true);
    expect(store.match({ path: '/x', method: 'GET', query: { id: 99 } })).toBeNull();
    expect(store.match({ path: '/x', method: 'GET' })).toBeNull();
  });

  it('alphabetical filename order wins', async () => {
    await write('a.json', {
      match: { path: '/x', method: 'GET' },
      response: { success: true, data: 'from-a' },
    });
    await write('b.json', {
      match: { path: '/x', method: 'GET' },
      response: { success: true, data: 'from-b' },
    });
    const store = new FixtureStore(dir);
    await store.load();
    const res = store.match({ path: '/x', method: 'GET' });
    expect(res?.success).toBe(true);
    if (res?.success) expect(res.data).toBe('from-a');
  });

  it('skips malformed fixture files instead of crashing', async () => {
    await write('bad.json', { this: 'is not a fixture' });
    await write('good.json', {
      match: { path: '/x', method: 'GET' },
      response: { success: true, data: 'ok' },
    });
    const store = new FixtureStore(dir);
    await store.load();
    expect(store.match({ path: '/x', method: 'GET' })?.success).toBe(true);
  });
});
