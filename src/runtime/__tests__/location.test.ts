import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationUnavailableError, MiniAppClient, type Bridge } from '../index.js';

const plainBridge: Bridge = {
  getContext: async () => ({}),
  callApi: async () => ({ success: true, data: null }),
};

// ── Stub for navigator.geolocation ──────────────────────────────────
//
// The new LocationController routes through `navigator.geolocation`
// (the standard browser API) rather than a bespoke host bridge — so
// these tests mock the global instead of a `LocationBridge`. The
// geolocation stub is restored after every test so the mocks don't
// bleed into other suites.

interface Stub {
  getCurrentPosition: ReturnType<typeof vi.fn>;
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
}

function installGeolocationStub(): {
  stub: Stub;
  notify: (coords: GeolocationCoordinates, ts?: number) => void;
} {
  let watchSuccess: PositionCallback | undefined;
  const stub: Stub = {
    getCurrentPosition: vi.fn((success: PositionCallback) => {
      success({
        coords: makeCoords({
          latitude: 24.7,
          longitude: 46.6,
          heading: 90,
          speed: 12.5,
          accuracy: 8,
        }),
        timestamp: Date.parse('2026-04-28T08:00:00.000Z'),
      } as GeolocationPosition);
    }),
    watchPosition: vi.fn((success: PositionCallback) => {
      watchSuccess = success;
      return 42;
    }),
    clearWatch: vi.fn(),
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { geolocation: stub },
  });
  return {
    stub,
    notify: (coords, ts = Date.now()) => {
      watchSuccess?.({ coords, timestamp: ts } as GeolocationPosition);
    },
  };
}

function uninstallGeolocationStub(): void {
  // Drop navigator entirely; the absence of property triggers the
  // "navigator.geolocation not available" branch in the controller.
  // @ts-expect-error -- intentional teardown.
  delete (globalThis as Record<string, unknown>).navigator;
}

function makeCoords(over: Partial<GeolocationCoordinates>): GeolocationCoordinates {
  return {
    latitude: 0,
    longitude: 0,
    accuracy: 5,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    ...over,
  } as GeolocationCoordinates;
}

describe('client.location', () => {
  afterEach(() => {
    uninstallGeolocationStub();
    vi.restoreAllMocks();
  });

  it('throws LocationUnavailableError when navigator.geolocation is missing', async () => {
    // No stub installed — controller's `_geo()` returns null and
    // every call throws the typed error mini-apps already catch.
    const c = MiniAppClient.withBridge(plainBridge);
    await expect(c.location.getSnapshot()).rejects.toBeInstanceOf(LocationUnavailableError);
    expect(() => c.location.onChange(() => {})).toThrow(LocationUnavailableError);
  });

  it('maps GeolocationPosition → LocationSnapshot via getSnapshot', async () => {
    installGeolocationStub();
    const snap = await MiniAppClient.withBridge(plainBridge).location.getSnapshot();
    expect(snap.lat).toBe(24.7);
    expect(snap.lng).toBe(46.6);
    expect(snap.heading).toBe(90);
    expect(snap.speedMps).toBe(12.5);
    expect(snap.accuracyM).toBe(8);
    expect(snap.at).toBe('2026-04-28T08:00:00.000Z');
  });

  it('coerces null/NaN heading + speed to null in the snapshot', async () => {
    const { stub } = installGeolocationStub();
    stub.getCurrentPosition.mockImplementationOnce((success: PositionCallback) => {
      success({
        coords: makeCoords({
          latitude: 1,
          longitude: 2,
          heading: NaN,
          speed: NaN,
        }),
        timestamp: 0,
      } as GeolocationPosition);
    });
    const snap = await MiniAppClient.withBridge(plainBridge).location.getSnapshot();
    expect(snap.heading).toBeNull();
    expect(snap.speedMps).toBeNull();
  });

  it('dispatches watchPosition events to onChange subscribers', () => {
    const { notify } = installGeolocationStub();
    const c = MiniAppClient.withBridge(plainBridge);
    const cb = vi.fn();
    c.location.onChange(cb);
    notify(makeCoords({ latitude: 25.0, longitude: 46.6 }), Date.parse('2026-04-29T00:00:00.000Z'));
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].lat).toBe(25.0);
  });

  it('clearWatch fires when the last listener unsubscribes', () => {
    const { stub } = installGeolocationStub();
    const c = MiniAppClient.withBridge(plainBridge);
    const off = c.location.onChange(() => {});
    expect(stub.watchPosition).toHaveBeenCalledOnce();
    off();
    expect(stub.clearWatch).toHaveBeenCalledOnce();
    // Idempotent — calling off() twice should not double-clear.
    off();
    expect(stub.clearWatch).toHaveBeenCalledOnce();
  });

  it('shares one watchPosition across multiple listeners', () => {
    const { stub, notify } = installGeolocationStub();
    const c = MiniAppClient.withBridge(plainBridge);
    const a = vi.fn();
    const b = vi.fn();
    c.location.onChange(a);
    c.location.onChange(b);
    expect(stub.watchPosition).toHaveBeenCalledOnce();
    notify(makeCoords({ latitude: 1, longitude: 2 }));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
