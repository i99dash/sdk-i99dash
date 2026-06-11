// @vitest-environment jsdom
/// Tests for the v2 unified `CarController` — the single `client.car`
/// surface that wraps every `car.*` bridge handler.
///
/// Strategy: hand `MiniAppClient.withBridge` a stub that satisfies the
/// `CarBridge` contract — a `callHandler(name, payload)` proxy. The
/// stub records calls + returns whatever wire payload the test wants.
/// Push events (`car.signal`, `car.connection`) are dispatched via the
/// page-installed `__i99dashEvents` bus.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAR_MAX_NAMES,
  HOST_EVENTS_GLOBAL,
  MiniAppClient,
  type Bridge,
  type CarBridge,
  type HostEventsApi,
} from '../index.js';
import { BridgeTransportError, InvalidResponseError } from '../errors.js';

interface CallRecord {
  name: string;
  payload: unknown;
}

interface CarStub {
  bridge: CarBridge;
  calls: CallRecord[];
  setHandler(name: string, fn: (payload: unknown) => unknown): void;
  emitSignal(
    subscriptionId: string,
    data: { name: string; value: number | null; at: string },
  ): void;
  emitConnection(
    subscriptionId: string,
    state: 'connected' | 'degraded' | 'disconnected' | 'unknown',
  ): void;
}

function newCarStub(): CarStub {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const calls: CallRecord[] = [];
  const bridge: CarBridge = {
    getContext: async () => ({}),
    callHandler: async (name, ...args) => {
      const payload = args[0];
      calls.push({ name, payload });
      const fn = handlers.get(name);
      if (!fn) {
        throw new Error(`unhandled callHandler call: ${name}`);
      }
      return fn(payload);
    },
  };
  return {
    bridge,
    calls,
    setHandler(name, fn) {
      handlers.set(name, fn);
    },
    emitSignal(subscriptionId, data) {
      getEvents().dispatch('car.signal', { subscriptionId, data });
    },
    emitConnection(subscriptionId, state) {
      getEvents().dispatch('car.connection', { subscriptionId, state });
    },
  };
}

function getEvents(): HostEventsApi {
  const e = (window as unknown as Record<string, HostEventsApi | undefined>)[HOST_EVENTS_GLOBAL];
  if (!e) throw new Error('events bus not installed yet');
  return e;
}

beforeEach(() => {
  // Wipe the page-installed events bus between tests so subscription
  // routing from a previous test doesn't leak.
  delete (window as unknown as Record<string, unknown>)[HOST_EVENTS_GLOBAL];
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[HOST_EVENTS_GLOBAL];
});

const validCatalog = {
  bridgeVersion: '2.0.0',
  brand: 'byd',
  categories: ['climate', 'propulsion'],
  names: [
    {
      name: 'ac_power',
      category: 'climate',
      description: 'AC power state',
      writeable: true,
      writeActionId: 'climate.power.toggle',
      threeD: false,
    },
    {
      name: 'speed_kmh',
      category: 'dynamics',
      description: 'Vehicle speed',
      units: 'km/h',
      writeable: false,
      threeD: true,
    },
  ],
} as const;

describe('client.car.list', () => {
  it('returns the parsed catalog list', async () => {
    const stub = newCarStub();
    stub.setHandler('car.list', () => validCatalog);
    const client = MiniAppClient.withBridge(stub.bridge);
    const out = await client.car.list();
    expect(out.bridgeVersion).toBe('2.0.0');
    expect(out.brand).toBe('byd');
    expect(out.names).toHaveLength(2);
  });

  it('forwards category + threeDOnly filters', async () => {
    const stub = newCarStub();
    stub.setHandler('car.list', () => validCatalog);
    const client = MiniAppClient.withBridge(stub.bridge);
    await client.car.list({ category: 'climate', threeDOnly: true });
    expect(stub.calls[0]?.payload).toEqual({ category: 'climate', threeDOnly: true });
  });

  it('throws InvalidResponseError on malformed payload', async () => {
    const stub = newCarStub();
    stub.setHandler('car.list', () => ({ wrong: 'shape' }));
    const client = MiniAppClient.withBridge(stub.bridge);
    await expect(client.car.list()).rejects.toBeInstanceOf(InvalidResponseError);
  });
});

describe('client.car.read', () => {
  it('returns the typed values map', async () => {
    const stub = newCarStub();
    stub.setHandler('car.read', () => ({
      values: { ac_power: 1, speed_kmh: 42 },
      at: '2026-04-27T12:00:00.000Z',
    }));
    const client = MiniAppClient.withBridge(stub.bridge);
    const out = await client.car.read(['ac_power', 'speed_kmh']);
    expect(out.values.ac_power).toBe(1);
    expect(out.values.speed_kmh).toBe(42);
  });

  it('rejects locally when names.length > 64 without round-tripping', async () => {
    const stub = newCarStub();
    const client = MiniAppClient.withBridge(stub.bridge);
    const names = Array.from({ length: CAR_MAX_NAMES + 1 }, (_, i) => `n${i}`);
    await expect(client.car.read(names)).rejects.toThrow(/too_many_names/);
    expect(stub.calls).toHaveLength(0);
  });

  it('surfaces a host error envelope as an Error', async () => {
    const stub = newCarStub();
    stub.setHandler('car.read', () => ({
      error: 'too_many_names',
      max: CAR_MAX_NAMES,
      requested: 100,
    }));
    const client = MiniAppClient.withBridge(stub.bridge);
    await expect(client.car.read(['a'])).rejects.toThrow(/too_many_names/);
  });
});

describe('client.car.subscribe', () => {
  it('registers a listener and routes events by subscriptionId', async () => {
    const stub = newCarStub();
    stub.setHandler('car.subscribe', () => ({ subscriptionId: 'sub-1' }));
    stub.setHandler('car.unsubscribe', () => ({ subscriptionId: 'sub-1' }));
    const client = MiniAppClient.withBridge(stub.bridge);
    const events: Array<{ name: string; value: number | null }> = [];
    const off = await client.car.subscribe({
      names: ['speed_kmh'],
      onEvent: (e) => events.push({ name: e.name, value: e.value }),
    });
    stub.emitSignal('sub-1', {
      name: 'speed_kmh',
      value: 42,
      at: '2026-04-27T12:00:00.000Z',
    });
    expect(events).toEqual([{ name: 'speed_kmh', value: 42 }]);
    off();
    expect(stub.calls.some((c) => c.name === 'car.unsubscribe')).toBe(true);
  });

  it('ignores events for a different subscriptionId', async () => {
    const stub = newCarStub();
    stub.setHandler('car.subscribe', () => ({ subscriptionId: 'sub-A' }));
    stub.setHandler('car.unsubscribe', () => ({ subscriptionId: 'sub-A' }));
    const client = MiniAppClient.withBridge(stub.bridge);
    const events: Array<{ name: string; value: number | null }> = [];
    await client.car.subscribe({
      names: ['speed_kmh'],
      onEvent: (e) => events.push({ name: e.name, value: e.value }),
    });
    stub.emitSignal('sub-OTHER', {
      name: 'speed_kmh',
      value: 99,
      at: '2026-04-27T12:00:00.000Z',
    });
    expect(events).toEqual([]);
  });

  it('rejects locally when names.length > 64', async () => {
    const stub = newCarStub();
    const client = MiniAppClient.withBridge(stub.bridge);
    const names = Array.from({ length: CAR_MAX_NAMES + 1 }, (_, i) => `n${i}`);
    await expect(client.car.subscribe({ names, onEvent: () => {} })).rejects.toThrow(
      /too_many_names/,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it('passing an aborted AbortSignal calls unsubscribe immediately', async () => {
    const stub = newCarStub();
    stub.setHandler('car.subscribe', () => ({ subscriptionId: 'sub-2' }));
    stub.setHandler('car.unsubscribe', () => ({ subscriptionId: 'sub-2' }));
    const client = MiniAppClient.withBridge(stub.bridge);
    const ac = new AbortController();
    ac.abort();
    await client.car.subscribe({
      names: ['x'],
      onEvent: () => {},
      signal: ac.signal,
    });
    expect(stub.calls.some((c) => c.name === 'car.unsubscribe')).toBe(true);
  });
});

describe('client.car.command', () => {
  it('auto-generates an idempotencyKey when not provided', async () => {
    const stub = newCarStub();
    stub.setHandler('car.command', () => ({ ok: true }));
    const client = MiniAppClient.withBridge(stub.bridge);
    await client.car.command('climate.power.toggle');
    const payload = stub.calls[0]?.payload as Record<string, unknown> | undefined;
    expect(typeof payload?.idempotencyKey).toBe('string');
    expect((payload?.idempotencyKey as string).length).toBeGreaterThan(8);
  });

  it('uses the caller-supplied idempotencyKey', async () => {
    const stub = newCarStub();
    stub.setHandler('car.command', () => ({ ok: true }));
    const client = MiniAppClient.withBridge(stub.bridge);
    await client.car.command('climate.power.toggle', { state: 1 }, { idempotencyKey: 'fixed-key' });
    const payload = stub.calls[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.idempotencyKey).toBe('fixed-key');
    expect(payload?.actionId).toBe('climate.power.toggle');
    expect(payload?.args).toEqual({ state: 1 });
  });

  it('returns the envelope verbatim including ok: false', async () => {
    const stub = newCarStub();
    stub.setHandler('car.command', () => ({ ok: false, code: 422 }));
    const client = MiniAppClient.withBridge(stub.bridge);
    const r = await client.car.command('x');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(422);
  });
});

describe('client.car.identity', () => {
  const sampleIdentity = {
    brand: 'byd',
    modelCode: 'leopard8',
    modelDisplay: 'BYD Leopard 8',
    modelAssetPath: 'assets/3d/leopard8.glb',
    clips: ['Door_FL_Open'],
    variants: {
      paint: ['paint_default'],
      wheels: ['wheels_silver'],
      glass: ['glass_clear'],
    },
  };

  it('memoises the identity across repeat calls', async () => {
    const stub = newCarStub();
    stub.setHandler('car.identity', () => sampleIdentity);
    const client = MiniAppClient.withBridge(stub.bridge);
    await client.car.identity();
    await client.car.identity();
    const identityCalls = stub.calls.filter((c) => c.name === 'car.identity');
    expect(identityCalls).toHaveLength(1);
  });

  it('clears the cache when connection observes "disconnected"', async () => {
    const stub = newCarStub();
    stub.setHandler('car.identity', () => sampleIdentity);
    stub.setHandler('car.connection.subscribe', () => ({ subscriptionId: 'c-1' }));
    stub.setHandler('car.connection.unsubscribe', () => ({ subscriptionId: 'c-1' }));
    const client = MiniAppClient.withBridge(stub.bridge);
    await client.car.identity();
    await client.car.connectionSubscribe(() => {});
    stub.emitConnection('c-1', 'disconnected');
    await client.car.identity();
    const identityCalls = stub.calls.filter((c) => c.name === 'car.identity');
    expect(identityCalls.length).toBe(2);
  });
});

describe('client.car.asset', () => {
  it('decodes bytesBase64 to Uint8Array', async () => {
    const stub = newCarStub();
    // "hi" → base64 "aGk="
    stub.setHandler('car.asset', () => ({
      path: 'assets/3d/leopard8.glb',
      contentType: 'model/gltf-binary',
      size: 2,
      bytesBase64: 'aGk=',
    }));
    const client = MiniAppClient.withBridge(stub.bridge);
    const r = await client.car.asset('assets/3d/leopard8.glb');
    expect(r.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(r.bytes)).toEqual([104, 105]);
    expect(r.contentType).toBe('model/gltf-binary');
  });

  it('surfaces error envelopes as Errors', async () => {
    const stub = newCarStub();
    stub.setHandler('car.asset', () => ({
      error: 'disallowed_path',
      path: '/etc/passwd',
    }));
    const client = MiniAppClient.withBridge(stub.bridge);
    await expect(client.car.asset('/etc/passwd')).rejects.toThrow(/disallowed_path/);
  });
});

describe('client.car.connectionSubscribe', () => {
  it('routes connection events to the listener by subscriptionId', async () => {
    const stub = newCarStub();
    stub.setHandler('car.connection.subscribe', () => ({ subscriptionId: 'c-1' }));
    stub.setHandler('car.connection.unsubscribe', () => ({ subscriptionId: 'c-1' }));
    const client = MiniAppClient.withBridge(stub.bridge);
    const states: string[] = [];
    const off = await client.car.connectionSubscribe((s) => states.push(s));
    stub.emitConnection('c-1', 'connected');
    stub.emitConnection('c-1', 'degraded');
    stub.emitConnection('c-OTHER', 'disconnected'); // wrong id
    expect(states).toEqual(['connected', 'degraded']);
    off();
    expect(stub.calls.some((c) => c.name === 'car.connection.unsubscribe')).toBe(true);
  });
});

describe('client.car — capability gating', () => {
  it('throws BridgeTransportError when bridge lacks callHandler', async () => {
    const plain: Bridge = {
      getContext: async () => null,
    };
    const client = MiniAppClient.withBridge(plain);
    await expect(client.car.list()).rejects.toBeInstanceOf(BridgeTransportError);
  });
});
