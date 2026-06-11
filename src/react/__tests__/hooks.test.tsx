// @vitest-environment jsdom
/// React hook tests. Mounts each hook under `<MiniAppProvider>` over
/// a `MiniAppClient.withBridge(stub)`. The stub satisfies the v2
/// `CarBridge` contract — a single `callHandler(name, payload)` —
/// so the same code paths exercise as production.

import { act, render, renderHook, waitFor } from '@testing-library/react';
import {
  HOST_EVENTS_GLOBAL,
  MiniAppClient,
  type Bridge,
  type CarBridge,
  type HostEventsApi,
} from '../../runtime/index.js';
import { describe, expect, it } from 'vitest';

import {
  MiniAppProvider,
  useCarConnection,
  useCarSignals,
  useClient,
  useMiniAppContext,
} from '../index.js';

const validContext = {
  userId: 'u-1',
  activeCarId: 'VIN',
  locale: 'en',
  isDark: false,
  appVersion: '1.0.0',
  appId: 'fuel_prices',
} as const;

interface CarHostStub {
  bridge: CarBridge;
  /// Dispatch a `car.signal` event via the page-installed events bus.
  emitSignal(
    subscriptionId: string,
    data: { name: string; value: number | null; at: string },
  ): void;
  /// Dispatch a `car.connection` state change.
  emitConnection(
    subscriptionId: string,
    state: 'connected' | 'degraded' | 'disconnected' | 'unknown',
  ): void;
  /// Last subscription id minted; tests use this to target push.
  lastSignalId(): string;
  lastConnectionId(): string;
}

function newCarStub(): CarHostStub {
  let signalSeq = 0;
  let connSeq = 0;
  let lastSignalId = '';
  let lastConnId = '';
  const bridge: CarBridge = {
    getContext: async () => validContext,
    callHandler: async (name, ..._args) => {
      switch (name) {
        case 'car.subscribe':
          signalSeq++;
          lastSignalId = `sig-${signalSeq}`;
          return { subscriptionId: lastSignalId };
        case 'car.unsubscribe':
          return { subscriptionId: lastSignalId };
        case 'car.connection.subscribe':
          connSeq++;
          lastConnId = `conn-${connSeq}`;
          return { subscriptionId: lastConnId };
        case 'car.connection.unsubscribe':
          return { subscriptionId: lastConnId };
        default:
          return null;
      }
    },
  };
  return {
    bridge,
    emitSignal(subscriptionId, data) {
      const events = (window as unknown as Record<string, HostEventsApi | undefined>)[
        HOST_EVENTS_GLOBAL
      ];
      events?.dispatch('car.signal', { subscriptionId, data });
    },
    emitConnection(subscriptionId, state) {
      const events = (window as unknown as Record<string, HostEventsApi | undefined>)[
        HOST_EVENTS_GLOBAL
      ];
      events?.dispatch('car.connection', { subscriptionId, state });
    },
    lastSignalId: () => lastSignalId,
    lastConnectionId: () => lastConnId,
  };
}

const wrapper = (client: MiniAppClient | null) => {
  return ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <MiniAppProvider client={client}>{children}</MiniAppProvider>
  );
};

describe('useClient', () => {
  it('returns the provided client', () => {
    const client = MiniAppClient.withBridge(newCarStub().bridge);
    const { result } = renderHook(() => useClient(), { wrapper: wrapper(client) });
    expect(result.current).toBe(client);
  });

  it('returns null without a provider', () => {
    const { result } = renderHook(() => useClient());
    expect(result.current).toBeNull();
  });
});

describe('useMiniAppContext', () => {
  it('resolves to the host context', async () => {
    const stub = newCarStub();
    const client = MiniAppClient.withBridge(stub.bridge);
    const { result } = renderHook(() => useMiniAppContext(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.locale).toBe('en');
    expect(result.current.error).toBeNull();
  });

  it('returns the fallback when client is null', async () => {
    const fallback = { ...validContext, locale: 'fr' as const };
    const { result } = renderHook(() => useMiniAppContext({ fallback }), {
      wrapper: wrapper(null),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.locale).toBe('fr');
  });
});

describe('useCarSignals', () => {
  it('renders the fallback initially, then live values on each event', async () => {
    const stub = newCarStub();
    const client = MiniAppClient.withBridge(stub.bridge);
    const { result } = renderHook(() => useCarSignals(['speed_kmh', 'battery_pct']), {
      wrapper: wrapper(client),
    });
    expect(result.current.values).toEqual({});

    // Allow the subscribe round-trip to settle.
    await waitFor(() => expect(stub.lastSignalId()).toBe('sig-1'));

    await act(async () => {
      stub.emitSignal('sig-1', {
        name: 'speed_kmh',
        value: 42,
        at: '2026-04-27T12:00:00.000Z',
      });
    });
    expect(result.current.values.speed_kmh).toBe(42);

    await act(async () => {
      stub.emitSignal('sig-1', {
        name: 'battery_pct',
        value: 77,
        at: '2026-04-27T12:00:01.000Z',
      });
    });
    expect(result.current.values.battery_pct).toBe(77);
    expect(result.current.values.speed_kmh).toBe(42);
  });

  it('keeps fallback if the bridge lacks callHandler', async () => {
    const plain: Bridge = {
      getContext: async () => validContext,
    };
    const client = MiniAppClient.withBridge(plain);
    const fallback = { speed_kmh: 0 };
    const { result } = renderHook(() => useCarSignals(['speed_kmh'], { fallback }), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Hook caught the BridgeTransportError and stayed on fallback.
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.values.speed_kmh).toBe(0);
  });
});

describe('useCarConnection', () => {
  it('reflects connection-state pushes', async () => {
    const stub = newCarStub();
    const client = MiniAppClient.withBridge(stub.bridge);
    const { result } = renderHook(() => useCarConnection(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(stub.lastConnectionId()).toBe('conn-1'));

    await act(async () => {
      stub.emitConnection('conn-1', 'connected');
    });
    expect(result.current.state).toBe('connected');

    await act(async () => {
      stub.emitConnection('conn-1', 'degraded');
    });
    expect(result.current.state).toBe('degraded');
  });
});

describe('MiniAppProvider', () => {
  it('renders children with a null client', () => {
    const { container } = render(
      <MiniAppProvider client={null}>
        <span data-testid="ok">hello</span>
      </MiniAppProvider>,
    );
    expect(container.querySelector('[data-testid="ok"]')?.textContent).toBe('hello');
  });
});
